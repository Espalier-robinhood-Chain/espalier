// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Script, console2} from "forge-std/Script.sol";
import {VmSafe} from "forge-std/Vm.sol";
import {IAccessControl} from "@openzeppelin/contracts/access/IAccessControl.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {TimelockController} from "@openzeppelin/contracts/governance/TimelockController.sol";
import {MarketSession} from "../src/MarketSession.sol";
import {OracleRouter} from "../src/OracleRouter.sol";
import {SettlementOracle} from "../src/SettlementOracle.sol";
import {CordonVault} from "../src/CordonVault.sol";
import {SpurVault} from "../src/SpurVault.sol";
import {GraftVault} from "../src/GraftVault.sol";
import {HarvestAuction} from "../src/HarvestAuction.sol";
import {IOracleRouter} from "../src/interfaces/IOracleRouter.sol";
import {Roles} from "../src/libraries/Roles.sol";
import {MockERC20} from "../test/mocks/MockERC20.sol";
import {MockAggregator} from "../test/mocks/MockAggregator.sol";

/// @title Deploy
/// @notice Fase 2 item 6: deploy `MarketSession`, `OracleRouter`, `SettlementOracle`, dan `CordonVault` ke Robinhood
///         Chain Testnet (46630), atur semuanya dari file konfigurasi JSON, lalu serahkan ADMIN. Bagian `spur` di
///         konfigurasi (opsional) menambah `HarvestAuction` dan satu `SpurVault` (M4) dengan cara yang sama. Bagian
///         `graft` (opsional) menambah satu `GraftVault` (cash-secured put) yang memakai `HarvestAuction` dan USDG yang sama.
/// @dev Pemakaian dan urutan langkah ada di `contracts/README.md` (bagian "Deploy testnet").
///
///      Prinsip:
///      - Fail-closed: konfigurasi yang kosong, tidak konsisten, atau belum ditandai terverifikasi membuat skrip
///        berhenti SEBELUM satu transaksi pun dikirim (forge menjalankan `run()` penuh sebagai simulasi dulu).
///      - Tanpa `--broadcast` skrip hanya simulasi (dry-run) dan tidak menulis file apa pun.
///      - Mainnet (4663) selalu ditolak. Skrip ini hanya untuk testnet dan rehearsal lokal.
///      - Kunci tidak dibaca dari env oleh skrip: `vm.startBroadcast()` tanpa argumen memakai kunci/akun yang
///        diberikan lewat flag forge (`--account`, `--private-key`, `--ledger`).
///      - Deployer menjadi ADMIN sementara untuk konfigurasi, lalu ADMIN diserahkan ke `admin.owner` (atau ke
///        `TimelockController` bila `admin.timelockDelaySeconds` > 0) dan deployer melepas perannya.
contract Deploy is Script {
    uint256 internal constant MAINNET_CHAIN_ID = 4663;
    string internal constant DEFAULT_CONFIG = "script/config/robinhood-testnet.json";
    uint256 internal constant MAX_COMPONENTS = 16;
    // Cermin batas di SpurVault, supaya kesalahan konfigurasi berhenti dengan pesan yang jelas (kontrak tetap menegakkannya).
    uint256 internal constant SPUR_MIN_OTM_BPS = 100;
    uint256 internal constant SPUR_MAX_OTM_BPS = 5_000;
    uint256 internal constant SPUR_MAX_MIN_PREMIUM_BPS = 2_000;
    uint256 internal constant SPUR_MIN_FILL_WINDOW = 1 hours;
    uint256 internal constant SPUR_MAX_FILL_WINDOW = 2 days;
    /// Saldo USDG mock per Picker di mode mock (untuk rehearsal lokal).
    uint256 internal constant MOCK_PICKER_FUNDING = 1_000_000e6;

    struct AssetCfg {
        string symbol;
        address token;
        address feed;
        uint32 stalenessRegular;
        uint32 stalenessExtended;
        uint32 stalenessOvernight;
        bool checkOraclePause;
        uint16 targetBps;
        uint256 mockPriceE8;
    }

    /// Bagian `spur` dan `graft` di JSON (opsional, bentuknya sama). `enabled=false` atau tidak ada = vault itu tidak
    /// di-deploy. Untuk `graft`, `premiumToken` adalah USDG yang sekaligus collateral, dan `assetSymbol` adalah aset acuan harga.
    struct SpurCfg {
        bool enabled;
        string assetSymbol; // harus salah satu simbol di `assets`
        uint256 assetIndex; // hasil pencarian `assetSymbol`
        address premiumToken; // USDG (diabaikan di mode mock: dibuat skrip, 6 desimal)
        uint256 fillWindow;
        uint256 minDeposit;
        uint256 depositCap; // 0 = tanpa batas
        uint256 otmBps;
        uint256 minPremiumBps;
        address[] pickers;
    }

    struct Config {
        string name;
        uint256 chainId;
        bool mocks;
        bool addressesVerified;
        address owner;
        uint256 timelockDelay;
        address guardian;
        address keeper;
        address sequencerFeed;
        uint256 sequencerGrace;
        bool sequencerAllowDisabled;
        uint256 maxPrintDelay;
        string cordonName;
        string cordonSymbol;
        uint16 mintFeeBps;
        uint16 redeemFeeBps;
        uint16 managementFeeBps;
        address feeRecipient;
        bool seedEnabled;
        address seedTo;
        uint256 seedShares;
        uint256[] seedAmounts;
        uint256[] holidays;
        AssetCfg[] assets;
        SpurCfg spur;
        SpurCfg graft;
    }

    struct Result {
        address deployer;
        address finalAdmin;
        address timelock;
        address sequencerFeed;
        MarketSession session;
        OracleRouter router;
        SettlementOracle settlement;
        CordonVault vault;
        SpurVault spurVault; // address(0) bila `spur.enabled` false
        GraftVault graftVault; // address(0) bila `graft.enabled` false
        HarvestAuction auction;
        address premiumToken;
        address[] tokens;
        address[] feeds;
    }

    // ------------------------------------------------------------------ entry

    function run() external returns (Result memory) {
        string memory path = vm.envOr("DEPLOY_CONFIG", DEFAULT_CONFIG);
        console2.log("Config:", path);
        return deploy(vm.readFile(path));
    }

    /// Dipisah dari `run()` supaya test bisa memberi konfigurasi sebagai string.
    function deploy(string memory json) public returns (Result memory r) {
        Config memory c = _load(json);
        _validate(c);

        vm.startBroadcast();
        (, address deployer,) = vm.readCallers();
        r.deployer = deployer;

        _prepareInputs(c, r);
        _deployCore(c, r);
        _deployAuction(c, r);
        _deploySpur(c, r);
        _deployGraft(c, r);
        _configure(c, r);
        _configureSpur(c, r);
        _configureGraft(c, r);
        _seed(c, r);
        _handover(c, r);
        vm.stopBroadcast();

        _verify(c, r);
        _report(c, r);
        if (vm.isContext(VmSafe.ForgeContext.ScriptBroadcast) || vm.isContext(VmSafe.ForgeContext.ScriptResume)) {
            _write(c, r);
        }
    }

    // ----------------------------------------------------------------- config

    function _load(string memory j) internal view returns (Config memory c) {
        c.name = vm.parseJsonString(j, ".name");
        c.chainId = vm.parseJsonUint(j, ".chainId");
        c.mocks = vm.parseJsonBool(j, ".mocks");
        c.addressesVerified = vm.parseJsonBool(j, ".addressesVerified");

        c.owner = vm.parseJsonAddress(j, ".admin.owner");
        c.timelockDelay = vm.parseJsonUint(j, ".admin.timelockDelaySeconds");
        c.guardian = vm.parseJsonAddress(j, ".admin.guardian");
        c.keeper = vm.parseJsonAddress(j, ".admin.keeper");

        c.sequencerFeed = vm.parseJsonAddress(j, ".sequencer.feed");
        c.sequencerGrace = vm.parseJsonUint(j, ".sequencer.gracePeriodSeconds");
        c.sequencerAllowDisabled = vm.parseJsonBool(j, ".sequencer.allowDisabled");
        c.maxPrintDelay = vm.parseJsonUint(j, ".settlement.maxPrintDelaySeconds");

        c.cordonName = vm.parseJsonString(j, ".cordon.name");
        c.cordonSymbol = vm.parseJsonString(j, ".cordon.symbol");

        c.mintFeeBps = uint16(_u(j, ".fees.mintBps", type(uint16).max));
        c.redeemFeeBps = uint16(_u(j, ".fees.redeemBps", type(uint16).max));
        c.managementFeeBps = uint16(_u(j, ".fees.managementBps", type(uint16).max));
        c.feeRecipient = vm.parseJsonAddress(j, ".fees.recipient");

        c.seedEnabled = vm.parseJsonBool(j, ".seed.enabled");
        c.seedTo = vm.parseJsonAddress(j, ".seed.to");
        c.seedShares = vm.parseUint(vm.parseJsonString(j, ".seed.shares"));
        string[] memory amounts = vm.parseJsonStringArray(j, ".seed.amounts");
        c.seedAmounts = new uint256[](amounts.length);
        for (uint256 i; i < amounts.length; ++i) {
            c.seedAmounts[i] = vm.parseUint(amounts[i]);
        }

        c.holidays = vm.parseJsonUintArray(j, ".holidays");
        c.assets = _loadAssets(j, c.mocks);
        c.spur = _loadVaultCfg(j, "spur", c.assets);
        c.graft = _loadVaultCfg(j, "graft", c.assets);
    }

    /// Bagian `spur` / `graft` boleh tidak ada (konfigurasi lama tetap valid). Bila `enabled` false, sisanya tidak dibaca.
    function _loadVaultCfg(string memory j, string memory name, AssetCfg[] memory assets)
        internal
        view
        returns (SpurCfg memory s)
    {
        string memory k = string.concat(".", name);
        if (!vm.keyExistsJson(j, k) || !vm.parseJsonBool(j, string.concat(k, ".enabled"))) return s;
        s.enabled = true;
        s.assetSymbol = vm.parseJsonString(j, string.concat(k, ".assetSymbol"));
        s.premiumToken = vm.parseJsonAddress(j, string.concat(k, ".premiumToken"));
        s.fillWindow = vm.parseJsonUint(j, string.concat(k, ".fillWindowSeconds"));
        s.minDeposit = vm.parseUint(vm.parseJsonString(j, string.concat(k, ".minDeposit")));
        s.depositCap = vm.parseUint(vm.parseJsonString(j, string.concat(k, ".depositCap")));
        s.otmBps = vm.parseJsonUint(j, string.concat(k, ".otmBps"));
        s.minPremiumBps = vm.parseJsonUint(j, string.concat(k, ".minPremiumBps"));
        s.pickers = vm.parseJsonAddressArray(j, string.concat(k, ".pickers"));

        bool found;
        for (uint256 i; i < assets.length; ++i) {
            if (keccak256(bytes(assets[i].symbol)) == keccak256(bytes(s.assetSymbol))) {
                s.assetIndex = i;
                found = true;
                break;
            }
        }
        require(found, string.concat("config: ", name, ".assetSymbol tidak ada di assets"));
    }

    function _loadAssets(string memory j, bool mocks) internal pure returns (AssetCfg[] memory a) {
        string[] memory symbols = abi.decode(vm.parseJson(j, ".assets[*].symbol"), (string[]));
        address[] memory tokens = abi.decode(vm.parseJson(j, ".assets[*].token"), (address[]));
        address[] memory feeds = abi.decode(vm.parseJson(j, ".assets[*].feed"), (address[]));
        uint256[] memory reg = abi.decode(vm.parseJson(j, ".assets[*].stalenessRegularSeconds"), (uint256[]));
        uint256[] memory ext = abi.decode(vm.parseJson(j, ".assets[*].stalenessExtendedSeconds"), (uint256[]));
        uint256[] memory ovn = abi.decode(vm.parseJson(j, ".assets[*].stalenessOvernightSeconds"), (uint256[]));
        bool[] memory chk = abi.decode(vm.parseJson(j, ".assets[*].checkOraclePause"), (bool[]));
        uint256[] memory bps = abi.decode(vm.parseJson(j, ".assets[*].targetBps"), (uint256[]));
        uint256[] memory prices;
        if (mocks) prices = abi.decode(vm.parseJson(j, ".assets[*].mockPriceE8"), (uint256[]));

        uint256 n = symbols.length;
        a = new AssetCfg[](n);
        for (uint256 i; i < n; ++i) {
            a[i] = AssetCfg({
                symbol: symbols[i],
                token: tokens[i],
                feed: feeds[i],
                stalenessRegular: _u32(reg[i]),
                stalenessExtended: _u32(ext[i]),
                stalenessOvernight: _u32(ovn[i]),
                checkOraclePause: chk[i],
                targetBps: uint16(_bound(bps[i], type(uint16).max)),
                mockPriceE8: mocks ? prices[i] : 0
            });
        }
    }

    function _u(string memory j, string memory key, uint256 max) internal pure returns (uint256) {
        return _bound(vm.parseJsonUint(j, key), max);
    }

    function _bound(uint256 v, uint256 max) internal pure returns (uint256) {
        require(v <= max, "config: angka melebihi batas tipe");
        return v;
    }

    function _u32(uint256 v) internal pure returns (uint32) {
        return uint32(_bound(v, type(uint32).max));
    }

    // -------------------------------------------------------------- validation

    function _validate(Config memory c) internal view {
        require(block.chainid != MAINNET_CHAIN_ID, "skrip ini tidak untuk mainnet (4663)");
        require(block.chainid == c.chainId, "chainId RPC tidak sama dengan chainId di konfigurasi");
        require(bytes(c.name).length != 0, "config: name kosong");
        require(c.owner != address(0), "config: admin.owner kosong");
        require(bytes(c.cordonName).length != 0 && bytes(c.cordonSymbol).length != 0, "config: nama/simbol Cordon");
        require(c.maxPrintDelay != 0, "config: settlement.maxPrintDelaySeconds kosong");

        uint256 n = c.assets.length;
        require(n != 0 && n <= MAX_COMPONENTS, "config: jumlah aset harus 1-16");

        uint256 sum;
        for (uint256 i; i < n; ++i) {
            AssetCfg memory a = c.assets[i];
            require(a.targetBps != 0, "config: targetBps 0");
            sum += a.targetBps;
            require(
                a.stalenessRegular != 0 && a.stalenessExtended != 0 && a.stalenessOvernight != 0,
                "config: jendela staleness 0"
            );
            if (c.mocks) {
                require(a.mockPriceE8 != 0, "config: mockPriceE8 0");
            } else {
                _requireDeployed(a.token, "config: token aset kosong / tanpa kode");
                _requireDeployed(a.feed, "config: feed aset kosong / tanpa kode");
            }
        }
        require(sum == 10_000, "config: jumlah targetBps harus 10000");

        if (!c.mocks) {
            require(c.addressesVerified, "config: addressesVerified=false (Fase 0 item 7 belum selesai)");
            if (c.sequencerFeed == address(0)) {
                require(c.sequencerAllowDisabled, "config: sequencer.feed kosong tanpa allowDisabled");
            } else {
                _requireDeployed(c.sequencerFeed, "config: sequencer.feed tanpa kode");
            }
        }

        if ((c.mintFeeBps | c.redeemFeeBps | c.managementFeeBps) != 0) {
            require(c.feeRecipient != address(0), "config: fee > 0 butuh fees.recipient");
        }

        if (c.seedEnabled) {
            require(c.seedTo != address(0), "config: seed.to kosong");
            require(c.seedShares != 0, "config: seed.shares 0");
            require(c.seedAmounts.length == n, "config: seed.amounts harus sebanyak aset");
            for (uint256 i; i < n; ++i) {
                require(c.seedAmounts[i] != 0, "config: seed.amounts berisi 0");
            }
        }

        for (uint256 i; i < c.holidays.length; ++i) {
            (uint256 y, uint256 m, uint256 d) = _ymd(c.holidays[i]);
            require(y >= 2007 && y <= 2100 && m >= 1 && m <= 12 && d >= 1 && d <= 31, "config: tanggal libur");
        }

        _validateVaultCfg(c, c.spur, "spur");
        _validateVaultCfg(c, c.graft, "graft");
        if (c.spur.enabled && c.graft.enabled && !c.mocks) {
            require(c.spur.premiumToken == c.graft.premiumToken, "config: graft.premiumToken harus sama dengan spur.premiumToken");
        }
    }

    function _validateVaultCfg(Config memory c, SpurCfg memory s, string memory n) internal view {
        if (!s.enabled) return;
        // Tanpa KEEPER tidak ada yang bisa memulai round, dan menambahkannya kemudian lewat timelock butuh jeda penuh.
        require(c.keeper != address(0), string.concat("config: ", n, " butuh admin.keeper"));
        require(
            s.otmBps >= SPUR_MIN_OTM_BPS && s.otmBps <= SPUR_MAX_OTM_BPS,
            string.concat("config: ", n, ".otmBps di luar 100-5000")
        );
        require(s.minPremiumBps <= SPUR_MAX_MIN_PREMIUM_BPS, string.concat("config: ", n, ".minPremiumBps di atas 2000"));
        require(
            s.fillWindow >= SPUR_MIN_FILL_WINDOW && s.fillWindow <= SPUR_MAX_FILL_WINDOW,
            string.concat("config: ", n, ".fillWindowSeconds di luar 3600-172800")
        );
        require(s.minDeposit != 0, string.concat("config: ", n, ".minDeposit 0"));
        for (uint256 i; i < s.pickers.length; ++i) {
            require(s.pickers[i] != address(0), string.concat("config: ", n, ".pickers berisi alamat 0"));
        }
        if (!c.mocks) _requireDeployed(s.premiumToken, string.concat("config: ", n, ".premiumToken kosong / tanpa kode"));
    }

    function _requireDeployed(address a, string memory err) internal view {
        require(a != address(0) && a.code.length != 0, err);
    }

    function _ymd(uint256 v) internal pure returns (uint256 y, uint256 m, uint256 d) {
        y = v / 10_000;
        m = (v / 100) % 100;
        d = v % 100;
    }

    // ------------------------------------------------------------------ steps

    /// Mode mock: token ERC-20 dan feed palsu dibuat di sini. Mode nyata: alamat dari konfigurasi.
    function _prepareInputs(Config memory c, Result memory r) internal {
        uint256 n = c.assets.length;
        r.tokens = new address[](n);
        r.feeds = new address[](n);

        if (!c.mocks) {
            for (uint256 i; i < n; ++i) {
                r.tokens[i] = c.assets[i].token;
                r.feeds[i] = c.assets[i].feed;
            }
            r.sequencerFeed = c.sequencerFeed;
            return;
        }

        for (uint256 i; i < n; ++i) {
            r.tokens[i] = address(new MockERC20(c.assets[i].symbol, c.assets[i].symbol, 18));
            MockAggregator feed = new MockAggregator(8);
            feed.setRound(int256(c.assets[i].mockPriceE8));
            r.feeds[i] = address(feed);
        }
        // Sequencer "up" sejak lebih lama dari grace period.
        MockAggregator seq = new MockAggregator(0);
        uint256 since = block.timestamp - c.sequencerGrace - 1;
        seq.setRaw(1, 0, since, since, 1);
        r.sequencerFeed = address(seq);
    }

    function _deployCore(Config memory c, Result memory r) internal {
        r.session = new MarketSession(r.deployer);
        r.router = new OracleRouter(r.deployer, r.sequencerFeed, c.sequencerGrace, address(r.session));
        r.settlement = new SettlementOracle(address(r.router), uint32(_bound(c.maxPrintDelay, type(uint32).max)));

        uint256 n = c.assets.length;
        uint16[] memory weights = new uint16[](n);
        for (uint256 i; i < n; ++i) {
            weights[i] = c.assets[i].targetBps;
        }
        r.vault = new CordonVault(r.deployer, address(r.router), c.cordonName, c.cordonSymbol, r.tokens, weights);
    }

    function _configure(Config memory c, Result memory r) internal {
        for (uint256 i; i < c.assets.length; ++i) {
            AssetCfg memory a = c.assets[i];
            r.router
                .setAssetWindows(
                    r.tokens[i],
                    r.feeds[i],
                    a.stalenessRegular,
                    a.stalenessExtended,
                    a.stalenessOvernight,
                    a.checkOraclePause
                );
        }

        for (uint256 i; i < c.holidays.length; ++i) {
            (uint256 y, uint256 m, uint256 d) = _ymd(c.holidays[i]);
            r.session.setHoliday(uint16(y), uint8(m), uint8(d), true);
        }

        if (c.guardian != address(0)) r.router.grantRole(Roles.GUARDIAN_ROLE, c.guardian);
        if (c.keeper != address(0)) {
            r.session.grantRole(Roles.KEEPER_ROLE, c.keeper);
            r.vault.grantRole(Roles.KEEPER_ROLE, c.keeper); // pruning Cordon; venue dan slippage tetap ADMIN (timelock)
        }

        if (c.feeRecipient != address(0)) r.vault.setFeeRecipient(c.feeRecipient);
        if ((c.mintFeeBps | c.redeemFeeBps | c.managementFeeBps) != 0) {
            r.vault.setFees(c.mintFeeBps, c.redeemFeeBps, c.managementFeeBps);
        }
    }

    /// USDG dan HarvestAuction bersama untuk Spur dan Graft. Mode mock membuat USDG palsu (6 desimal).
    function _deployAuction(Config memory c, Result memory r) internal {
        if (!c.spur.enabled && !c.graft.enabled) return;
        r.premiumToken = c.mocks
            ? address(new MockERC20("USDG", "USDG", 6))
            : (c.spur.enabled ? c.spur.premiumToken : c.graft.premiumToken);
        r.auction = new HarvestAuction(r.deployer);
    }

    /// Satu SpurVault untuk `spur.assetSymbol`.
    function _deploySpur(Config memory c, Result memory r) internal {
        SpurCfg memory s = c.spur;
        if (!s.enabled) return;
        r.spurVault = new SpurVault(
            r.deployer,
            r.tokens[s.assetIndex],
            r.premiumToken,
            address(r.router),
            address(r.settlement),
            address(r.auction),
            uint32(_bound(s.fillWindow, type(uint32).max)),
            s.minDeposit,
            s.depositCap == 0 ? type(uint256).max : s.depositCap,
            uint16(_bound(s.otmBps, type(uint16).max)),
            uint16(_bound(s.minPremiumBps, type(uint16).max))
        );
    }

    /// Satu GraftVault (collateral USDG) dengan harga acuan `graft.assetSymbol`.
    function _deployGraft(Config memory c, Result memory r) internal {
        SpurCfg memory g = c.graft;
        if (!g.enabled) return;
        r.graftVault = new GraftVault(
            r.deployer,
            r.premiumToken,
            r.tokens[g.assetIndex],
            address(r.router),
            address(r.settlement),
            address(r.auction),
            uint32(_bound(g.fillWindow, type(uint32).max)),
            g.minDeposit,
            g.depositCap == 0 ? type(uint256).max : g.depositCap,
            uint16(_bound(g.otmBps, type(uint16).max)),
            uint16(_bound(g.minPremiumBps, type(uint16).max))
        );
    }

    function _configureSpur(Config memory c, Result memory r) internal {
        if (!c.spur.enabled) return;
        r.spurVault.grantRole(Roles.KEEPER_ROLE, c.keeper);
        r.auction.grantRole(Roles.KEEPER_ROLE, c.keeper);
        if (c.guardian != address(0)) r.spurVault.grantRole(Roles.GUARDIAN_ROLE, c.guardian);
        for (uint256 i; i < c.spur.pickers.length; ++i) {
            r.auction.setPicker(c.spur.pickers[i], true);
            if (c.mocks) MockERC20(r.premiumToken).mint(c.spur.pickers[i], MOCK_PICKER_FUNDING);
        }
    }

    function _configureGraft(Config memory c, Result memory r) internal {
        if (!c.graft.enabled) return;
        r.graftVault.grantRole(Roles.KEEPER_ROLE, c.keeper);
        r.auction.grantRole(Roles.KEEPER_ROLE, c.keeper);
        if (c.guardian != address(0)) r.graftVault.grantRole(Roles.GUARDIAN_ROLE, c.guardian);
        for (uint256 i; i < c.graft.pickers.length; ++i) {
            r.auction.setPicker(c.graft.pickers[i], true);
            if (c.mocks) MockERC20(r.premiumToken).mint(c.graft.pickers[i], MOCK_PICKER_FUNDING);
        }
    }

    /// Seed harus dilakukan SEBELUM serah-terima: sesudahnya ADMIN adalah owner/timelock, dan `seed` menarik token
    /// dari pemanggil (admin), jadi lewat timelock butuh transfer token + approve + seed sebagai operasi terjadwal.
    function _seed(Config memory c, Result memory r) internal {
        if (!c.seedEnabled) return;
        for (uint256 i; i < r.tokens.length; ++i) {
            if (c.mocks) MockERC20(r.tokens[i]).mint(r.deployer, c.seedAmounts[i]);
            require(IERC20(r.tokens[i]).approve(address(r.vault), c.seedAmounts[i]), "approve gagal");
        }
        r.vault.seed(c.seedShares, c.seedTo, c.seedAmounts);
    }

    function _handover(Config memory c, Result memory r) internal {
        address admin = c.owner;
        if (c.timelockDelay != 0) {
            address[] memory who = new address[](1);
            who[0] = c.owner;
            // Tanpa admin tambahan (address(0)): timelock hanya bisa diubah lewat dirinya sendiri.
            TimelockController t = new TimelockController(c.timelockDelay, who, who, address(0));
            r.timelock = address(t);
            admin = address(t);
        }
        r.finalAdmin = admin;

        if (admin == r.deployer) {
            console2.log("PERINGATAN: owner == deployer dan tanpa timelock; ADMIN tetap di kunci deployer.");
            return;
        }
        _handoverOne(address(r.session), admin, r.deployer);
        _handoverOne(address(r.router), admin, r.deployer);
        _handoverOne(address(r.vault), admin, r.deployer);
        if (address(r.spurVault) != address(0)) _handoverOne(address(r.spurVault), admin, r.deployer);
        if (address(r.graftVault) != address(0)) _handoverOne(address(r.graftVault), admin, r.deployer);
        if (address(r.auction) != address(0)) _handoverOne(address(r.auction), admin, r.deployer);
    }

    function _handoverOne(address target, address admin, address deployer) internal {
        IAccessControl(target).grantRole(0x00, admin); // DEFAULT_ADMIN_ROLE
        IAccessControl(target).renounceRole(0x00, deployer);
    }

    // ----------------------------------------------------------------- verify

    /// Membaca kembali keadaan akhir dan membandingkannya dengan konfigurasi. Berjalan di simulasi lokal, jadi
    /// mengesahkan logika skrip dan konfigurasi, BUKAN perilaku chain (itu tugas `script/smoke.sh`).
    function _verify(Config memory c, Result memory r) internal view {
        bytes32 admin = 0x00;
        address[3] memory targets = [address(r.session), address(r.router), address(r.vault)];
        for (uint256 i; i < targets.length; ++i) {
            require(IAccessControl(targets[i]).hasRole(admin, r.finalAdmin), "verify: finalAdmin bukan ADMIN");
            if (r.finalAdmin != r.deployer) {
                require(!IAccessControl(targets[i]).hasRole(admin, r.deployer), "verify: deployer masih ADMIN");
            }
        }

        require(address(r.router.marketSession()) == address(r.session), "verify: router.marketSession");
        require(address(r.settlement.ROUTER()) == address(r.router), "verify: settlement.ROUTER");
        require(address(r.vault.ROUTER()) == address(r.router), "verify: vault.ROUTER");
        require(r.settlement.MAX_PRINT_DELAY() == c.maxPrintDelay, "verify: maxPrintDelay");
        require(r.router.sequencerGracePeriod() == c.sequencerGrace, "verify: sequencer grace");
        require(r.router.sequencerCheckEnabled() == (r.sequencerFeed != address(0)), "verify: sequencer check");

        address[] memory comps = r.vault.components();
        uint16[] memory weights = r.vault.targetWeightsBps();
        require(comps.length == c.assets.length, "verify: jumlah komponen");
        for (uint256 i; i < comps.length; ++i) {
            require(comps[i] == r.tokens[i] && weights[i] == c.assets[i].targetBps, "verify: komponen/bobot");
            OracleRouter.Asset memory a = r.router.assetConfig(r.tokens[i]);
            require(address(a.feed) == r.feeds[i], "verify: feed aset");
            require(
                a.stalenessRegular == c.assets[i].stalenessRegular
                    && a.stalenessExtended == c.assets[i].stalenessExtended
                    && a.stalenessOvernight == c.assets[i].stalenessOvernight
                    && a.checkOraclePause == c.assets[i].checkOraclePause,
                "verify: jendela staleness"
            );
        }

        for (uint256 i; i < c.holidays.length; ++i) {
            (uint256 y, uint256 m, uint256 d) = _ymd(c.holidays[i]);
            require(r.session.isHoliday(uint16(y), uint8(m), uint8(d)), "verify: libur");
        }

        require(r.vault.mintFeeBps() == c.mintFeeBps, "verify: mint fee");
        require(r.vault.redeemFeeBps() == c.redeemFeeBps, "verify: redeem fee");
        require(r.vault.managementFeeBps() == c.managementFeeBps, "verify: management fee");
        require(r.vault.feeRecipient() == c.feeRecipient, "verify: fee recipient");

        if (c.guardian != address(0)) {
            require(r.router.hasRole(Roles.GUARDIAN_ROLE, c.guardian), "verify: GUARDIAN");
        }
        if (c.keeper != address(0)) {
            require(r.session.hasRole(Roles.KEEPER_ROLE, c.keeper), "verify: KEEPER");
            require(r.vault.hasRole(Roles.KEEPER_ROLE, c.keeper), "verify: KEEPER (cordon)");
        }

        if (c.seedEnabled) {
            require(r.vault.totalSupply() == c.seedShares, "verify: supply seed");
            require(r.vault.balanceOf(c.seedTo) == c.seedShares, "verify: saldo seed");
        } else {
            require(r.vault.totalSupply() == 0, "verify: supply bukan 0");
        }

        _verifySpur(c, r);
        _verifyGraft(c, r);

        if (r.timelock != address(0)) {
            TimelockController t = TimelockController(payable(r.timelock));
            require(t.getMinDelay() == c.timelockDelay, "verify: timelock delay");
            require(t.hasRole(t.PROPOSER_ROLE(), c.owner), "verify: timelock proposer");
            require(t.hasRole(t.EXECUTOR_ROLE(), c.owner), "verify: timelock executor");
            require(!t.hasRole(t.DEFAULT_ADMIN_ROLE(), r.deployer), "verify: deployer admin timelock");
            // Owner hanya proposer/executor: kalau juga admin timelock, ia bisa mengubah peran tanpa jeda.
            require(!t.hasRole(t.DEFAULT_ADMIN_ROLE(), c.owner), "verify: owner admin timelock");
        }
    }

    function _verifySpur(Config memory c, Result memory r) internal view {
        require(
            (address(r.auction) != address(0)) == (c.spur.enabled || c.graft.enabled), "verify: auction tidak sesuai konfigurasi"
        );
        if (!c.spur.enabled) {
            require(address(r.spurVault) == address(0), "verify: spur tak terduga");
            return;
        }
        SpurVault v = r.spurVault;
        require(address(v) != address(0) && address(r.auction) != address(0), "verify: spur tidak ter-deploy");
        address[2] memory targets = [address(v), address(r.auction)];
        for (uint256 i; i < targets.length; ++i) {
            require(IAccessControl(targets[i]).hasRole(0x00, r.finalAdmin), "verify: spur finalAdmin bukan ADMIN");
            if (r.finalAdmin != r.deployer) {
                require(!IAccessControl(targets[i]).hasRole(0x00, r.deployer), "verify: spur deployer masih ADMIN");
            }
        }
        require(address(v.ASSET()) == r.tokens[c.spur.assetIndex], "verify: spur.ASSET");
        require(address(v.PREMIUM()) == r.premiumToken, "verify: spur.PREMIUM");
        require(address(v.ROUTER()) == address(r.router), "verify: spur.ROUTER");
        require(address(v.SETTLEMENT()) == address(r.settlement), "verify: spur.SETTLEMENT");
        require(v.AUCTION() == address(r.auction), "verify: spur.AUCTION");
        require(v.FILL_WINDOW() == c.spur.fillWindow, "verify: spur.fillWindow");
        require(v.MIN_DEPOSIT() == c.spur.minDeposit, "verify: spur.minDeposit");
        require(
            v.depositCap() == (c.spur.depositCap == 0 ? type(uint256).max : c.spur.depositCap),
            "verify: spur.depositCap"
        );
        require(v.otmBps() == c.spur.otmBps, "verify: spur.otmBps");
        require(v.minPremiumBps() == c.spur.minPremiumBps, "verify: spur.minPremiumBps");
        require(v.hasRole(Roles.KEEPER_ROLE, c.keeper), "verify: spur vault KEEPER");
        require(r.auction.hasRole(Roles.KEEPER_ROLE, c.keeper), "verify: auction KEEPER");
        if (c.guardian != address(0)) require(v.hasRole(Roles.GUARDIAN_ROLE, c.guardian), "verify: spur GUARDIAN");
        for (uint256 i; i < c.spur.pickers.length; ++i) {
            require(r.auction.isPicker(c.spur.pickers[i]), "verify: picker");
        }
        require(v.round() == 0 && !v.active() && v.totalShares() == 0, "verify: spur state awal");
    }

    function _verifyGraft(Config memory c, Result memory r) internal view {
        if (!c.graft.enabled) {
            require(address(r.graftVault) == address(0), "verify: graft tak terduga");
            return;
        }
        GraftVault v = r.graftVault;
        require(address(v) != address(0) && address(r.auction) != address(0), "verify: graft tidak ter-deploy");
        address[2] memory targets = [address(v), address(r.auction)];
        for (uint256 i; i < targets.length; ++i) {
            require(IAccessControl(targets[i]).hasRole(0x00, r.finalAdmin), "verify: graft finalAdmin bukan ADMIN");
            if (r.finalAdmin != r.deployer) {
                require(!IAccessControl(targets[i]).hasRole(0x00, r.deployer), "verify: graft deployer masih ADMIN");
            }
        }
        require(address(v.ASSET()) == r.premiumToken && address(v.PREMIUM()) == r.premiumToken, "verify: graft.ASSET/PREMIUM");
        require(address(v.UNDERLYING()) == r.tokens[c.graft.assetIndex], "verify: graft.UNDERLYING");
        require(address(v.ROUTER()) == address(r.router), "verify: graft.ROUTER");
        require(address(v.SETTLEMENT()) == address(r.settlement), "verify: graft.SETTLEMENT");
        require(v.AUCTION() == address(r.auction), "verify: graft.AUCTION");
        require(v.FILL_WINDOW() == c.graft.fillWindow, "verify: graft.fillWindow");
        require(v.MIN_DEPOSIT() == c.graft.minDeposit, "verify: graft.minDeposit");
        require(
            v.depositCap() == (c.graft.depositCap == 0 ? type(uint256).max : c.graft.depositCap),
            "verify: graft.depositCap"
        );
        require(v.otmBps() == c.graft.otmBps, "verify: graft.otmBps");
        require(v.minPremiumBps() == c.graft.minPremiumBps, "verify: graft.minPremiumBps");
        require(v.hasRole(Roles.KEEPER_ROLE, c.keeper), "verify: graft vault KEEPER");
        require(r.auction.hasRole(Roles.KEEPER_ROLE, c.keeper), "verify: auction KEEPER (graft)");
        if (c.guardian != address(0)) require(v.hasRole(Roles.GUARDIAN_ROLE, c.guardian), "verify: graft GUARDIAN");
        for (uint256 i; i < c.graft.pickers.length; ++i) {
            require(r.auction.isPicker(c.graft.pickers[i]), "verify: picker (graft)");
        }
        require(v.round() == 0 && !v.active() && v.totalShares() == 0, "verify: graft state awal");
    }

    // ----------------------------------------------------------------- output

    function _report(Config memory c, Result memory r) internal view {
        console2.log("==================================================");
        console2.log(c.mocks ? "MODE: MOCK (token dan feed palsu)" : "MODE: alamat nyata dari konfigurasi");
        console2.log("Chain ID        :", block.chainid);
        console2.log("Deployer        :", r.deployer);
        console2.log("ADMIN akhir     :", r.finalAdmin);
        if (r.timelock != address(0)) console2.log("TimelockController:", r.timelock);
        console2.log("MarketSession   :", address(r.session));
        console2.log("OracleRouter    :", address(r.router));
        console2.log("SettlementOracle:", address(r.settlement));
        console2.log("CordonVault     :", address(r.vault));
        if (address(r.spurVault) != address(0)) console2.log("SpurVault       :", address(r.spurVault));
        if (address(r.graftVault) != address(0)) console2.log("GraftVault      :", address(r.graftVault));
        if (address(r.auction) != address(0)) {
            console2.log("HarvestAuction  :", address(r.auction));
            console2.log("Premium (USDG)  :", r.premiumToken);
        }
        for (uint256 i; i < r.tokens.length; ++i) {
            // Informasi saja (tidak membatalkan deploy): harga bisa basi atau pasar tutup saat skrip dijalankan.
            (IOracleRouter.Status s,,,) = r.router.tryGetReferencePrice(r.tokens[i]);
            console2.log(string.concat("  ", c.assets[i].symbol, " status harga acuan (0 = Ok):"), uint256(s));
        }
        console2.log("==================================================");
    }

    function _write(Config memory c, Result memory r) internal {
        string memory o = "deployment";
        vm.serializeString(o, "name", c.name);
        vm.serializeUint(o, "chainId", block.chainid);
        vm.serializeBool(o, "mocks", c.mocks);
        vm.serializeUint(o, "deployedAt", block.timestamp);
        vm.serializeAddress(o, "deployer", r.deployer);
        vm.serializeAddress(o, "admin", r.finalAdmin);
        vm.serializeAddress(o, "timelock", r.timelock);
        vm.serializeAddress(o, "sequencerFeed", r.sequencerFeed);
        vm.serializeAddress(o, "marketSession", address(r.session));
        vm.serializeAddress(o, "oracleRouter", address(r.router));
        vm.serializeAddress(o, "settlementOracle", address(r.settlement));
        vm.serializeAddress(o, "cordonVault", address(r.vault));
        vm.serializeAddress(o, "tokens", r.tokens);
        string memory out = vm.serializeAddress(o, "feeds", r.feeds);
        if (address(r.spurVault) != address(0)) out = vm.serializeAddress(o, "spurVault", address(r.spurVault));
        if (address(r.graftVault) != address(0)) out = vm.serializeAddress(o, "graftVault", address(r.graftVault));
        if (address(r.auction) != address(0)) {
            vm.serializeAddress(o, "harvestAuction", address(r.auction));
            out = vm.serializeAddress(o, "premiumToken", r.premiumToken);
        }

        string memory path = string.concat("deployments/", c.name, ".json");
        vm.writeJson(out, path);
        console2.log("Ditulis:", path);
    }
}
