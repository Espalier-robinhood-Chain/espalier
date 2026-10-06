// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {IOracleRouter} from "./interfaces/IOracleRouter.sol";

/// @title CordonVault
/// @notice Basket Stock Token (mis. cMAG7). Share ERC-20 adalah klaim proporsional atas saldo semua komponen.
/// @dev Fase 2 item 4, bagian yang TIDAK butuh DEX:
///      - `seed`: deposit awal treasury (hanya saat supply 0), menentukan satuan share.
///      - `mint(shares, to, maxAmounts)`: penyetor membayar komponen secara proporsional terhadap saldo vault
///        (dibulatkan ke atas), diukur dari saldo yang benar-benar diterima. Tanpa oracle dan tanpa DEX.
///      - `redeem(shares, to, componentMask, minAmounts)`: bakar share, terima komponen proporsional (dibulatkan
///        ke bawah). Komponen di luar `componentMask` TIDAK diambil dan tetap di vault untuk pemegang lain, supaya
///        satu token yang bermasalah (di-pause/diblokir) tidak membekukan keluar dari komponen lain.
///      - `tryNav`/`nav`: nilai USD memakai `OracleRouter.getReferencePrice` (boleh saat sesi Closed).
///      Karena mint dan redeem proporsional, keduanya tidak bergantung pada harga: tidak ada celah manipulasi
///      oracle dan redeem tidak bisa dibekukan oracle. Pembulatan selalu menguntungkan vault.
///      Item 5 (fee, peran, jeda):
///      - Fee SELALU dibayar dalam share, bukan token, supaya tidak ada penjualan komponen dan tidak ada pengenceran
///        bagi pemegang lain. Mint: penyetor menerima tepat `shares` dan membayar komponen untuk `shares + fee`;
///        `fee` (dibulatkan ke atas) dicetak ke `feeRecipient`. Redeem: dari `shares` yang diserahkan, `fee`
///        (dibulatkan ke atas) dipindah ke `feeRecipient`, sisanya dibakar dan ditebus.
///      - Fee manajemen mengalir (streaming): tiap sentuhan state mencetak share ke `feeRecipient` sehingga
///        penerima memegang `bps x waktu / tahun` dari supply (sederhana, tanpa compounding). Fee tahunan dan fee
///        mint/redeem punya batas hardcode (`MAX_*_FEE_BPS`) dan semua bernilai 0 sampai ADMIN mengubahnya.
///      - ADMIN = `DEFAULT_ADMIN_ROLE` (di produksi: TimelockController 48 jam): `setFees`, `setFeeRecipient`, `seed`.
///      - Jeda per aset ada di OracleRouter (`pauseAsset`, GUARDIAN/ADMIN): `mint` ditolak bila SALAH SATU komponen
///        dijeda. `redeem` TIDAK PERNAH ditutup oleh peran mana pun (keluar in-kind tidak butuh oracle).
///      BELUM ADA (item lain): mint/redeem lewat USDG (butuh `IExecutionVenue`, Fase 3 item 1, dan riset likuiditas
///      DEX, Fase 0 item 5), Pruning dan peran KEEPER di vault ini (Fase 3).
///      Bobot target hanya informasi (dipakai UI dan Pruning nanti); komposisi sebenarnya mengikuti saldo.
contract CordonVault is ERC20, AccessControl, ReentrancyGuard {
    using SafeERC20 for IERC20;

    uint256 public constant MAX_COMPONENTS = 16;
    uint256 public constant BPS = 10_000;
    /// Seed minimal agar satuan share tidak dapat dimanipulasi dengan donasi sesudahnya.
    uint256 public constant MIN_SEED_SHARES = 1e18;

    /// Batas atas hardcode fee (bps). Angka ini USULAN saya, belum disetujui; ADMIN tidak bisa melewatinya.
    uint16 public constant MAX_MINT_FEE_BPS = 100; // 1,00% dari share yang diterima
    uint16 public constant MAX_REDEEM_FEE_BPS = 100; // 1,00% dari share yang ditebus
    uint16 public constant MAX_MANAGEMENT_FEE_BPS = 200; // 2,00% per tahun
    uint256 public constant YEAR = 365 days;
    /// Waktu maksimum yang diakru dalam satu sentuhan (jaga pembagi tetap positif); lebih lama = fee terkurangi.
    uint256 public constant MAX_ACCRUAL_PERIOD = 5 * 365 days;

    uint16 public mintFeeBps;
    uint16 public redeemFeeBps;
    uint16 public managementFeeBps;
    /// Penerima fee. Selama `address(0)` semua fee harus 0.
    address public feeRecipient;
    /// Waktu terakhir fee manajemen diakru (hanya bermakna bila supply > 0).
    uint256 public lastAccrual;

    IOracleRouter public immutable ROUTER;

    address[] private _components;
    uint8[] private _decimals;
    uint16[] private _targetBps;

    event Seeded(address indexed by, address indexed to, uint256 shares, uint256[] amounts);
    /// `shares` = yang diterima `to`; `feeShares` = tambahan yang dicetak ke `feeRecipient`.
    event Minted(address indexed by, address indexed to, uint256 shares, uint256 feeShares, uint256[] amounts);
    /// `shares` = total yang diserahkan pemanggil; `feeShares` = bagian yang dipindah ke `feeRecipient`.
    event Redeemed(
        address indexed by, address indexed to, uint256 shares, uint256 feeShares, uint256 mask, uint256[] amounts
    );
    event FeesSet(uint16 mintFeeBps, uint16 redeemFeeBps, uint16 managementFeeBps);
    event FeeRecipientSet(address indexed recipient);
    event ManagementFeeAccrued(address indexed recipient, uint256 shares);

    error ZeroAddress();
    error InvalidComponents();
    error InvalidWeights();
    error AlreadySeeded();
    error NotSeeded();
    error SeedTooSmall();
    error ZeroAmount();
    error LengthMismatch();
    error SlippageExceeded(uint256 index, uint256 amount, uint256 limit);
    error ShortReceipt(uint256 index, uint256 received, uint256 required);
    error InvalidMask();
    error PriceUnavailable(uint256 index, IOracleRouter.Status status);
    error FeeTooHigh();
    error FeeRecipientRequired();
    error InvalidFeeRecipient();
    error AssetPaused(address token);

    constructor(
        address admin,
        address router_,
        string memory name_,
        string memory symbol_,
        address[] memory components_,
        uint16[] memory targetBps_
    ) ERC20(name_, symbol_) {
        if (admin == address(0) || router_ == address(0)) revert ZeroAddress();
        if (router_.code.length == 0) revert InvalidComponents();
        uint256 n = components_.length;
        if (n == 0 || n > MAX_COMPONENTS) revert InvalidComponents();
        if (targetBps_.length != n) revert LengthMismatch();

        uint256 sum;
        for (uint256 i; i < n; ++i) {
            address c = components_[i];
            if (c == address(0) || c.code.length == 0 || c == address(this)) revert InvalidComponents();
            for (uint256 j; j < i; ++j) {
                if (components_[j] == c) revert InvalidComponents();
            }
            if (targetBps_[i] == 0) revert InvalidWeights();
            sum += targetBps_[i];
            uint8 d = IERC20Metadata(c).decimals();
            if (d > 18) revert InvalidComponents();
            _components.push(c);
            _decimals.push(d);
            _targetBps.push(targetBps_[i]);
        }
        if (sum != BPS) revert InvalidWeights();

        ROUTER = IOracleRouter(router_);
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
    }

    // ----------------------------------------------------------------- views

    function componentCount() external view returns (uint256) {
        return _components.length;
    }

    function components() external view returns (address[] memory) {
        return _components;
    }

    function targetWeightsBps() external view returns (uint16[] memory) {
        return _targetBps;
    }

    /// Saldo tiap komponen yang dipegang vault.
    function balances() public view returns (uint256[] memory b) {
        uint256 n = _components.length;
        b = new uint256[](n);
        for (uint256 i; i < n; ++i) {
            b[i] = IERC20(_components[i]).balanceOf(address(this));
        }
    }

    /// Fee mint dalam share untuk `shares` yang diterima (dibulatkan ke atas, menguntungkan penerima fee).
    function feeOnMint(uint256 shares) public view returns (uint256) {
        return Math.mulDiv(shares, mintFeeBps, BPS, Math.Rounding.Ceil);
    }

    /// Fee redeem dalam share untuk `shares` yang diserahkan (dibulatkan ke atas).
    function feeOnRedeem(uint256 shares) public view returns (uint256) {
        return Math.mulDiv(shares, redeemFeeBps, BPS, Math.Rounding.Ceil);
    }

    /// Share fee manajemen yang sudah terutang tetapi belum dicetak.
    function pendingManagementFeeShares() external view returns (uint256) {
        return _pendingFeeShares(totalSupply());
    }

    /// Supply termasuk fee manajemen yang belum dicetak; dasar semua preview dan NAV.
    function effectiveSupply() public view returns (uint256) {
        uint256 s = totalSupply();
        return s + _pendingFeeShares(s);
    }

    /// Komponen pertama yang dijeda di OracleRouter (address(0) bila tidak ada). Selama ada, `mint` ditolak.
    function mintPausedBy() public view returns (address) {
        uint256 n = _components.length;
        for (uint256 i; i < n; ++i) {
            if (ROUTER.isAssetPaused(_components[i])) return _components[i];
        }
        return address(0);
    }

    /// Jumlah tiap komponen yang harus disetor agar menerima tepat `shares` (sudah termasuk fee mint dan fee
    /// manajemen yang terutang; dibulatkan ke atas, menguntungkan vault).
    function previewMint(uint256 shares) public view returns (uint256[] memory amounts) {
        uint256 s = totalSupply();
        if (s == 0) revert NotSeeded();
        uint256 eff = s + _pendingFeeShares(s);
        uint256 gross = shares + feeOnMint(shares);
        amounts = balances();
        for (uint256 i; i < amounts.length; ++i) {
            amounts[i] = Math.mulDiv(gross, amounts[i], eff, Math.Rounding.Ceil);
        }
    }

    /// Jumlah tiap komponen yang diterima bila `shares` diserahkan dan semua komponen diambil (setelah fee redeem
    /// dan fee manajemen yang terutang; dibulatkan ke bawah).
    function previewRedeem(uint256 shares) public view returns (uint256[] memory amounts) {
        uint256 s = totalSupply();
        amounts = balances();
        if (s == 0) return amounts; // tidak ada klaim
        uint256 eff = s + _pendingFeeShares(s);
        uint256 net = shares - feeOnRedeem(shares);
        for (uint256 i; i < amounts.length; ++i) {
            amounts[i] = Math.mulDiv(net, amounts[i], eff);
        }
    }

    /// Nilai total (USD, 18 desimal) dan NAV per share (USD, 18 desimal) dengan harga ACUAN router.
    /// ok = false bila ada komponen tanpa harga valid (jangan dipakai untuk keputusan).
    function tryNav() public view returns (bool ok, uint256 totalValueE18, uint256 navPerShareE18) {
        uint256 n = _components.length;
        for (uint256 i; i < n; ++i) {
            (IOracleRouter.Status st, uint256 price,,) = ROUTER.tryGetReferencePrice(_components[i]);
            if (st != IOracleRouter.Status.Ok) return (false, 0, 0);
            uint256 bal = IERC20(_components[i]).balanceOf(address(this));
            totalValueE18 += Math.mulDiv(bal, price, 10 ** _decimals[i]);
        }
        uint256 s = effectiveSupply();
        navPerShareE18 = s == 0 ? 0 : Math.mulDiv(totalValueE18, 1e18, s);
        return (true, totalValueE18, navPerShareE18);
    }

    /// Seperti `tryNav` tetapi revert `PriceUnavailable(index, status)` untuk komponen pertama yang bermasalah.
    function nav() external view returns (uint256 totalValueE18, uint256 navPerShareE18) {
        uint256 n = _components.length;
        for (uint256 i; i < n; ++i) {
            (IOracleRouter.Status st, uint256 price,,) = ROUTER.tryGetReferencePrice(_components[i]);
            if (st != IOracleRouter.Status.Ok) revert PriceUnavailable(i, st);
            uint256 bal = IERC20(_components[i]).balanceOf(address(this));
            totalValueE18 += Math.mulDiv(bal, price, 10 ** _decimals[i]);
        }
        uint256 s = effectiveSupply();
        navPerShareE18 = s == 0 ? 0 : Math.mulDiv(totalValueE18, 1e18, s);
    }

    // ----------------------------------------------------------------- aksi

    /// Deposit awal treasury; hanya saat supply 0. Menentukan satuan share (jumlah share bebas, min `MIN_SEED_SHARES`).
    /// Saldo komponen yang sudah ada (donasi) ikut menjadi milik seeder.
    function seed(uint256 shares, address to, uint256[] calldata amounts)
        external
        onlyRole(DEFAULT_ADMIN_ROLE)
        nonReentrant
    {
        if (totalSupply() != 0) revert AlreadySeeded();
        _accrue(); // supply 0: hanya memulai jam fee manajemen
        if (shares < MIN_SEED_SHARES) revert SeedTooSmall();
        if (to == address(0)) revert ZeroAddress();
        uint256 n = _components.length;
        if (amounts.length != n) revert LengthMismatch();
        for (uint256 i; i < n; ++i) {
            if (amounts[i] == 0) revert ZeroAmount();
            _pull(i, amounts[i]);
        }
        _mint(to, shares);
        emit Seeded(msg.sender, to, shares, amounts);
    }

    /// Cetak tepat `shares` untuk `to`; penyetor membayar `previewMint(shares)` per komponen (termasuk fee mint),
    /// tiap jumlah <= `maxAmounts[i]`. Fee mint dicetak ke `feeRecipient` di atas `shares`.
    function mint(uint256 shares, address to, uint256[] calldata maxAmounts)
        external
        nonReentrant
        returns (uint256[] memory amounts)
    {
        if (shares == 0) revert ZeroAmount();
        if (to == address(0)) revert ZeroAddress();
        if (maxAmounts.length != _components.length) revert LengthMismatch();
        if (totalSupply() == 0) revert NotSeeded();
        address paused = mintPausedBy();
        if (paused != address(0)) revert AssetPaused(paused);

        _accrue(); // fee manajemen sampai sekarang dicetak lebih dulu; penyetor baru tidak menanggung masa lalu
        uint256 fee = feeOnMint(shares);
        amounts = previewMint(shares);
        for (uint256 i; i < amounts.length; ++i) {
            if (amounts[i] > maxAmounts[i]) revert SlippageExceeded(i, amounts[i], maxAmounts[i]);
            if (amounts[i] == 0) continue; // komponen dengan saldo 0 (setelah redeem selektif): tidak ada yang disetor
            _pull(i, amounts[i]);
        }
        _mint(to, shares);
        if (fee != 0) _mint(feeRecipient, fee);
        emit Minted(msg.sender, to, shares, fee, amounts);
    }

    /// Serahkan `shares` milik pemanggil: `feeOnRedeem(shares)` dipindah ke `feeRecipient`, sisanya dibakar dan
    /// komponen proporsional dikirim untuk bit yang menyala di `componentMask` (bit i = komponen i). Komponen yang
    /// tidak dipilih tetap di vault (klaimnya dilepas). Tiap jumlah diterima harus >= `minAmounts[i]` (isi 0 untuk
    /// komponen yang tidak dipilih). Tidak pernah ditolak karena jeda aset.
    function redeem(uint256 shares, address to, uint256 componentMask, uint256[] calldata minAmounts)
        external
        nonReentrant
        returns (uint256[] memory amounts)
    {
        if (shares == 0) revert ZeroAmount();
        if (to == address(0)) revert ZeroAddress();
        uint256 n = _components.length;
        if (minAmounts.length != n) revert LengthMismatch();
        if (componentMask == 0 || componentMask >> n != 0) revert InvalidMask();

        _accrue(); // fee manajemen sampai sekarang dicetak lebih dulu; yang keluar ikut menanggungnya
        uint256 fee = feeOnRedeem(shares);
        amounts = previewRedeem(shares); // dihitung sebelum burn, dari share bersih setelah fee
        _burn(msg.sender, shares - fee);
        if (fee != 0) _transfer(msg.sender, feeRecipient, fee);
        for (uint256 i; i < n; ++i) {
            if (componentMask & (1 << i) == 0) {
                amounts[i] = 0;
                if (minAmounts[i] != 0) revert SlippageExceeded(i, 0, minAmounts[i]);
                continue;
            }
            if (amounts[i] < minAmounts[i]) revert SlippageExceeded(i, amounts[i], minAmounts[i]);
            if (amounts[i] != 0) IERC20(_components[i]).safeTransfer(to, amounts[i]);
        }
        emit Redeemed(msg.sender, to, shares, fee, componentMask, amounts);
    }

    // ------------------------------------------------------------ admin fee

    /// Atur fee (semua <= batas hardcode). Fee manajemen lama diakru sampai sekarang sebelum tarif berganti.
    /// Bila ada fee > 0, `feeRecipient` harus sudah diisi.
    function setFees(uint16 mintFeeBps_, uint16 redeemFeeBps_, uint16 managementFeeBps_)
        external
        onlyRole(DEFAULT_ADMIN_ROLE)
        nonReentrant
    {
        if (
            mintFeeBps_ > MAX_MINT_FEE_BPS || redeemFeeBps_ > MAX_REDEEM_FEE_BPS
                || managementFeeBps_ > MAX_MANAGEMENT_FEE_BPS
        ) revert FeeTooHigh();
        if ((mintFeeBps_ | redeemFeeBps_ | managementFeeBps_) != 0 && feeRecipient == address(0)) {
            revert FeeRecipientRequired();
        }
        _accrue();
        mintFeeBps = mintFeeBps_;
        redeemFeeBps = redeemFeeBps_;
        managementFeeBps = managementFeeBps_;
        emit FeesSet(mintFeeBps_, redeemFeeBps_, managementFeeBps_);
    }

    /// Ganti penerima fee. Fee manajemen yang sudah terutang dicetak ke penerima LAMA lebih dulu. Tidak bisa
    /// dikosongkan dan tidak bisa berupa vault ini sendiri (share akan terkunci).
    function setFeeRecipient(address recipient) external onlyRole(DEFAULT_ADMIN_ROLE) nonReentrant {
        if (recipient == address(0) || recipient == address(this)) revert InvalidFeeRecipient();
        _accrue();
        feeRecipient = recipient;
        emit FeeRecipientSet(recipient);
    }

    /// Cetak fee manajemen yang terutang. Siapa pun boleh memanggil (tidak ada yang bisa dirugikan: jumlahnya
    /// ditentukan waktu dan tarif).
    function accrueManagementFee() external nonReentrant {
        _accrue();
    }

    // -------------------------------------------------------------- internal

    /// Share fee manajemen terutang untuk supply `s`: penerima berakhir memegang f = bps x dt / (BPS x YEAR) dari
    /// supply baru, jadi cetak s x f / (1 - f) = s x bps x dt / (BPS x YEAR - bps x dt), dibulatkan ke bawah.
    function _pendingFeeShares(uint256 s) internal view returns (uint256) {
        uint256 bps = managementFeeBps;
        if (bps == 0 || s == 0) return 0;
        uint256 dt = block.timestamp - lastAccrual;
        if (dt == 0) return 0;
        if (dt > MAX_ACCRUAL_PERIOD) dt = MAX_ACCRUAL_PERIOD;
        uint256 num = bps * dt;
        return Math.mulDiv(s, num, BPS * YEAR - num);
    }

    /// Cetak fee manajemen terutang ke `feeRecipient`. Jam hanya dimajukan bila ada yang dicetak (atau tidak ada
    /// tarif / supply), supaya pembulatan ke 0 pada panggilan beruntun tidak bisa dipakai menghindari fee.
    function _accrue() internal {
        uint256 s = totalSupply();
        if (s == 0 || managementFeeBps == 0) {
            lastAccrual = block.timestamp;
            return;
        }
        uint256 shares = _pendingFeeShares(s);
        if (shares == 0) return;
        lastAccrual = block.timestamp;
        _mint(feeRecipient, shares); // tarif > 0 menjamin feeRecipient terisi (lihat setFees)
        emit ManagementFeeAccrued(feeRecipient, shares);
    }

    /// Tarik `required` dari pemanggil; saldo yang benar-benar masuk harus >= `required` (token dengan fee ditolak).
    function _pull(uint256 i, uint256 required) internal {
        IERC20 t = IERC20(_components[i]);
        uint256 before = t.balanceOf(address(this));
        t.safeTransferFrom(msg.sender, address(this), required);
        uint256 got = t.balanceOf(address(this)) - before;
        if (got < required) revert ShortReceipt(i, got, required);
    }
}
