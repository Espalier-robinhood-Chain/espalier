// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Script, console2} from "forge-std/Script.sol";
import {VmSafe} from "forge-std/Vm.sol";
import {IAccessControl} from "@openzeppelin/contracts/access/IAccessControl.sol";
import {SpurVault} from "../src/SpurVault.sol";
import {HarvestAuction} from "../src/HarvestAuction.sol";
import {OracleRouter} from "../src/OracleRouter.sol";
import {SettlementOracle} from "../src/SettlementOracle.sol";
import {Roles} from "../src/libraries/Roles.sol";

/// @title DeploySpur
/// @notice Men-deploy SATU `SpurVault` BARU di atas OracleRouter, SettlementOracle, HarvestAuction, USDG, dan token aset
///         yang SUDAH ada (hasil `Deploy.s.sol`). Dipakai bila vault lama macet (mis. round terjual yang harga
///         settlement-nya tidak bisa dicatat: `rollRound` butuh `active == false` dan tidak ada jalur admin).
/// @dev `HarvestAuction.fill` hanya memeriksa `vault.AUCTION() == address(this)`, jadi auction dan daftar Picker lama
///      langsung berlaku untuk vault baru. Peran KEEPER di auction juga tetap. Yang diberikan di sini: KEEPER dan
///      GUARDIAN di vault baru. Tanpa timelock: ADMIN langsung `owner` (hanya testnet; mainnet ditolak).
contract DeploySpur is Script {
    uint256 internal constant MAINNET_CHAIN_ID = 4663;

    struct Params {
        address owner; // ADMIN akhir vault baru
        address keeper; // KEEPER_ROLE di vault baru
        address guardian; // GUARDIAN_ROLE (address(0) = tidak diberikan)
        address router;
        address settlement;
        address auction;
        address usdg; // PREMIUM
        address asset; // aset yang ditutup call-nya (mis. NVDA)
        uint32 fillWindow;
        uint256 minDeposit;
        uint256 depositCap; // 0 = tanpa batas
        uint16 otmBps;
        uint16 minPremiumBps;
    }

    function run() external returns (SpurVault) {
        Params memory p = Params({
            owner: vm.envAddress("OWNER"),
            keeper: vm.envAddress("KEEPER"),
            guardian: vm.envOr("GUARDIAN", address(0)),
            router: vm.envAddress("ROUTER"),
            settlement: vm.envAddress("SETTLEMENT"),
            auction: vm.envAddress("AUCTION"),
            usdg: vm.envAddress("USDG"),
            asset: vm.envAddress("ASSET"),
            fillWindow: uint32(vm.envUint("FILL_WINDOW")),
            minDeposit: vm.envUint("MIN_DEPOSIT"),
            depositCap: vm.envOr("DEPOSIT_CAP", uint256(0)),
            otmBps: uint16(vm.envUint("OTM_BPS")),
            minPremiumBps: uint16(vm.envOr("MIN_PREMIUM_BPS", uint256(0)))
        });
        return deploy(p);
    }

    function deploy(Params memory p) public returns (SpurVault v) {
        _validate(p);

        vm.startBroadcast();
        (, address deployer,) = vm.readCallers();
        v = new SpurVault(
            deployer,
            p.asset,
            p.usdg,
            p.router,
            p.settlement,
            p.auction,
            p.fillWindow,
            p.minDeposit,
            p.depositCap == 0 ? type(uint256).max : p.depositCap,
            p.otmBps,
            p.minPremiumBps
        );
        v.grantRole(Roles.KEEPER_ROLE, p.keeper);
        if (p.guardian != address(0)) v.grantRole(Roles.GUARDIAN_ROLE, p.guardian);
        if (p.owner != deployer) {
            v.grantRole(0x00, p.owner); // DEFAULT_ADMIN_ROLE
            v.renounceRole(0x00, deployer);
        }
        vm.stopBroadcast();

        _verify(p, v, deployer);
        _report(p, v);
        if (vm.isContext(VmSafe.ForgeContext.ScriptBroadcast) || vm.isContext(VmSafe.ForgeContext.ScriptResume)) {
            _write(p, v);
        }
    }

    function _validate(Params memory p) internal view {
        require(block.chainid != MAINNET_CHAIN_ID, "skrip ini tidak untuk mainnet (4663): tanpa timelock");
        require(p.owner != address(0) && p.keeper != address(0), "config: owner/keeper kosong");
        require(p.router.code.length != 0, "config: ROUTER tanpa kode");
        require(p.settlement.code.length != 0, "config: SETTLEMENT tanpa kode");
        require(p.auction.code.length != 0, "config: AUCTION tanpa kode");
        require(p.usdg.code.length != 0, "config: USDG tanpa kode");
        require(p.asset.code.length != 0, "config: ASSET tanpa kode");
        (address feed,) = OracleRouter(p.router).feedOf(p.asset);
        require(feed != address(0), "config: ASSET belum terdaftar di router");
        require(
            address(SettlementOracle(p.settlement).ROUTER()) == p.router, "config: SETTLEMENT bukan milik ROUTER ini"
        );
        require(p.fillWindow >= 1 hours && p.fillWindow <= 2 days, "config: fillWindow di luar 1 jam..2 hari");
        require(p.otmBps >= 100 && p.otmBps <= 5_000, "config: otmBps di luar 100..5000");
        require(p.minPremiumBps <= 2_000, "config: minPremiumBps di atas 2000");
    }

    /// Membaca kembali keadaan akhir (simulasi lokal; perilaku chain diperiksa `deploy-spur.sh`).
    function _verify(Params memory p, SpurVault v, address deployer) internal view {
        require(address(v.ASSET()) == p.asset, "verify: ASSET");
        require(address(v.PREMIUM()) == p.usdg, "verify: PREMIUM");
        require(address(v.ROUTER()) == p.router, "verify: ROUTER");
        require(address(v.SETTLEMENT()) == p.settlement, "verify: SETTLEMENT");
        require(v.AUCTION() == p.auction, "verify: AUCTION");
        require(v.FILL_WINDOW() == p.fillWindow, "verify: FILL_WINDOW");
        require(v.otmBps() == p.otmBps && v.minPremiumBps() == p.minPremiumBps, "verify: otm/minPremium");
        require(IAccessControl(address(v)).hasRole(0x00, p.owner), "verify: owner bukan ADMIN");
        if (p.owner != deployer) {
            require(!IAccessControl(address(v)).hasRole(0x00, deployer), "verify: deployer masih ADMIN");
        }
        require(IAccessControl(address(v)).hasRole(Roles.KEEPER_ROLE, p.keeper), "verify: KEEPER");
        if (p.guardian != address(0)) {
            require(IAccessControl(address(v)).hasRole(Roles.GUARDIAN_ROLE, p.guardian), "verify: GUARDIAN");
        }
        require(v.round() == 0 && !v.active(), "verify: vault harus bersih (round 0, tidak aktif)");
    }

    function _report(Params memory p, SpurVault v) internal pure {
        console2.log("==================================================");
        console2.log("SpurVault baru :", address(v));
        console2.log("ASSET          :", p.asset);
        console2.log("USDG           :", p.usdg);
        console2.log("Auction (lama) :", p.auction);
        console2.log("Settlement     :", p.settlement);
        console2.log("ADMIN          :", p.owner);
        console2.log("KEEPER         :", p.keeper);
        console2.log("==================================================");
    }

    function _write(Params memory p, SpurVault v) internal {
        string memory o = "spurDeployment";
        vm.serializeUint(o, "chainId", block.chainid);
        vm.serializeUint(o, "deployedAt", block.timestamp);
        vm.serializeAddress(o, "owner", p.owner);
        vm.serializeAddress(o, "keeper", p.keeper);
        vm.serializeAddress(o, "oracleRouter", p.router);
        vm.serializeAddress(o, "settlementOracle", p.settlement);
        vm.serializeAddress(o, "harvestAuction", p.auction);
        vm.serializeAddress(o, "premiumToken", p.usdg);
        vm.serializeAddress(o, "asset", p.asset);
        string memory out = vm.serializeAddress(o, "spurVault", address(v));
        vm.writeJson(out, "deployments/spur-v2-testnet-mock.json");
        console2.log("Ditulis: deployments/spur-v2-testnet-mock.json");
    }
}
