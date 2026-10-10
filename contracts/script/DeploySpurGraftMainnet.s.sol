// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Script, console2} from "forge-std/Script.sol";
import {VmSafe} from "forge-std/Vm.sol";
import {OracleRouter} from "../src/OracleRouter.sol";
import {SettlementOracle} from "../src/SettlementOracle.sol";
import {SpurVault} from "../src/SpurVault.sol";
import {GraftVault} from "../src/GraftVault.sol";
import {HarvestAuction} from "../src/HarvestAuction.sol";
import {Roles} from "../src/libraries/Roles.sol";

/// @title DeploySpurGraftMainnet
/// @notice Menambah HarvestAuction + SATU SpurVault + SATU GraftVault ke deployment MAINNET (4663) yang SUDAH ada,
///         memakai OracleRouter dan SettlementOracle yang sama. Tidak men-deploy ulang apa pun yang sudah ada.
/// @dev Pasangan mainnet dari bagian spur/graft di `Deploy.s.sol` (yang hanya bisa dijalankan sebagai deploy penuh) dan dari
///      `DeploySpur.s.sol` (yang menolak mainnet). Pola dan urutannya mengikuti `DeployCordonMainnet.s.sol`.
///
///      Fail-closed (semua dalam simulasi, sebelum transaksi pertama): chain 4663, `addressesVerified=true`, env
///      `CONFIRM_MAINNET_DEPLOY=true`, `owner` harus kontrak (TimelockController) yang memegang ADMIN di router,
///      keeper dan guardian wajib, aset sudah terdaftar di router dan tidak di-pause, settlement milik router yang sama,
///      depositCap kedua vault WAJIB tidak nol, picker berbeda dari keeper/guardian/owner/pengirim.
///
///      Pengirim menjadi ADMIN sementara untuk konfigurasi (KEEPER, GUARDIAN, Picker), lalu ADMIN diserahkan ke `owner`
///      (timelock) dan pengirim melepas perannya, untuk ketiga kontrak. Picker didaftarkan SEKARANG karena sesudah serah-terima
///      menambah Picker harus lewat timelock 48 jam. Kunci tidak dibaca dari env oleh skrip.
contract DeploySpurGraftMainnet is Script {
    uint256 internal constant MAINNET_CHAIN_ID = 4663;
    // Cermin batas di SpurVault/GraftVault, supaya kesalahan konfigurasi berhenti dengan pesan yang jelas.
    uint256 internal constant MIN_OTM_BPS = 100;
    uint256 internal constant MAX_OTM_BPS = 5_000;
    uint256 internal constant MAX_MIN_PREMIUM_BPS = 2_000;
    uint256 internal constant MIN_FILL_WINDOW = 1 hours;
    uint256 internal constant MAX_FILL_WINDOW = 2 days;
    string internal constant DEFAULT_CONFIG = "script/config/spurgraft-mainnet.json";

    struct VaultCfg {
        uint256 fillWindow;
        uint256 minDeposit;
        uint256 depositCap;
        uint256 otmBps;
        uint256 minPremiumBps;
    }

    struct Config {
        string name;
        uint256 chainId;
        bool addressesVerified;
        address router;
        address settlement;
        address owner;
        address keeper;
        address guardian;
        address usdg;
        address asset;
        string assetSymbol;
        address picker;
        VaultCfg spur;
        VaultCfg graft;
    }

    struct Result {
        address deployer;
        HarvestAuction auction;
        SpurVault spurVault;
        GraftVault graftVault;
    }

    // ------------------------------------------------------------------ entry

    function run() external returns (Result memory) {
        string memory path = vm.envOr("SPURGRAFT_CONFIG", DEFAULT_CONFIG);
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
        require(
            sender != c.owner && sender != c.keeper && sender != c.guardian && sender != c.picker,
            "pengirim harus dompet deployer terpisah (bukan owner/keeper/guardian/picker)"
        );

        r.auction = new HarvestAuction(sender);
        r.spurVault = _newSpur(c, r);
        r.graftVault = _newGraft(c, r);
        _configure(c, r);
        _handover(c, r);
        vm.stopBroadcast();

        _verifyAuction(c, r);
        _verifySpur(c, r);
        _verifyGraft(c, r);
        _report(c, r);
        if (vm.isContext(VmSafe.ForgeContext.ScriptBroadcast) || vm.isContext(VmSafe.ForgeContext.ScriptResume)) {
            _write(c, r);
        }
    }

    // ------------------------------------------------------------------ steps

    function _newSpur(Config memory c, Result memory r) internal returns (SpurVault) {
        VaultCfg memory s = c.spur;
        return new SpurVault(
            r.deployer,
            c.asset,
            c.usdg,
            c.router,
            c.settlement,
            address(r.auction),
            uint32(s.fillWindow),
            s.minDeposit,
            s.depositCap,
            uint16(s.otmBps),
            uint16(s.minPremiumBps)
        );
    }

    /// GraftVault: ASSET = USDG (collateral), UNDERLYING = aset acuan harga (urutan sama dengan Deploy.s.sol).
    function _newGraft(Config memory c, Result memory r) internal returns (GraftVault) {
        VaultCfg memory g = c.graft;
        return new GraftVault(
            r.deployer,
            c.usdg,
            c.asset,
            c.router,
            c.settlement,
            address(r.auction),
            uint32(g.fillWindow),
            g.minDeposit,
            g.depositCap,
            uint16(g.otmBps),
            uint16(g.minPremiumBps)
        );
    }

    function _configure(Config memory c, Result memory r) internal {
        r.spurVault.grantRole(Roles.KEEPER_ROLE, c.keeper);
        r.graftVault.grantRole(Roles.KEEPER_ROLE, c.keeper);
        r.auction.grantRole(Roles.KEEPER_ROLE, c.keeper);
        r.spurVault.grantRole(Roles.GUARDIAN_ROLE, c.guardian);
        r.graftVault.grantRole(Roles.GUARDIAN_ROLE, c.guardian);
        r.auction.setPicker(c.picker, true);
    }

    function _handover(Config memory c, Result memory r) internal {
        _handoverOne(address(r.auction), c.owner, r.deployer);
        _handoverOne(address(r.spurVault), c.owner, r.deployer);
        _handoverOne(address(r.graftVault), c.owner, r.deployer);
    }

    function _handoverOne(address target, address admin, address deployer) internal {
        (bool ok1,) = target.call(abi.encodeWithSignature("grantRole(bytes32,address)", bytes32(0), admin));
        require(ok1, "handover: grantRole ADMIN gagal");
        (bool ok2,) = target.call(abi.encodeWithSignature("renounceRole(bytes32,address)", bytes32(0), deployer));
        require(ok2, "handover: renounceRole deployer gagal");
    }

    // ----------------------------------------------------------------- config

    function _load(string memory j) internal view returns (Config memory c) {
        c.name = vm.parseJsonString(j, ".name");
        c.chainId = vm.parseJsonUint(j, ".chainId");
        c.addressesVerified = vm.parseJsonBool(j, ".addressesVerified");
        c.router = vm.parseJsonAddress(j, ".router");
        c.settlement = vm.parseJsonAddress(j, ".settlement");
        c.owner = vm.parseJsonAddress(j, ".owner");
        c.keeper = vm.parseJsonAddress(j, ".keeper");
        c.guardian = vm.parseJsonAddress(j, ".guardian");
        c.usdg = vm.parseJsonAddress(j, ".usdg");
        c.asset = vm.parseJsonAddress(j, ".asset");
        c.assetSymbol = vm.parseJsonString(j, ".assetSymbol");
        c.picker = vm.parseJsonAddress(j, ".picker");
        c.spur = _loadVault(j, ".spur");
        c.graft = _loadVault(j, ".graft");
    }

    /// Angka besar ditulis sebagai string di JSON (angka JSON kehilangan presisi di atas 2^53).
    function _loadVault(string memory j, string memory k) internal pure returns (VaultCfg memory v) {
        v.fillWindow = _u(j, string.concat(k, ".fillWindowSeconds"));
        v.minDeposit = _u(j, string.concat(k, ".minDeposit"));
        v.depositCap = _u(j, string.concat(k, ".depositCap"));
        v.otmBps = _u(j, string.concat(k, ".otmBps"));
        v.minPremiumBps = _u(j, string.concat(k, ".minPremiumBps"));
    }

    function _u(string memory j, string memory key) internal pure returns (uint256) {
        return vm.parseUint(vm.parseJsonString(j, key));
    }

    function _validate(Config memory c) internal view {
        require(block.chainid == MAINNET_CHAIN_ID, "skrip ini khusus mainnet (4663)");
        require(block.chainid == c.chainId, "chainId RPC tidak sama dengan chainId di konfigurasi");
        require(c.addressesVerified, "config: addressesVerified harus true (jalankan script/verify-addresses.sh dulu)");
        require(vm.envOr("CONFIRM_MAINNET_DEPLOY", false), "mainnet: set env CONFIRM_MAINNET_DEPLOY=true untuk melanjutkan");
        require(bytes(c.name).length != 0, "config: name kosong");

        require(c.router != address(0) && c.router.code.length != 0, "config: router kosong / tanpa kode");
        require(c.owner != address(0) && c.owner.code.length != 0, "config: owner harus kontrak TimelockController, bukan EOA");
        require(OracleRouter(c.router).hasRole(0x00, c.owner), "config: owner bukan ADMIN OracleRouter (harus timelock deploy utama)");
        require(c.settlement != address(0) && c.settlement.code.length != 0, "config: settlement kosong / tanpa kode");
        require(address(SettlementOracle(c.settlement).ROUTER()) == c.router, "config: settlement bukan milik router ini");

        require(c.keeper != address(0) && c.guardian != address(0), "config: keeper dan guardian wajib");
        require(c.keeper != c.owner && c.guardian != c.owner, "config: keeper/guardian tidak boleh sama dengan owner");
        require(c.keeper != c.guardian, "config: keeper dan guardian harus berbeda");

        require(c.usdg != address(0) && c.usdg.code.length != 0, "config: usdg kosong / tanpa kode");
        require(c.asset != address(0) && c.asset.code.length != 0, "config: asset kosong / tanpa kode");
        require(
            address(OracleRouter(c.router).assetConfig(c.asset).feed) != address(0),
            string.concat("config: ", c.assetSymbol, " belum terdaftar di OracleRouter")
        );
        require(!OracleRouter(c.router).isAssetPaused(c.asset), string.concat("config: aset sedang di-pause: ", c.assetSymbol));

        require(c.picker != address(0), "config: picker wajib (menambahkannya nanti butuh timelock 48 jam)");
        require(
            c.picker != c.keeper && c.picker != c.guardian && c.picker != c.owner,
            "config: picker harus dompet terpisah dari keeper/guardian/owner"
        );

        _validateVault(c.spur, "spur");
        _validateVault(c.graft, "graft");
    }

    function _validateVault(VaultCfg memory v, string memory n) internal pure {
        require(v.otmBps >= MIN_OTM_BPS && v.otmBps <= MAX_OTM_BPS, string.concat("config: ", n, ".otmBps di luar 100-5000"));
        require(v.minPremiumBps <= MAX_MIN_PREMIUM_BPS, string.concat("config: ", n, ".minPremiumBps di atas 2000"));
        require(
            v.fillWindow >= MIN_FILL_WINDOW && v.fillWindow <= MAX_FILL_WINDOW,
            string.concat("config: ", n, ".fillWindowSeconds di luar 3600-172800")
        );
        require(v.minDeposit != 0, string.concat("config: ", n, ".minDeposit 0"));
        // Cap permanen di kontrak; di mainnet wajib eksplisit dan tidak nol (sama dengan aturan Deploy.s.sol).
        require(v.depositCap != 0, string.concat("config: ", n, ".depositCap tidak boleh 0"));
        require(v.depositCap >= v.minDeposit, string.concat("config: ", n, ".depositCap lebih kecil dari minDeposit"));
    }

    // ----------------------------------------------------------------- verify

    function _verifyAuction(Config memory c, Result memory r) internal view {
        HarvestAuction a = r.auction;
        require(a.hasRole(0x00, c.owner), "verify: owner bukan ADMIN auction");
        require(!a.hasRole(0x00, r.deployer), "verify: deployer masih ADMIN auction");
        require(a.hasRole(Roles.KEEPER_ROLE, c.keeper), "verify: auction KEEPER");
        require(a.isPicker(c.picker), "verify: picker belum terdaftar");
    }

    function _verifySpur(Config memory c, Result memory r) internal view {
        SpurVault v = r.spurVault;
        require(v.hasRole(0x00, c.owner), "verify: owner bukan ADMIN spur");
        require(!v.hasRole(0x00, r.deployer), "verify: deployer masih ADMIN spur");
        require(address(v.ASSET()) == c.asset, "verify: spur.ASSET");
        require(address(v.PREMIUM()) == c.usdg, "verify: spur.PREMIUM");
        require(address(v.ROUTER()) == c.router, "verify: spur.ROUTER");
        require(address(v.SETTLEMENT()) == c.settlement, "verify: spur.SETTLEMENT");
        require(v.AUCTION() == address(r.auction), "verify: spur.AUCTION");
        require(v.FILL_WINDOW() == c.spur.fillWindow, "verify: spur.fillWindow");
        require(v.MIN_DEPOSIT() == c.spur.minDeposit, "verify: spur.minDeposit");
        require(v.depositCap() == c.spur.depositCap, "verify: spur.depositCap");
        require(v.otmBps() == c.spur.otmBps, "verify: spur.otmBps");
        require(v.minPremiumBps() == c.spur.minPremiumBps, "verify: spur.minPremiumBps");
        require(v.hasRole(Roles.KEEPER_ROLE, c.keeper), "verify: spur KEEPER");
        require(v.hasRole(Roles.GUARDIAN_ROLE, c.guardian), "verify: spur GUARDIAN");
        require(v.round() == 0 && !v.active() && v.totalShares() == 0, "verify: spur state awal");
    }

    function _verifyGraft(Config memory c, Result memory r) internal view {
        GraftVault v = r.graftVault;
        require(v.hasRole(0x00, c.owner), "verify: owner bukan ADMIN graft");
        require(!v.hasRole(0x00, r.deployer), "verify: deployer masih ADMIN graft");
        require(address(v.ASSET()) == c.usdg && address(v.PREMIUM()) == c.usdg, "verify: graft.ASSET/PREMIUM");
        require(address(v.UNDERLYING()) == c.asset, "verify: graft.UNDERLYING");
        require(address(v.ROUTER()) == c.router, "verify: graft.ROUTER");
        require(address(v.SETTLEMENT()) == c.settlement, "verify: graft.SETTLEMENT");
        require(v.AUCTION() == address(r.auction), "verify: graft.AUCTION");
        require(v.FILL_WINDOW() == c.graft.fillWindow, "verify: graft.fillWindow");
        require(v.MIN_DEPOSIT() == c.graft.minDeposit, "verify: graft.minDeposit");
        require(v.depositCap() == c.graft.depositCap, "verify: graft.depositCap");
        require(v.otmBps() == c.graft.otmBps, "verify: graft.otmBps");
        require(v.minPremiumBps() == c.graft.minPremiumBps, "verify: graft.minPremiumBps");
        require(v.hasRole(Roles.KEEPER_ROLE, c.keeper), "verify: graft KEEPER");
        require(v.hasRole(Roles.GUARDIAN_ROLE, c.guardian), "verify: graft GUARDIAN");
        require(v.round() == 0 && !v.active() && v.totalShares() == 0, "verify: graft state awal");
    }

    // ----------------------------------------------------------------- output

    function _report(Config memory c, Result memory r) internal pure {
        console2.log("==================================================");
        console2.log("Spur + Graft (aset acuan):", c.assetSymbol);
        console2.log("HarvestAuction  :", address(r.auction));
        console2.log("SpurVault       :", address(r.spurVault));
        console2.log("GraftVault      :", address(r.graftVault));
        console2.log("Pengirim        :", r.deployer);
        console2.log("ADMIN (timelock):", c.owner);
        console2.log("KEEPER          :", c.keeper);
        console2.log("GUARDIAN        :", c.guardian);
        console2.log("Picker          :", c.picker);
        console2.log("USDG            :", c.usdg);
        console2.log("spur.depositCap :", c.spur.depositCap);
        console2.log("graft.depositCap:", c.graft.depositCap);
        console2.log("==================================================");
    }

    function _write(Config memory c, Result memory r) internal {
        string memory o = "spurGraftDeployment";
        vm.serializeString(o, "name", c.name);
        vm.serializeUint(o, "chainId", block.chainid);
        vm.serializeUint(o, "deployedAt", block.timestamp);
        vm.serializeAddress(o, "deployer", r.deployer);
        vm.serializeAddress(o, "admin", c.owner);
        vm.serializeAddress(o, "keeper", c.keeper);
        vm.serializeAddress(o, "guardian", c.guardian);
        vm.serializeAddress(o, "picker", c.picker);
        vm.serializeAddress(o, "oracleRouter", c.router);
        vm.serializeAddress(o, "settlementOracle", c.settlement);
        vm.serializeAddress(o, "premiumToken", c.usdg);
        vm.serializeAddress(o, "asset", c.asset);
        vm.serializeAddress(o, "harvestAuction", address(r.auction));
        vm.serializeAddress(o, "spurVault", address(r.spurVault));
        string memory out = vm.serializeAddress(o, "graftVault", address(r.graftVault));
        string memory path = string.concat("deployments/", c.name, ".json");
        vm.writeJson(out, path);
        console2.log("Ditulis:", path);
    }
}
