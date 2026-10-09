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
import {IExecutionVenue} from "./interfaces/IExecutionVenue.sol";
import {IPruneVenue} from "./interfaces/IPruneVenue.sol";
import {Roles} from "./libraries/Roles.sol";

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
///      Redeem ke USDG (`redeemToUsdg`) memakai `IExecutionVenue` yang dipasang ADMIN lewat `setExecutionVenue`; mati
///      (VenueNotSet) sampai venue dipasang. Untuk mainnet perlu venue DEX sungguhan (riset likuiditas, Fase 0 item 5).
///      Pruning (`prune`, peran KEEPER): mengembalikan komposisi ke bobot target lewat `IPruneVenue` yang dipasang ADMIN.
///      Keeper hanya memilih pasangan token dan jumlah; keamanannya dipaksa di kontrak, bukan dipercayakan ke keeper:
///        - hanya saat SEMUA komponen punya harga LIVE (pasar buka, harga segar, tidak dijeda);
///        - tiap swap harus menghasilkan >= nilai oracle dikurangi `pruneSlippageBps` (diukur dari saldo yang benar-benar
///          masuk, bukan dari angka venue), dan keeper boleh menuntut lebih ketat lewat `minOut`;
///        - drift maksimum sesudah HARUS lebih kecil daripada sebelum (strict), jadi trade yang tidak memperbaiki ditolak;
///        - jarak antar pruning minimal `MIN_PRUNE_INTERVAL`, supaya kunci keeper yang bocor tidak bisa menguras
///          vault lewat putaran trade berulang (kerugian terbatas pada slippage yang diizinkan x nilai yang diputar).
///      Mati (`PruneNotConfigured`) sampai ADMIN memasang venue DAN `pruneSlippageBps` > 0.
///      BELUM ADA (item lain): mint lewat USDG (Fase 3).
///      Bobot target dipakai UI dan Pruning; komposisi sebenarnya mengikuti saldo.
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

    /// Batas atas hardcode slippage pruning (bps terhadap harga oracle). USULAN, belum disetujui; ADMIN tidak bisa melewatinya.
    uint16 public constant MAX_PRUNE_SLIPPAGE_BPS = 300;
    /// Jarak minimum antar pruning (hardcode). Jadwal sebenarnya (bulanan) dijaga keeper; ini hanya pagar kontrak.
    uint256 public constant MIN_PRUNE_INTERVAL = 1 days;
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

    /// Venue untuk menjual komponen ke USDG (`redeemToUsdg`). address(0) = fitur mati; redeem in-kind selalu tersedia.
    IExecutionVenue public executionVenue;
    /// USDG milik venue yang terpasang (0 bila tidak ada venue).
    address public usdgToken;

    /// Venue untuk pruning (`prune`). address(0) = pruning mati.
    IPruneVenue public pruneVenue;
    /// Slippage maksimum tiap swap pruning terhadap harga oracle live (bps). 0 = pruning mati.
    uint16 public pruneSlippageBps;
    /// Waktu pruning terakhir (0 = belum pernah).
    uint256 public lastPrune;

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
    /// Venue USDG dipasang atau dimatikan (venue = 0 dan usdg = 0 berarti mati).
    event ExecutionVenueSet(address indexed venue, address indexed usdg);
    event RedeemedToUsdg(
        address indexed by, address indexed to, uint256 shares, uint256 feeShares, uint256 usdgOut, uint256[] amounts
    );
    event ManagementFeeAccrued(address indexed recipient, uint256 shares);
    /// Venue pruning dipasang atau dimatikan (venue = 0 berarti mati).
    event PruneVenueSet(address indexed venue);
    event PruneSlippageSet(uint16 bps);
    /// Satu swap pruning: yang benar-benar keluar dan masuk menurut saldo vault.
    event PruneSwap(address indexed tokenIn, address indexed tokenOut, uint256 amountIn, uint256 amountOut);
    /// Satu pruning selesai. Drift = selisih terbesar bobot sebenarnya dan target (bps), pada harga live.
    event Pruned(uint256 driftBeforeBps, uint256 driftAfterBps, uint256 trades);

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
    /// `redeemToUsdg` / `previewRedeemToUsdg` dipanggil padahal belum ada venue.
    error VenueNotSet();
    /// Venue tidak valid: bukan kontrak, vault sendiri, atau USDG-nya salah satu komponen vault.
    error InvalidVenue();
    /// USDG yang diterima kurang dari `minimum`.
    error UsdgSlippage(uint256 received, uint256 minimum);
    /// `prune` dipanggil padahal venue pruning atau slippage pruning belum diatur ADMIN.
    error PruneNotConfigured();
    /// Venue pruning tidak valid: bukan kontrak atau vault sendiri.
    error InvalidPruneVenue();
    error InvalidTrade(uint256 index);
    /// Pruning terakhir terlalu baru; boleh lagi pada `nextAt`.
    error PruneTooSoon(uint256 nextAt);
    /// Venue tidak menarik tepat `amountIn` dari komponen yang dijual.
    error PruneShortSpend(uint256 index, uint256 spent, uint256 expected);
    /// Hasil swap kurang dari batas: nilai oracle - slippage kontrak, atau `minOut` dari keeper (mana yang lebih ketat).
    error PruneSlippageExceeded(uint256 index, uint256 received, uint256 minimum);
    /// Drift maksimum sesudah pruning tidak lebih kecil daripada sebelum.
    error DriftNotReduced(uint256 beforeBps, uint256 afterBps);

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

    /// USDG yang diterima bila `shares` ditebus dan semua komponen dijual sekarang lewat venue (setelah fee redeem dan fee
    /// manajemen terutang). Memakai harga LIVE: revert bila pasar tutup atau harga tidak segar. Revert `VenueNotSet` bila mati.
    function previewRedeemToUsdg(uint256 shares) public view returns (uint256 usdgOut) {
        IExecutionVenue venue = executionVenue;
        if (address(venue) == address(0)) revert VenueNotSet();
        address[] memory comps = _components;
        return venue.quoteSell(comps, previewRedeem(shares));
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

    /// Drift maksimum (bps) antara bobot sebenarnya dan bobot target pada harga LIVE. ok = false bila ada komponen
    /// tanpa harga live (pasar tutup, basi, dijeda) atau vault kosong; jangan dipakai untuk keputusan saat itu.
    function tryDriftBps() external view returns (bool ok, uint256 driftBps) {
        uint256 n = _components.length;
        uint256[] memory prices = new uint256[](n);
        for (uint256 i; i < n; ++i) {
            (IOracleRouter.Status st, uint256 price,) = ROUTER.tryGetPrice(_components[i]);
            if (st != IOracleRouter.Status.Ok) return (false, 0);
            prices[i] = price;
        }
        uint256 total;
        uint256[] memory vals;
        (vals, total) = _values(prices);
        if (total == 0) return (false, 0);
        return (true, _drift(vals, total));
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

    /// Seperti `redeem` dengan semua komponen, tetapi komponen dijual lewat venue dan pemanggil menerima USDG di `to`.
    /// Fee redeem tetap dibayar dalam share. Revert `UsdgSlippage` bila USDG yang benar-benar diterima < `minUsdg`
    /// (diukur dari saldo `to`, bukan dari angka yang dilaporkan venue). Butuh harga live, jadi gagal saat pasar tutup.
    function redeemToUsdg(uint256 shares, address to, uint256 minUsdg)
        external
        nonReentrant
        returns (uint256 usdgOut, uint256[] memory amounts)
    {
        IExecutionVenue venue = executionVenue;
        if (address(venue) == address(0)) revert VenueNotSet();
        if (shares == 0) revert ZeroAmount();
        if (to == address(0)) revert ZeroAddress();

        _accrue();
        uint256 fee = feeOnRedeem(shares);
        amounts = previewRedeem(shares); // dihitung sebelum burn, dari share bersih setelah fee
        _burn(msg.sender, shares - fee);
        if (fee != 0) _transfer(msg.sender, feeRecipient, fee);

        address[] memory comps = _components;
        for (uint256 i; i < comps.length; ++i) {
            if (amounts[i] != 0) IERC20(comps[i]).forceApprove(address(venue), amounts[i]);
        }
        IERC20 usdg = IERC20(usdgToken);
        uint256 before = usdg.balanceOf(to);
        venue.sell(comps, amounts, to);
        usdgOut = usdg.balanceOf(to) - before;
        for (uint256 i; i < comps.length; ++i) {
            if (amounts[i] != 0) IERC20(comps[i]).forceApprove(address(venue), 0); // bersihkan sisa allowance
        }
        if (usdgOut < minUsdg) revert UsdgSlippage(usdgOut, minUsdg);
        emit RedeemedToUsdg(msg.sender, to, shares, fee, usdgOut, amounts);
    }

    // ------------------------------------------------------------ admin venue

    /// Pasang venue USDG (atau matikan dengan address(0)). Venue harus kontrak, bukan vault ini, dan USDG-nya harus
    /// kontrak yang bukan salah satu komponen vault. Redeem in-kind tidak terpengaruh.
    function setExecutionVenue(address venue) external onlyRole(DEFAULT_ADMIN_ROLE) nonReentrant {
        if (venue == address(0)) {
            executionVenue = IExecutionVenue(address(0));
            usdgToken = address(0);
            emit ExecutionVenueSet(address(0), address(0));
            return;
        }
        if (venue == address(this) || venue.code.length == 0) revert InvalidVenue();
        address usdg;
        try IExecutionVenue(venue).USDG() returns (address u) {
            usdg = u;
        } catch {
            revert InvalidVenue();
        }
        if (usdg == address(0) || usdg == address(this) || usdg.code.length == 0) revert InvalidVenue();
        uint256 n = _components.length;
        for (uint256 i; i < n; ++i) {
            if (_components[i] == usdg) revert InvalidVenue();
        }
        executionVenue = IExecutionVenue(venue);
        usdgToken = usdg;
        emit ExecutionVenueSet(venue, usdg);
    }

    // ---------------------------------------------------------------- pruning

    /// Satu swap pruning. `tokenIn`/`tokenOut` = indeks komponen (urutan `components()`).
    /// `minOut` = batas minimum dari keeper (boleh 0); batas kontrak dari oracle tetap berlaku.
    struct PruneTrade {
        uint256 tokenIn;
        uint256 tokenOut;
        uint256 amountIn;
        uint256 minOut;
    }

    /// Kembalikan komposisi ke bobot target. Hanya KEEPER. Lihat catatan kontrak untuk pagar yang dipaksa di sini.
    function prune(PruneTrade[] calldata trades) external onlyRole(Roles.KEEPER_ROLE) nonReentrant {
        IPruneVenue venue = pruneVenue;
        uint16 slip = pruneSlippageBps;
        if (address(venue) == address(0) || slip == 0) revert PruneNotConfigured();
        uint256 n = _components.length;
        if (trades.length == 0 || trades.length > MAX_COMPONENTS) revert InvalidTrade(trades.length);
        if (totalSupply() == 0) revert NotSeeded();
        uint256 last = lastPrune;
        if (last != 0 && block.timestamp < last + MIN_PRUNE_INTERVAL) revert PruneTooSoon(last + MIN_PRUNE_INTERVAL);

        uint256[] memory prices = new uint256[](n);
        for (uint256 i; i < n; ++i) {
            (IOracleRouter.Status st, uint256 price,) = ROUTER.tryGetPrice(_components[i]);
            if (st != IOracleRouter.Status.Ok) revert PriceUnavailable(i, st);
            prices[i] = price;
        }
        (uint256[] memory vals, uint256 total) = _values(prices);
        uint256 driftBefore = _drift(vals, total);

        for (uint256 k; k < trades.length; ++k) {
            _pruneSwap(k, trades[k], venue, slip, prices);
        }

        (vals, total) = _values(prices);
        uint256 driftAfter = _drift(vals, total);
        if (driftAfter >= driftBefore) revert DriftNotReduced(driftBefore, driftAfter);
        lastPrune = block.timestamp;
        emit Pruned(driftBefore, driftAfter, trades.length);
    }

    function _pruneSwap(uint256 k, PruneTrade calldata t, IPruneVenue venue, uint16 slip, uint256[] memory prices)
        internal
    {
        uint256 n = _components.length;
        if (t.tokenIn >= n || t.tokenOut >= n || t.tokenIn == t.tokenOut || t.amountIn == 0) revert InvalidTrade(k);
        IERC20 tin = IERC20(_components[t.tokenIn]);
        IERC20 tout = IERC20(_components[t.tokenOut]);

        // Batas dari oracle: nilai yang dijual (harga live) dikurangi slippage kontrak, dalam satuan tokenOut.
        uint256 expected = Math.mulDiv(
            t.amountIn * prices[t.tokenIn], 10 ** _decimals[t.tokenOut], prices[t.tokenOut] * 10 ** _decimals[t.tokenIn]
        );
        uint256 floor = Math.mulDiv(expected, BPS - slip, BPS);
        uint256 minOut = t.minOut > floor ? t.minOut : floor;

        uint256 inBefore = tin.balanceOf(address(this));
        uint256 outBefore = tout.balanceOf(address(this));
        if (t.amountIn > inBefore) revert InvalidTrade(k);
        tin.forceApprove(address(venue), t.amountIn);
        venue.swap(address(tin), address(tout), t.amountIn, minOut, address(this));
        tin.forceApprove(address(venue), 0); // bersihkan sisa allowance
        uint256 spent = inBefore - tin.balanceOf(address(this));
        uint256 received = tout.balanceOf(address(this)) - outBefore;

        if (spent != t.amountIn) revert PruneShortSpend(k, spent, t.amountIn);
        if (received < minOut) revert PruneSlippageExceeded(k, received, minOut);
        emit PruneSwap(address(tin), address(tout), spent, received);
    }

    /// Nilai USD (18 desimal) tiap komponen dengan harga `prices` dan totalnya.
    function _values(uint256[] memory prices) internal view returns (uint256[] memory vals, uint256 total) {
        uint256 n = _components.length;
        vals = new uint256[](n);
        for (uint256 i; i < n; ++i) {
            uint256 bal = IERC20(_components[i]).balanceOf(address(this));
            vals[i] = Math.mulDiv(bal, prices[i], 10 ** _decimals[i]);
            total += vals[i];
        }
    }

    /// Selisih terbesar (bps) bobot sebenarnya (dibulatkan ke terdekat) dan target; sama dengan `maxDriftBps` keeper.
    /// Vault dengan nilai 0: 0.
    function _drift(uint256[] memory vals, uint256 total) internal view returns (uint256 maxDrift) {
        if (total == 0) return 0;
        uint256 n = vals.length;
        for (uint256 i; i < n; ++i) {
            uint256 w = (vals[i] * BPS * 2 + total) / (total * 2);
            uint256 target = _targetBps[i];
            uint256 d = w > target ? w - target : target - w;
            if (d > maxDrift) maxDrift = d;
        }
    }

    // ------------------------------------------------------------ admin pruning

    /// Pasang venue pruning (atau matikan dengan address(0)). Venue harus kontrak dan bukan vault ini.
    function setPruneVenue(address venue) external onlyRole(DEFAULT_ADMIN_ROLE) nonReentrant {
        if (venue != address(0) && (venue == address(this) || venue.code.length == 0)) revert InvalidPruneVenue();
        pruneVenue = IPruneVenue(venue);
        emit PruneVenueSet(venue);
    }

    /// Atur slippage maksimum pruning (<= `MAX_PRUNE_SLIPPAGE_BPS`). 0 mematikan pruning.
    function setPruneSlippageBps(uint16 bps) external onlyRole(DEFAULT_ADMIN_ROLE) nonReentrant {
        if (bps > MAX_PRUNE_SLIPPAGE_BPS) revert FeeTooHigh();
        pruneSlippageBps = bps;
        emit PruneSlippageSet(bps);
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
