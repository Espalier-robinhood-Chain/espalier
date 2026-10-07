// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Script, console2} from "forge-std/Script.sol";
import {VmSafe} from "forge-std/Vm.sol";
import {IAccessControl} from "@openzeppelin/contracts/access/IAccessControl.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {OracleRouter} from "../src/OracleRouter.sol";
import {CordonVault} from "../src/CordonVault.sol";
import {MockERC20} from "../test/mocks/MockERC20.sol";
import {MockAggregator} from "../test/mocks/MockAggregator.sol";

/// @title DeployCordon
/// @notice Menambah SATU CordonVault baru (mis. cCHIP) ke deployment testnet yang SUDAH ada, memakai `OracleRouter` yang sama.
///         Tidak men-deploy ulang MarketSession/OracleRouter/SettlementOracle/Spur/Graft/Auction.
/// @dev Khusus Robinhood Chain Testnet (46630) dan rehearsal lokal: mainnet (4663) selalu ditolak.
///      Aset dengan `token` = alamat nol dibuat sebagai token mock + feed mock lalu didaftarkan ke router.
///      Aset dengan `token` terisi dianggap SUDAH terdaftar di router (mis. NVDA mock dari deploy pertama): hanya dipakai ulang.
///
///      PENGIRIM (`--account`) HARUS pemegang DEFAULT_ADMIN_ROLE di OracleRouter (di deploy B1 itu `espalier-owner`),
///      karena mendaftarkan aset baru memanggil `setAssetWindows`. Skrip berhenti sebelum mengirim transaksi bila bukan.
///      Pengirim menjadi ADMIN CordonVault baru; bila `owner` di konfigurasi berbeda, ADMIN diserahkan ke `owner`.
///      Seed memakai `mint` publik milik token mock, jadi hanya berjalan untuk token mock.
contract DeployCordon is Script {
    uint256 internal constant MAINNET_CHAIN_ID = 4663;
    uint256 internal constant MAX_COMPONENTS = 16;
    string internal constant DEFAULT_CONFIG = "script/config/cchip-testnet-mock.json";

    struct AssetCfg {
        string symbol;
        address token; // 0 = buat mock baru
        address feed; // diabaikan bila token = 0
        uint32 stalenessRegular;
        uint32 stalenessExtended;
        uint32 stalenessOvernight;
        bool checkOraclePause;
        uint16 targetBps;
        uint256 mockPriceE8;
    }

    struct Config {
        string name;
        uint256 chainId;
        address router;
        address owner;
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
        AssetCfg[] assets;
    }

    struct Result {
        address deployer;
        CordonVault vault;
        address[] tokens;
        address[] feeds;
    }

    function run() external returns (Result memory) {
        string memory path = vm.envOr("CORDON_CONFIG", DEFAULT_CONFIG);
        console2.log("Config:", path);
        return deploy(vm.readFile(path));
    }

    function deploy(string memory json) public returns (Result memory r) {
        Config memory c = _load(json);
        _validate(c);

        vm.startBroadcast();
        (, address sender,) = vm.readCallers();
        r.deployer = sender;
        require(
            OracleRouter(c.router).hasRole(0x00, sender), "pengirim bukan ADMIN OracleRouter (pakai --account espalier-owner)"
        );

        uint16[] memory weights = _registerAssets(c, r);
        r.vault = new CordonVault(sender, c.router, c.cordonName, c.cordonSymbol, r.tokens, weights);
        _configureFees(c, r);
        _seed(c, r);

        if (c.owner != sender) {
            IAccessControl(address(r.vault)).grantRole(0x00, c.owner);
            IAccessControl(address(r.vault)).renounceRole(0x00, sender);
        }
        vm.stopBroadcast();

        _verify(c, r);
        _report(c, r);
        if (vm.isContext(VmSafe.ForgeContext.ScriptBroadcast) || vm.isContext(VmSafe.ForgeContext.ScriptResume)) {
            _write(c, r);
        }
    }

    /// Aset baru (token = 0): token + feed mock lalu daftar ke router. Aset yang sudah ada: hanya dipakai ulang.
    function _registerAssets(Config memory c, Result memory r) internal returns (uint16[] memory weights) {
        uint256 n = c.assets.length;
        r.tokens = new address[](n);
        r.feeds = new address[](n);
        weights = new uint16[](n);
        for (uint256 i; i < n; ++i) {
            weights[i] = c.assets[i].targetBps;
            if (c.assets[i].token == address(0)) {
                _newMockAsset(c, r, i);
            } else {
                r.tokens[i] = c.assets[i].token;
                address existing = address(OracleRouter(c.router).assetConfig(c.assets[i].token).feed);
                require(
                    existing != address(0), string.concat("config: ", c.assets[i].symbol, " belum terdaftar di OracleRouter")
                );
                r.feeds[i] = existing;
            }
        }
    }

    function _newMockAsset(Config memory c, Result memory r, uint256 i) internal {
        AssetCfg memory a = c.assets[i];
        r.tokens[i] = address(new MockERC20(a.symbol, a.symbol, 18));
        MockAggregator feed = new MockAggregator(8);
        feed.setRound(int256(a.mockPriceE8));
        r.feeds[i] = address(feed);
        OracleRouter(c.router)
            .setAssetWindows(
                r.tokens[i], r.feeds[i], a.stalenessRegular, a.stalenessExtended, a.stalenessOvernight, a.checkOraclePause
            );
    }

    function _configureFees(Config memory c, Result memory r) internal {
        if (c.feeRecipient != address(0)) r.vault.setFeeRecipient(c.feeRecipient);
        if ((c.mintFeeBps | c.redeemFeeBps | c.managementFeeBps) != 0) {
            r.vault.setFees(c.mintFeeBps, c.redeemFeeBps, c.managementFeeBps);
        }
    }

    /// Seed memakai `mint` publik token mock (pengirim mencetak untuk dirinya, approve, lalu `seed`).
    function _seed(Config memory c, Result memory r) internal {
        if (!c.seedEnabled) return;
        for (uint256 i; i < r.tokens.length; ++i) {
            MockERC20(r.tokens[i]).mint(r.deployer, c.seedAmounts[i]);
            require(IERC20(r.tokens[i]).approve(address(r.vault), c.seedAmounts[i]), "approve gagal");
        }
        r.vault.seed(c.seedShares, c.seedTo, c.seedAmounts);
    }

    // ----------------------------------------------------------------- config

    function _load(string memory j) internal view returns (Config memory c) {
        c.name = vm.parseJsonString(j, ".name");
        c.chainId = vm.parseJsonUint(j, ".chainId");
        c.router = vm.parseJsonAddress(j, ".router");
        c.owner = vm.parseJsonAddress(j, ".owner");
        c.cordonName = vm.parseJsonString(j, ".cordon.name");
        c.cordonSymbol = vm.parseJsonString(j, ".cordon.symbol");
        c.mintFeeBps = uint16(_bound(vm.parseJsonUint(j, ".fees.mintBps"), type(uint16).max));
        c.redeemFeeBps = uint16(_bound(vm.parseJsonUint(j, ".fees.redeemBps"), type(uint16).max));
        c.managementFeeBps = uint16(_bound(vm.parseJsonUint(j, ".fees.managementBps"), type(uint16).max));
        c.feeRecipient = vm.parseJsonAddress(j, ".fees.recipient");
        _loadSeed(j, c);
        c.assets = _loadAssets(j);
    }

    function _loadSeed(string memory j, Config memory c) internal view {
        c.seedEnabled = vm.parseJsonBool(j, ".seed.enabled");
        c.seedTo = vm.parseJsonAddress(j, ".seed.to");
        c.seedShares = vm.parseUint(vm.parseJsonString(j, ".seed.shares"));
        string[] memory amounts = vm.parseJsonStringArray(j, ".seed.amounts");
        c.seedAmounts = new uint256[](amounts.length);
        for (uint256 i; i < amounts.length; ++i) {
            c.seedAmounts[i] = vm.parseUint(amounts[i]);
        }
    }

    function _loadAssets(string memory j) internal pure returns (AssetCfg[] memory a) {
        string[] memory symbols = abi.decode(vm.parseJson(j, ".assets[*].symbol"), (string[]));
        address[] memory tokens = abi.decode(vm.parseJson(j, ".assets[*].token"), (address[]));
        bool[] memory chk = abi.decode(vm.parseJson(j, ".assets[*].checkOraclePause"), (bool[]));
        uint256[] memory bps = abi.decode(vm.parseJson(j, ".assets[*].targetBps"), (uint256[]));
        uint256[] memory prices = abi.decode(vm.parseJson(j, ".assets[*].mockPriceE8"), (uint256[]));
        a = new AssetCfg[](symbols.length);
        for (uint256 i; i < symbols.length; ++i) {
            a[i].symbol = symbols[i];
            a[i].token = tokens[i];
            a[i].checkOraclePause = chk[i];
            a[i].targetBps = uint16(_bound(bps[i], type(uint16).max));
            a[i].mockPriceE8 = prices[i];
        }
        _loadWindows(j, a);
    }

    function _loadWindows(string memory j, AssetCfg[] memory a) internal pure {
        uint256[] memory reg = abi.decode(vm.parseJson(j, ".assets[*].stalenessRegularSeconds"), (uint256[]));
        uint256[] memory ext = abi.decode(vm.parseJson(j, ".assets[*].stalenessExtendedSeconds"), (uint256[]));
        uint256[] memory ovn = abi.decode(vm.parseJson(j, ".assets[*].stalenessOvernightSeconds"), (uint256[]));
        for (uint256 i; i < a.length; ++i) {
            a[i].stalenessRegular = uint32(_bound(reg[i], type(uint32).max));
            a[i].stalenessExtended = uint32(_bound(ext[i], type(uint32).max));
            a[i].stalenessOvernight = uint32(_bound(ovn[i], type(uint32).max));
        }
    }

    function _bound(uint256 v, uint256 max) internal pure returns (uint256) {
        require(v <= max, "config: angka melebihi batas tipe");
        return v;
    }

    function _validate(Config memory c) internal view {
        require(block.chainid != MAINNET_CHAIN_ID, "skrip ini tidak untuk mainnet (4663)");
        require(block.chainid == c.chainId, "chainId RPC tidak sama dengan chainId di konfigurasi");
        require(bytes(c.name).length != 0, "config: name kosong");
        require(c.router != address(0) && c.router.code.length != 0, "config: router kosong / tanpa kode di chain ini");
        require(c.owner != address(0), "config: owner kosong");
        require(bytes(c.cordonName).length != 0 && bytes(c.cordonSymbol).length != 0, "config: nama/simbol Cordon");

        uint256 n = c.assets.length;
        require(n != 0 && n <= MAX_COMPONENTS, "config: jumlah aset harus 1-16");
        uint256 sum;
        for (uint256 i; i < n; ++i) {
            AssetCfg memory a = c.assets[i];
            require(a.targetBps != 0, "config: targetBps 0");
            sum += a.targetBps;
            if (a.token == address(0)) {
                require(a.mockPriceE8 != 0, "config: mockPriceE8 0");
                require(
                    a.stalenessRegular != 0 && a.stalenessExtended != 0 && a.stalenessOvernight != 0,
                    "config: jendela staleness 0"
                );
            } else {
                require(a.token.code.length != 0, "config: token tanpa kode di chain ini");
            }
            for (uint256 j; j < i; ++j) {
                require(
                    keccak256(bytes(c.assets[j].symbol)) != keccak256(bytes(a.symbol)), "config: simbol aset ganda"
                );
            }
        }
        require(sum == 10_000, "config: jumlah targetBps harus 10000");

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
    }

    // ----------------------------------------------------------------- verify

    function _verify(Config memory c, Result memory r) internal view {
        OracleRouter router = OracleRouter(c.router);
        require(address(r.vault.ROUTER()) == c.router, "verify: vault.ROUTER");
        require(r.vault.hasRole(0x00, c.owner), "verify: owner bukan ADMIN vault");
        if (c.owner != r.deployer) require(!r.vault.hasRole(0x00, r.deployer), "verify: deployer masih ADMIN vault");

        address[] memory comps = r.vault.components();
        uint16[] memory weights = r.vault.targetWeightsBps();
        require(comps.length == c.assets.length, "verify: jumlah komponen");
        for (uint256 i; i < comps.length; ++i) {
            require(comps[i] == r.tokens[i] && weights[i] == c.assets[i].targetBps, "verify: komponen/bobot");
            require(address(router.assetConfig(r.tokens[i]).feed) == r.feeds[i], "verify: feed aset");
        }
        require(r.vault.mintFeeBps() == c.mintFeeBps, "verify: mint fee");
        require(r.vault.redeemFeeBps() == c.redeemFeeBps, "verify: redeem fee");
        require(r.vault.managementFeeBps() == c.managementFeeBps, "verify: management fee");
        if (c.seedEnabled) {
            require(r.vault.totalSupply() == c.seedShares, "verify: supply seed");
            require(r.vault.balanceOf(c.seedTo) == c.seedShares, "verify: saldo seed");
        }
    }

    // ----------------------------------------------------------------- output

    function _report(Config memory c, Result memory r) internal view {
        console2.log("==================================================");
        console2.log("Cordon baru     :", c.cordonSymbol);
        console2.log("CordonVault     :", address(r.vault));
        console2.log("Pengirim        :", r.deployer);
        console2.log("ADMIN vault     :", c.owner);
        for (uint256 i; i < r.tokens.length; ++i) {
            console2.log(string.concat("  ", c.assets[i].symbol, " token:"), r.tokens[i]);
            console2.log(string.concat("  ", c.assets[i].symbol, " feed :"), r.feeds[i]);
        }
        console2.log("==================================================");
    }

    function _write(Config memory c, Result memory r) internal {
        string memory o = "cordonDeployment";
        vm.serializeString(o, "name", c.name);
        vm.serializeUint(o, "chainId", block.chainid);
        vm.serializeUint(o, "deployedAt", block.timestamp);
        vm.serializeAddress(o, "deployer", r.deployer);
        vm.serializeAddress(o, "admin", c.owner);
        vm.serializeAddress(o, "oracleRouter", c.router);
        vm.serializeString(o, "symbol", c.cordonSymbol);
        vm.serializeAddress(o, "cordonVault", address(r.vault));
        vm.serializeAddress(o, "tokens", r.tokens);
        string memory out = vm.serializeAddress(o, "feeds", r.feeds);
        string memory path = string.concat("deployments/", c.name, ".json");
        vm.writeJson(out, path);
        console2.log("Ditulis:", path);
    }
}
