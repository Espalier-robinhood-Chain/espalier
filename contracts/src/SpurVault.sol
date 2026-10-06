// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {SafeCast} from "@openzeppelin/contracts/utils/math/SafeCast.sol";
import {IOracleRouter} from "./interfaces/IOracleRouter.sol";
import {ISettlementOracle} from "./interfaces/ISettlementOracle.sol";
import {ISpurVault} from "./interfaces/ISpurVault.sol";
import {Roles} from "./libraries/Roles.sol";

/// @title SpurVault
/// @notice Covered-call vault (mis. sNVDA). Gardener menyetor Stock Token; tiap minggu vault menjual opsi call
///         ke Picker lewat `HarvestAuction` dan premium (USDG) dibagi ke pemegang posisi.
/// @dev Satu round = satu Harvest. Siklus: `rollRound` (KEEPER) -> `HarvestAuction.fill` (premium masuk) ->
///      expiry -> `SettlementOracle.settle` (siapa saja) -> `settleRound` (siapa saja) -> Idle -> `rollRound` lagi.
///      - Posisi BUKAN ERC-20 dan tidak bisa dipindahkan (MVP). Alasannya: setoran dan penarikan diantrikan ke
///        round berikutnya dan diubah jadi share secara malas (lazy), sehingga pembagian premium bisa dihitung
///        tepat per pemegang tanpa loop. Share yang bisa dipindahkan (mis. ERC-7540) adalah pekerjaan v2.
///      - Deposit dan withdraw diantrikan ke roll berikutnya. Setoran yang belum masuk round bisa ditarik
///        kembali kapan saja (`cancelDeposit`). Penarikan antre (`requestWithdraw`) dihitung pada harga per
///        share saat roll, lalu diambil lewat `claimWithdraw`.
///      - Akuntansi aset memakai pembukuan internal (`managedAssets`), BUKAN saldo token, sehingga donasi tidak
///        bisa memanipulasi harga per share.
///      - Settlement cash-settled dalam unit saham: bila harga settlement P > strike K, Picker menerima
///        `notional x (P - K) / P` Stock Token (setara saham "terjual" di K). Bila P <= K, Picker tidak menerima apa-apa.
///        Pembayaran ke Picker ditarik sendiri (`claimPickerPayout`) supaya token yang diblokir tidak menahan settlement.
///      - Premium dibagi lewat akumulator per share (`accPremium`) dengan koreksi per akun. Share yang masuk saat
///        roll `n` baru berhak atas premium round `n` dan sesudahnya; share yang keluar saat roll `n` tidak berhak
///        atas premium round `n`.
///      - Strike dihitung dari harga oracle LIVE saat roll (`harga x (1 + otmBps)`), bukan diberikan KEEPER.
///        KEEPER hanya memilih expiry dalam batas `MIN_DURATION`..`MAX_DURATION`. Lantai premium (`minPremiumBps`
///        dari nilai notional) dipaksa di kontrak.
///      - Jeda (GUARDIAN/ADMIN) hanya menutup `deposit` dan `rollRound`. Menarik dana tidak pernah ditutup.
///      Graft (cash-secured put) ada di `GraftVault.sol`. BELUM ADA: share yang bisa dipindahkan, penyesuaian corporate action.
contract SpurVault is ISpurVault, AccessControl, ReentrancyGuard, Pausable {
    using SafeERC20 for IERC20;

    uint256 public constant BPS = 10_000;
    uint256 internal constant WAD = 1e18;
    /// Skala akumulator premium dan koreksi.
    uint256 internal constant MAG = 2 ** 128;

    uint16 public constant MIN_OTM_BPS = 100; // 1%
    uint16 public constant MAX_OTM_BPS = 5_000; // 50%
    uint16 public constant MAX_MIN_PREMIUM_BPS = 2_000; // lantai premium paling tinggi 20% dari nilai notional
    uint32 public constant MIN_DURATION = 1 days;
    uint32 public constant MAX_DURATION = 14 days;
    uint32 public constant MIN_FILL_WINDOW = 1 hours;
    uint32 public constant MAX_FILL_WINDOW = 2 days;

    IERC20 public immutable ASSET;
    IERC20 public immutable override PREMIUM;
    IOracleRouter public immutable ROUTER;
    ISettlementOracle public immutable SETTLEMENT;
    address public immutable override AUCTION;
    /// Setelah roll dimulai, Picker hanya bisa membeli opsi sampai waktu ini; lewat itu round bisa ditutup (`closeUnsold`).
    uint32 public immutable FILL_WINDOW;
    uint256 public immutable MIN_DEPOSIT;
    uint8 private immutable ASSET_DECIMALS;
    uint8 private immutable PREMIUM_DECIMALS;

    /// Batas total aset (terkelola + setoran antre). `type(uint256).max` = tanpa batas.
    uint256 public depositCap;
    uint16 public otmBps;
    uint16 public minPremiumBps;

    enum Outcome {
        Pending, // round berjalan (atau belum dimulai)
        Settled, // opsi terjual dan sudah di-settle
        ClosedUnsold // ditutup tanpa opsi terjual (atau tidak ada yang bisa dijual)
    }

    struct Round {
        uint64 start;
        uint64 expiry;
        uint256 strikeE18; // 18 desimal
        uint256 startPriceE18;
        uint256 notional; // jumlah Stock Token yang dijaminkan opsi
        uint256 minPremium; // lantai premium (satuan USDG)
        address picker; // address(0) = belum terjual
        uint256 premium;
        uint256 settlePriceE18;
        uint256 payout; // Stock Token untuk Picker
        uint256 ppsStart; // aset per share saat roll (WAD)
        uint256 accStart; // `accPremium` saat roll
        Outcome outcome;
    }

    struct DepositReceipt {
        uint64 round; // round yang mengubah setoran ini menjadi share (saat roll)
        uint256 amount;
    }

    struct WithdrawReceipt {
        uint64 round;
        uint256 shares;
    }

    /// Nomor round terakhir yang dimulai (0 = belum pernah).
    uint64 public round;
    /// true selama round `round` berjalan (opsi aktif atau menunggu penjual).
    bool public active;
    mapping(uint64 => Round) public rounds;

    // Pembukuan aset (Stock Token). Saldo token >= managed + pending + reserved + total picker owed.
    uint256 public managedAssets;
    uint256 public pendingDeposits;
    uint256 public reservedWithdraw;
    uint256 public totalPickerOwed;

    uint256 public totalShares;
    uint256 public queuedWithdrawShares;

    // Premium (USDG).
    uint256 public accPremium;
    uint256 public premiumHeld; // dicatat tetapi belum diklaim

    mapping(address => uint256) internal _shares; // sudah menjadi share (belum termasuk setoran yang belum disinkron)
    mapping(address => int256) internal _corr;
    mapping(address => uint256) public premiumClaimed;
    mapping(address => DepositReceipt) public depositOf;
    mapping(address => WithdrawReceipt) public withdrawOf;
    mapping(address => uint256) public claimableAssets;
    mapping(address => uint256) public pickerOwed;

    error ZeroAddress();
    error InvalidConfig();
    error NotAuction();
    error NotIdle();
    error NotActive();
    error InvalidExpiry();
    error DepositTooSmall();
    error DepositCapExceeded();
    error InsufficientShares();
    error NothingToClaim();
    error NothingToCancel();
    error RoundMismatch();
    error AlreadySold();
    error NotSold();
    error FillWindowClosed();
    error FillWindowOpen();
    error PremiumBelowFloor();
    error PremiumNotReceived();
    error NotExpired();
    error SettlementUnavailable();
    error NotGuardian();

    event Deposited(address indexed account, uint64 indexed forRound, uint256 amount);
    event DepositCancelled(address indexed account, uint256 amount);
    event WithdrawRequested(address indexed account, uint64 indexed forRound, uint256 shares);
    event WithdrawCancelled(address indexed account, uint256 shares);
    event WithdrawClaimed(address indexed account, uint256 assets);
    event RoundStarted(
        uint64 indexed round,
        uint64 expiry,
        uint256 strikeE18,
        uint256 startPriceE18,
        uint256 notional,
        uint256 minPremium,
        uint256 ppsStart,
        uint256 totalShares
    );
    /// Round yang tidak punya opsi untuk dijual (tidak ada share, atau sisa di bawah `MIN_DEPOSIT`): hanya antrean diproses.
    event RoundSkipped(uint64 indexed round, uint256 ppsStart);
    event RoundSold(uint64 indexed round, address indexed picker, uint256 premium);
    event RoundSettled(uint64 indexed round, uint256 settlePriceE18, uint256 payout);
    event RoundClosedUnsold(uint64 indexed round);
    event PremiumClaimed(address indexed account, uint256 amount);
    event PickerPayoutClaimed(address indexed picker, uint256 amount);
    event OtmBpsSet(uint16 bps);
    event MinPremiumBpsSet(uint16 bps);
    event DepositCapSet(uint256 cap);

    constructor(
        address admin,
        address asset_,
        address premium_,
        address router_,
        address settlement_,
        address auction_,
        uint32 fillWindow_,
        uint256 minDeposit_,
        uint256 depositCap_,
        uint16 otmBps_,
        uint16 minPremiumBps_
    ) {
        if (
            admin == address(0) || asset_ == address(0) || premium_ == address(0) || router_ == address(0)
                || settlement_ == address(0) || auction_ == address(0)
        ) revert ZeroAddress();
        if (fillWindow_ < MIN_FILL_WINDOW || fillWindow_ > MAX_FILL_WINDOW || minDeposit_ == 0) revert InvalidConfig();
        if (otmBps_ < MIN_OTM_BPS || otmBps_ > MAX_OTM_BPS || minPremiumBps_ > MAX_MIN_PREMIUM_BPS) {
            revert InvalidConfig();
        }
        ASSET = IERC20(asset_);
        PREMIUM = IERC20(premium_);
        ROUTER = IOracleRouter(router_);
        SETTLEMENT = ISettlementOracle(settlement_);
        AUCTION = auction_;
        FILL_WINDOW = fillWindow_;
        MIN_DEPOSIT = minDeposit_;
        ASSET_DECIMALS = IERC20Metadata(asset_).decimals();
        PREMIUM_DECIMALS = IERC20Metadata(premium_).decimals();
        depositCap = depositCap_;
        otmBps = otmBps_;
        minPremiumBps = minPremiumBps_;
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
    }

    // =====================================================================================
    // Setoran dan penarikan
    // =====================================================================================

    /// Setor Stock Token. Menjadi share saat roll berikutnya. Ditolak saat dijeda atau melewati batas.
    function deposit(uint256 assets) external nonReentrant whenNotPaused {
        _sync(msg.sender);
        uint256 before_ = ASSET.balanceOf(address(this));
        ASSET.safeTransferFrom(msg.sender, address(this), assets);
        uint256 received = ASSET.balanceOf(address(this)) - before_; // aman untuk token dengan fee
        if (received < MIN_DEPOSIT) revert DepositTooSmall();
        if (managedAssets + pendingDeposits + received > depositCap) revert DepositCapExceeded();

        uint64 forRound = round + 1;
        DepositReceipt storage d = depositOf[msg.sender];
        d.round = forRound; // setelah `_sync`, receipt lama sudah dikonversi; yang tersisa pasti untuk round berikutnya
        d.amount += received;
        pendingDeposits += received;
        emit Deposited(msg.sender, forRound, received);
    }

    /// Tarik kembali setoran yang BELUM masuk round. Selalu tersedia (tidak ikut jeda).
    function cancelDeposit(uint256 amount) external nonReentrant {
        DepositReceipt storage d = depositOf[msg.sender];
        if (d.amount == 0 || d.round <= round) revert NothingToCancel();
        if (amount == 0 || amount > d.amount) revert InsufficientShares();
        d.amount -= amount;
        pendingDeposits -= amount;
        if (d.amount == 0) delete depositOf[msg.sender];
        ASSET.safeTransfer(msg.sender, amount);
        emit DepositCancelled(msg.sender, amount);
    }

    /// Antre penarikan `shareAmount` share. Dihitung pada harga per share saat roll berikutnya.
    /// Selama menunggu, share tetap menanggung risiko dan berhak atas premium round yang sedang berjalan.
    function requestWithdraw(uint256 shareAmount) external nonReentrant {
        _sync(msg.sender);
        WithdrawReceipt storage w = withdrawOf[msg.sender];
        if (shareAmount == 0 || shareAmount > _shares[msg.sender] - w.shares) revert InsufficientShares();
        w.round = round + 1;
        w.shares += shareAmount;
        queuedWithdrawShares += shareAmount;
        emit WithdrawRequested(msg.sender, w.round, shareAmount);
    }

    /// Batalkan sebagian atau seluruh antrean penarikan yang belum diproses roll.
    function cancelWithdraw(uint256 shareAmount) external nonReentrant {
        WithdrawReceipt storage w = withdrawOf[msg.sender];
        if (w.shares == 0 || w.round <= round) revert NothingToCancel();
        if (shareAmount == 0 || shareAmount > w.shares) revert InsufficientShares();
        w.shares -= shareAmount;
        queuedWithdrawShares -= shareAmount;
        if (w.shares == 0) delete withdrawOf[msg.sender];
        emit WithdrawCancelled(msg.sender, shareAmount);
    }

    /// Ambil Stock Token dari penarikan yang sudah diproses roll. Selalu tersedia.
    function claimWithdraw() external nonReentrant {
        _sync(msg.sender);
        uint256 amount = claimableAssets[msg.sender];
        if (amount == 0) revert NothingToClaim();
        claimableAssets[msg.sender] = 0;
        reservedWithdraw -= amount;
        ASSET.safeTransfer(msg.sender, amount);
        emit WithdrawClaimed(msg.sender, amount);
    }

    /// Ambil premium USDG yang sudah menjadi hak akun ini.
    function claimPremium() external nonReentrant {
        _sync(msg.sender);
        uint256 owed = _premiumOwed(_shares[msg.sender], _corr[msg.sender]) - premiumClaimed[msg.sender];
        if (owed == 0) revert NothingToClaim();
        premiumClaimed[msg.sender] += owed;
        premiumHeld -= owed;
        PREMIUM.safeTransfer(msg.sender, owed);
        emit PremiumClaimed(msg.sender, owed);
    }

    // =====================================================================================
    // Siklus round
    // =====================================================================================

    /// Memulai round baru. Hanya KEEPER, hanya saat Idle. Memproses antrean setoran dan penarikan pada harga per
    /// share yang sama, menetapkan strike dari harga oracle live, lalu membuka jendela penjualan opsi.
    /// Bila tidak ada yang layak dijual (semua keluar, atau sisa di bawah `MIN_DEPOSIT`), round hanya memproses
    /// antrean dan tidak ada opsi (`RoundSkipped`).
    function rollRound(uint64 expiry) external onlyRole(Roles.KEEPER_ROLE) nonReentrant whenNotPaused {
        if (active) revert NotIdle();
        if (expiry < block.timestamp + MIN_DURATION || expiry > block.timestamp + MAX_DURATION) {
            revert InvalidExpiry();
        }

        uint256 ts = totalShares;
        uint256 pps = ts == 0 ? WAD : Math.mulDiv(managedAssets, WAD, ts);
        if (pps == 0) revert InvalidConfig();

        uint64 n = ++round;
        uint256 queued = queuedWithdrawShares;
        uint256 out = Math.mulDiv(queued, pps, WAD);
        uint256 pending = pendingDeposits;
        uint256 minted = Math.mulDiv(pending, WAD, pps);

        managedAssets = managedAssets - out + pending;
        totalShares = ts - queued + minted;
        reservedWithdraw += out;
        pendingDeposits = 0;
        queuedWithdrawShares = 0;

        Round storage r = rounds[n];
        r.ppsStart = pps;
        r.accStart = accPremium;
        r.start = SafeCast.toUint64(block.timestamp);

        // Tidak ada yang layak dijual: semua keluar, atau yang tersisa hanya debu pembulatan (di bawah setoran minimum).
        // Antrean tetap diproses, dan roll tidak membutuhkan harga oracle.
        if (totalShares == 0 || managedAssets < MIN_DEPOSIT) {
            r.outcome = Outcome.ClosedUnsold;
            emit RoundSkipped(n, pps);
            return;
        }

        (uint256 price,) = ROUTER.getPrice(address(ASSET)); // revert bila pasar tutup, harga basi, atau aset dijeda
        uint256 notional = managedAssets;
        r.expiry = expiry;
        r.strikeE18 = Math.mulDiv(price, BPS + otmBps, BPS, Math.Rounding.Ceil);
        r.startPriceE18 = price;
        r.notional = notional;
        r.minPremium = _minPremiumFor(notional, price);
        active = true;
        emit RoundStarted(n, expiry, r.strikeE18, price, notional, r.minPremium, pps, totalShares);
    }

    /// Dipanggil HarvestAuction setelah premium dari Picker dipindahkan ke vault.
    function recordSale(
        address picker,
        uint64 round_,
        uint256 strikeE18,
        uint64 expiry,
        uint256 notional,
        uint256 premium
    ) external override {
        if (msg.sender != AUCTION) revert NotAuction();
        if (!active) revert NotActive();
        Round storage r = rounds[round];
        if (round_ != round || strikeE18 != r.strikeE18 || expiry != r.expiry || notional != r.notional) {
            revert RoundMismatch();
        }
        if (r.picker != address(0)) revert AlreadySold();
        if (block.timestamp > uint256(r.start) + FILL_WINDOW) revert FillWindowClosed();
        if (premium == 0 || premium < r.minPremium) revert PremiumBelowFloor();
        if (PREMIUM.balanceOf(address(this)) < premiumHeld + premium) revert PremiumNotReceived();

        r.picker = picker;
        r.premium = premium;
        premiumHeld += premium;
        accPremium += Math.mulDiv(premium, MAG, totalShares);
        emit RoundSold(round, picker, premium);
    }

    /// Menutup round yang tidak laku setelah jendela penjualan habis. Siapa saja boleh memanggil.
    function closeUnsold() external nonReentrant {
        if (!active) revert NotActive();
        Round storage r = rounds[round];
        if (r.picker != address(0)) revert AlreadySold();
        if (block.timestamp <= uint256(r.start) + FILL_WINDOW) revert FillWindowOpen();
        active = false;
        r.outcome = Outcome.ClosedUnsold;
        emit RoundClosedUnsold(round);
    }

    /// Menutup round yang terjual setelah expiry memakai harga di `SettlementOracle`. Siapa saja boleh memanggil.
    /// Revert `SettlementUnavailable` sampai `SettlementOracle.settle` (atau `settleFallback`) dicatat untuk expiry ini.
    function settleRound() external nonReentrant {
        if (!active) revert NotActive();
        Round storage r = rounds[round];
        if (r.picker == address(0)) revert NotSold();
        if (block.timestamp < r.expiry) revert NotExpired();
        ISettlementOracle.Settlement memory s = SETTLEMENT.settlement(address(ASSET), r.expiry);
        if (!s.exists) revert SettlementUnavailable();

        uint256 price = s.priceE18;
        uint256 payout = price > r.strikeE18 ? Math.mulDiv(r.notional, price - r.strikeE18, price) : 0;
        if (payout != 0) {
            managedAssets -= payout; // payout < notional <= managedAssets
            totalPickerOwed += payout;
            pickerOwed[r.picker] += payout;
        }
        r.settlePriceE18 = price;
        r.payout = payout;
        r.outcome = Outcome.Settled;
        active = false;
        emit RoundSettled(round, price, payout);
    }

    /// Picker menarik Stock Token hasil opsi yang berakhir in-the-money.
    function claimPickerPayout() external nonReentrant {
        uint256 amount = pickerOwed[msg.sender];
        if (amount == 0) revert NothingToClaim();
        pickerOwed[msg.sender] = 0;
        totalPickerOwed -= amount;
        ASSET.safeTransfer(msg.sender, amount);
        emit PickerPayoutClaimed(msg.sender, amount);
    }

    // =====================================================================================
    // Admin
    // =====================================================================================

    function setOtmBps(uint16 bps) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (bps < MIN_OTM_BPS || bps > MAX_OTM_BPS) revert InvalidConfig();
        otmBps = bps;
        emit OtmBpsSet(bps);
    }

    function setMinPremiumBps(uint16 bps) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (bps > MAX_MIN_PREMIUM_BPS) revert InvalidConfig();
        minPremiumBps = bps;
        emit MinPremiumBpsSet(bps);
    }

    function setDepositCap(uint256 cap) external onlyRole(DEFAULT_ADMIN_ROLE) {
        depositCap = cap;
        emit DepositCapSet(cap);
    }

    /// GUARDIAN atau ADMIN. Hanya menutup `deposit` dan `rollRound`.
    function pause() external {
        if (!hasRole(Roles.GUARDIAN_ROLE, msg.sender) && !hasRole(DEFAULT_ADMIN_ROLE, msg.sender)) {
            revert NotGuardian();
        }
        _pause();
    }

    function unpause() external onlyRole(DEFAULT_ADMIN_ROLE) {
        _unpause();
    }

    // =====================================================================================
    // Tampilan
    // =====================================================================================

    /// Share akun termasuk setoran yang sudah diproses roll tetapi belum disinkron, dan sudah dikurangi
    /// penarikan yang sudah diproses roll.
    function sharesOf(address account) external view returns (uint256 sh) {
        (sh,,) = _preview(account);
    }

    /// Nilai Stock Token dari share akun pada harga per share saat ini (belum memperhitungkan opsi yang berjalan).
    function assetsOf(address account) external view returns (uint256) {
        (uint256 sh,,) = _preview(account);
        return totalShares == 0 ? 0 : Math.mulDiv(sh, managedAssets, totalShares);
    }

    /// Premium USDG yang bisa diklaim sekarang.
    function pendingPremium(address account) external view returns (uint256) {
        (uint256 sh, int256 co,) = _preview(account);
        return _premiumOwed(sh, co) - premiumClaimed[account];
    }

    /// Stock Token dari penarikan yang sudah diproses dan bisa diambil (`claimWithdraw`).
    function pendingWithdrawAssets(address account) external view returns (uint256 cl) {
        (,, cl) = _preview(account);
    }

    /// Seluruh data satu round (untuk UI, indexer, dan SDK).
    function getRound(uint64 n) external view returns (Round memory) {
        return rounds[n];
    }

    /// Aset per share (WAD) bila roll terjadi sekarang.
    function pricePerShare() external view returns (uint256) {
        return totalShares == 0 ? WAD : Math.mulDiv(managedAssets, WAD, totalShares);
    }

    // =====================================================================================
    // Internal
    // =====================================================================================

    function _minPremiumFor(uint256 notional, uint256 priceE18) internal view returns (uint256) {
        if (minPremiumBps == 0) return 0;
        uint256 usdAssetDec = Math.mulDiv(notional, priceE18, WAD); // nilai USD dengan desimal aset
        uint256 usdPremiumDec = Math.mulDiv(usdAssetDec, 10 ** PREMIUM_DECIMALS, 10 ** ASSET_DECIMALS);
        return Math.mulDiv(usdPremiumDec, minPremiumBps, BPS, Math.Rounding.Ceil);
    }

    function _premiumOwed(uint256 sh, int256 co) internal view returns (uint256) {
        int256 v = SafeCast.toInt256(accPremium * sh) + co;
        return v <= 0 ? 0 : uint256(v) / MAG;
    }

    /// Keadaan akun bila semua receipt yang sudah diproses roll dikonversi sekarang.
    function _preview(address account) internal view returns (uint256 sh, int256 co, uint256 cl) {
        sh = _shares[account];
        co = _corr[account];
        cl = claimableAssets[account];

        DepositReceipt memory d = depositOf[account];
        if (d.amount != 0 && d.round <= round) {
            Round storage r = rounds[d.round];
            uint256 s = Math.mulDiv(d.amount, WAD, r.ppsStart);
            sh += s;
            co -= SafeCast.toInt256(r.accStart * s); // berhak atas premium sejak roll tersebut
        }
        WithdrawReceipt memory w = withdrawOf[account];
        if (w.shares != 0 && w.round <= round) {
            Round storage r = rounds[w.round];
            sh -= w.shares;
            co += SafeCast.toInt256(r.accStart * w.shares); // tidak berhak atas premium sejak roll tersebut
            cl += Math.mulDiv(w.shares, r.ppsStart, WAD);
        }
    }

    function _sync(address account) internal {
        (uint256 sh, int256 co, uint256 cl) = _preview(account);
        _shares[account] = sh;
        _corr[account] = co;
        claimableAssets[account] = cl;
        DepositReceipt storage d = depositOf[account];
        if (d.amount != 0 && d.round <= round) delete depositOf[account];
        WithdrawReceipt storage w = withdrawOf[account];
        if (w.shares != 0 && w.round <= round) delete withdrawOf[account];
    }
}
