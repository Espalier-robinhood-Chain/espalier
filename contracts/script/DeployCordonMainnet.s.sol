// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Script, console2} from "forge-std/Script.sol";
import {VmSafe} from "forge-std/Vm.sol";
import {IAccessControl} from "@openzeppelin/contracts/access/IAccessControl.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {OracleRouter} from "../src/OracleRouter.sol";
import {CordonVault} from "../src/CordonVault.sol";
import {Roles} from "../src/libraries/Roles.sol";

/// @title DeployCordonMainnet
/// @notice Menambah SATU CordonVault (mis. cCHIP, cVOLT) ke deployment MAINNET (4663) yang SUDAH ada, memakai
///         `OracleRouter` yang sama. Tidak men-deploy ulang MarketSession/OracleRouter/SettlementOracle/Spur/Graft/Auction.
/// @dev Pasangan mainnet dari `DeployCordon.s.sol` (yang tetap khusus testnet: ia membuat token + feed mock).
///
///      Prasyarat: semua aset vault SUDAH terdaftar di `OracleRouter` (lewat `assets` atau `routerAssets` pada deploy utama
///      `Deploy.s.sol`). Skrip ini TIDAK mendaftarkan aset: setelah serah-terima, ADMIN router adalah TimelockController,
///      jadi pendaftaran aset baru butuh jeda 48 jam. Aset yang belum terdaftar membuat skrip berhenti sebelum transaksi pertama.
///
///      Fail-closed (semua berjalan sebelum transaksi pertama, dalam simulasi): chain harus 4663, `addressesVerified=true`,
///      env `CONFIRM_MAINNET_DEPLOY=true`, `owner` harus kontrak (TimelockController) yang memegang ADMIN di router,
///      `keeper` terisi, token dan feed punya kode dan feed-nya sama dengan yang tercatat di router, aset tidak sedang di-pause.
///
///      Pengirim (`--account`/`--ledger`) menjadi ADMIN sementara untuk konfigurasi (peran KEEPER untuk pruning, fee, seed
///      opsional), lalu ADMIN diserahkan ke `owner` dan pengirim melepas perannya. Pengirim TIDAK perlu pemegang peran apa pun
///      di router. Kunci tidak dibaca dari env oleh skrip.
contract DeployCordonMainnet is Script {
    uint256 internal constant MAINNET_CHAIN_ID = 4663;
    uint256 internal constant MAX_COMPONENTS = 16;
    string internal constant DEFAULT_CONFIG = "script/config/cchip-mainnet.json";

    struct AssetCfg {
        string symbol;
        address token;
        address feed;
        uint16 targetBps;
    }

    struct Config {
        string name;
        uint256 chainId;
        bool addressesVerified;
        address router;
        address owner;
        address keeper;
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

    // ------------------------------------------------------------------ entry

    function run() external returns (Result memory) {
        string memory path = vm.envOr("CORDON_CONFIG", DEFAULT_CONFIG);
        console2.log("Config:", path);
        return deploy(vm.readFile(path));
    }

    /// Dipisah dari `run()` supaya test bisa memberi konfigurasi sebagai string.
    function deploy(string memory json) public returns (Result memory r) {
        Config memory c = _load(json);
        _validate(c);

        vm.startBroadcast();
        (, address sender,) = vm.readCallers();
        r.deployer = sender;
        require(sender != c.owner, "pengirim tidak boleh sama dengan owner (owner = timelock)");

        uint256 n = c.assets.length;
        r.tokens = new address[](n);
        r.feeds = new address[](n);
        uint16[] memory weights = new uint16[](n);
        for (uint256 i; i < n; ++i) {
            r.tokens[i] = c.assets[i].token;
            r.feeds[i] = c.assets[i].feed;
            weights[i] = c.assets[i].targetBps;
        }

        r.vault = new CordonVault(sender, c.router, c.cordonName, c.cordonSymbol, r.tokens, weights);
        _configure(c, r);
        _seed(c, r);
        _handover(c, r);
        vm.stopBroadcast();

        _verify(c, r);
        _report(c, r);
        if (vm.isContext(VmSafe.ForgeContext.ScriptBroadcast) || vm.isContext(VmSafe.ForgeContext.ScriptResume)) {
            _write(c, r);
        }
    }

    // ------------------------------------------------------------------ steps

    function _configure(Config memory c, Result memory r) internal {
        // Pruning Cordon memakai KEEPER_ROLE (sama dengan cMAG7 di Deploy.s.sol); venue dan slippage tetap ADMIN (timelock).
        r.vault.grantRole(Roles.KEEPER_ROLE, c.keeper);
        if (c.feeRecipient != address(0)) r.vault.setFeeRecipient(c.feeRecipient);
        if ((c.mintFeeBps | c.redeemFeeBps | c.managementFeeBps) != 0) {
            r.vault.setFees(c.mintFeeBps, c.redeemFeeBps, c.managementFeeBps);
        }
    }

    /// Seed memakai token ASLI yang dipegang pengirim (tanpa mint). Harus SEBELUM serah-terima ADMIN.
    function _seed(Config memory c, Result memory r) internal {
        if (!c.seedEnabled) return;
        for (uint256 i; i < r.tokens.length; ++i) {
            require(IERC20(r.tokens[i]).approve(address(r.vault), c.seedAmounts[i]), "approve gagal");
        }
        r.vault.seed(c.seedShares, c.seedTo, c.seedAmounts);
    }

    function _handover(Config memory c, Result memory r) internal {
        IAccessControl(address(r.vault)).grantRole(0x00, c.owner); // DEFAULT_ADMIN_ROLE -> timelock
        IAccessControl(address(r.vault)).renounceRole(0x00, r.deployer);
    }

    // ----------------------------------------------------------------- config

    function _load(string memory j) internal view returns (Config memory c) {
        c.name = vm.parseJsonString(j, ".name");
        c.chainId = vm.parseJsonUint(j, ".chainId");
        c.addressesVerified = vm.parseJsonBool(j, ".addressesVerified");
        c.router = vm.parseJsonAddress(j, ".router");
        c.owner = vm.parseJsonAddress(j, ".owner");
        c.keeper = vm.parseJsonAddress(j, ".keeper");
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
        address[] memory feeds = abi.decode(vm.parseJson(j, ".assets[*].feed"), (address[]));
        uint256[] memory bps = abi.decode(vm.parseJson(j, ".assets[*].targetBps"), (uint256[]));
        a = new AssetCfg[](symbols.length);
        for (uint256 i; i < symbols.length; ++i) {
            a[i] = AssetCfg({
                symbol: symbols[i],
                token: tokens[i],
                feed: feeds[i],
                targetBps: uint16(_bound(bps[i], type(uint16).max))
            });
        }
    }

    function _bound(uint256 v, uint256 max) internal pure returns (uint256) {
        require(v <= max, "config: angka melebihi batas tipe");
        return v;
    }

    function _validate(Config memory c) internal view {
        require(block.chainid == MAINNET_CHAIN_ID, "skrip ini khusus mainnet (4663); testnet pakai DeployCordon.s.sol");
        require(block.chainid == c.chainId, "chainId RPC tidak sama dengan chainId di konfigurasi");
        require(c.addressesVerified, "config: addressesVerified harus true (jalankan script/verify-addresses.sh dulu)");
        require(vm.envOr("CONFIRM_MAINNET_DEPLOY", false), "mainnet: set env CONFIRM_MAINNET_DEPLOY=true untuk melanjutkan");
        require(bytes(c.name).length != 0, "config: name kosong");
        require(bytes(c.cordonName).length != 0 && bytes(c.cordonSymbol).length != 0, "config: nama/simbol Cordon");

        require(c.router != address(0) && c.router.code.length != 0, "config: router kosong / tanpa kode di chain ini");
        require(c.owner != address(0) && c.owner.code.length != 0, "config: owner harus kontrak TimelockController, bukan EOA");
        require(
            OracleRouter(c.router).hasRole(0x00, c.owner),
            "config: owner bukan ADMIN OracleRouter (harus timelock hasil deploy utama)"
        );
        require(c.keeper != address(0), "config: keeper wajib (pruning Cordon butuh KEEPER_ROLE)");
        require(c.keeper != c.owner, "config: keeper tidak boleh sama dengan owner");

        _validateAssets(c);

        if ((c.mintFeeBps | c.redeemFeeBps | c.managementFeeBps) != 0) {
            require(c.feeRecipient != address(0), "config: fee > 0 butuh fees.recipient");
        }
        if (c.seedEnabled) {
            uint256 n = c.assets.length;
            require(c.seedTo != address(0), "config: seed.to kosong");
            require(c.seedShares != 0, "config: seed.shares 0");
            require(c.seedAmounts.length == n, "config: seed.amounts harus sebanyak aset");
            for (uint256 i; i < n; ++i) {
                require(c.seedAmounts[i] != 0, "config: seed.amounts berisi 0");
            }
        }
    }

    function _validateAssets(Config memory c) internal view {
        uint256 n = c.assets.length;
        require(n != 0 && n <= MAX_COMPONENTS, "config: jumlah aset harus 1-16");
        uint256 sum;
        for (uint256 i; i < n; ++i) {
            sum += c.assets[i].targetBps;
            _validateAsset(OracleRouter(c.router), c.assets[i]);
            for (uint256 j; j < i; ++j) {
                require(c.assets[j].token != c.assets[i].token, "config: token aset ganda");
                require(
                    keccak256(bytes(c.assets[j].symbol)) != keccak256(bytes(c.assets[i].symbol)),
                    "config: simbol aset ganda"
                );
            }
        }
        require(sum == 10_000, "config: jumlah targetBps harus 10000");
    }

    function _validateAsset(OracleRouter router, AssetCfg memory a) internal view {
        require(a.targetBps != 0, string.concat("config: targetBps 0 untuk ", a.symbol));
        require(a.token != address(0) && a.token.code.length != 0, string.concat("config: token tanpa kode: ", a.symbol));
        require(a.feed != address(0) && a.feed.code.length != 0, string.concat("config: feed tanpa kode: ", a.symbol));
        // Harus sudah terdaftar di router, dengan feed yang sama persis seperti di konfigurasi.
        require(
            address(router.assetConfig(a.token).feed) == a.feed,
            string.concat("config: ", a.symbol, " belum terdaftar di OracleRouter / feed berbeda dari router")
        );
        require(!router.isAssetPaused(a.token), string.concat("config: aset sedang di-pause di router: ", a.symbol));
    }

    // ----------------------------------------------------------------- verify

    function _verify(Config memory c, Result memory r) internal view {
        OracleRouter router = OracleRouter(c.router);
        require(address(r.vault.ROUTER()) == c.router, "verify: vault.ROUTER");
        require(r.vault.hasRole(0x00, c.owner), "verify: owner bukan ADMIN vault");
        require(!r.vault.hasRole(0x00, r.deployer), "verify: deployer masih ADMIN vault");
        require(r.vault.hasRole(Roles.KEEPER_ROLE, c.keeper), "verify: KEEPER (cordon)");

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
        require(r.vault.feeRecipient() == c.feeRecipient, "verify: fee recipient");
        if (c.seedEnabled) {
            require(r.vault.totalSupply() == c.seedShares, "verify: supply seed");
            require(r.vault.balanceOf(c.seedTo) == c.seedShares, "verify: saldo seed");
        } else {
            require(r.vault.totalSupply() == 0, "verify: supply bukan 0");
        }
    }

    // ----------------------------------------------------------------- output

    function _report(Config memory c, Result memory r) internal view {
        console2.log("==================================================");
        console2.log("Cordon baru     :", c.cordonSymbol);
        console2.log("CordonVault     :", address(r.vault));
        console2.log("Pengirim        :", r.deployer);
        console2.log("ADMIN vault     :", c.owner);
        console2.log("KEEPER vault    :", c.keeper);
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
        vm.serializeAddress(o, "keeper", c.keeper);
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
