// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {Vm} from "forge-std/Vm.sol";
import {IAccessControl} from "@openzeppelin/contracts/access/IAccessControl.sol";
import {TimelockController} from "@openzeppelin/contracts/governance/TimelockController.sol";
import {CordonVault} from "../src/CordonVault.sol";
import {OracleRouter} from "../src/OracleRouter.sol";
import {MarketSession} from "../src/MarketSession.sol";
import {IOracleRouter} from "../src/interfaces/IOracleRouter.sol";
import {MockAggregator} from "./mocks/MockAggregator.sol";
import {MockERC20} from "./mocks/MockERC20.sol";
import {CordonVaultBase} from "./CordonVault.t.sol";

/// Fase 2 item 5: peran ADMIN/KEEPER/GUARDIAN dan jeda per aset.
contract RolesAndPauseTest is CordonVaultBase {
    address internal guardian = makeAddr("guardian");
    address internal keeper = makeAddr("keeper");
    address internal stranger = makeAddr("stranger");

    function setUp() public override {
        super.setUp();
        vm.startPrank(admin);
        router.grantRole(router.GUARDIAN_ROLE(), guardian);
        market.grantRole(market.KEEPER_ROLE(), keeper);
        vm.stopPrank();
    }

    function _noRole(address who, bytes32 role) internal pure returns (bytes memory) {
        return abi.encodeWithSelector(IAccessControl.AccessControlUnauthorizedAccount.selector, who, role);
    }

    function _routerStatus(address t) internal view returns (IOracleRouter.Status s) {
        (s,,) = router.tryGetPrice(t);
    }

    // ------------------------------------------------------- jeda di OracleRouter

    function test_pause_guardianPausesInstantlyAndPriceBecomesUnavailable() public {
        address t0 = address(tk[0]);
        assertEq(uint8(_routerStatus(t0)), uint8(IOracleRouter.Status.Ok));

        vm.expectEmit(true, true, false, true, address(router));
        emit OracleRouter.AssetPauseSet(t0, true, guardian);
        vm.prank(guardian);
        router.pauseAsset(t0);

        assertTrue(router.isAssetPaused(t0));
        assertEq(uint8(_routerStatus(t0)), uint8(IOracleRouter.Status.AssetPaused));
        (IOracleRouter.Status s,,,) = router.tryGetReferencePrice(t0);
        assertEq(uint8(s), uint8(IOracleRouter.Status.AssetPaused), "juga jalur acuan");
        vm.expectRevert(
            abi.encodeWithSelector(IOracleRouter.PriceUnavailable.selector, IOracleRouter.Status.AssetPaused)
        );
        router.getPrice(t0);
        vm.expectRevert(
            abi.encodeWithSelector(IOracleRouter.PriceUnavailable.selector, IOracleRouter.Status.AssetPaused)
        );
        router.getReferencePrice(t0);

        // Aset lain tidak terpengaruh.
        assertEq(uint8(_routerStatus(address(tk[1]))), uint8(IOracleRouter.Status.Ok));
        assertFalse(router.isAssetPaused(address(tk[1])));
    }

    function test_pause_onlyGuardianOrAdminCanPause() public {
        address t0 = address(tk[0]);
        bytes32 gRole = router.GUARDIAN_ROLE();
        vm.expectRevert(_noRole(stranger, gRole));
        vm.prank(stranger);
        router.pauseAsset(t0);
        vm.expectRevert(_noRole(keeper, gRole));
        vm.prank(keeper);
        router.pauseAsset(t0);

        vm.prank(admin);
        router.pauseAsset(t0); // admin juga boleh
        assertTrue(router.isAssetPaused(t0));
    }

    function test_pause_onlyAdminCanUnpause() public {
        address t0 = address(tk[0]);
        vm.prank(guardian);
        router.pauseAsset(t0);

        bytes32 adminRole = router.DEFAULT_ADMIN_ROLE();
        vm.expectRevert(_noRole(guardian, adminRole));
        vm.prank(guardian);
        router.unpauseAsset(t0);
        vm.expectRevert(_noRole(stranger, adminRole));
        vm.prank(stranger);
        router.unpauseAsset(t0);
        assertTrue(router.isAssetPaused(t0));

        vm.expectEmit(true, true, false, true, address(router));
        emit OracleRouter.AssetPauseSet(t0, false, admin);
        vm.prank(admin);
        router.unpauseAsset(t0);
        assertFalse(router.isAssetPaused(t0));
        assertEq(uint8(_routerStatus(t0)), uint8(IOracleRouter.Status.Ok));
    }

    function test_pause_unconfiguredAssetRejectedAndRepeatIsNoop() public {
        vm.expectRevert(OracleRouter.AssetNotConfigured.selector);
        vm.prank(guardian);
        router.pauseAsset(makeAddr("unknown"));

        vm.prank(guardian);
        router.pauseAsset(address(tk[0]));
        vm.recordLogs();
        vm.prank(guardian);
        router.pauseAsset(address(tk[0])); // sudah dijeda
        assertEq(vm.getRecordedLogs().length, 0, "tidak ada event ganda");
        vm.recordLogs();
        vm.prank(admin);
        router.unpauseAsset(address(tk[1])); // tidak dijeda
        assertEq(vm.getRecordedLogs().length, 0);
    }

    function test_pause_survivesReconfigureAndRemoval() public {
        address t0 = address(tk[0]);
        vm.prank(guardian);
        router.pauseAsset(t0);

        vm.startPrank(admin);
        router.setAsset(t0, address(feeds[0]), 2 hours, false); // konfigurasi ulang tidak membuka jeda
        assertTrue(router.isAssetPaused(t0));
        assertEq(uint8(_routerStatus(t0)), uint8(IOracleRouter.Status.AssetPaused));

        router.removeAsset(t0);
        assertTrue(router.isAssetPaused(t0), "jeda bertahan walau aset dihapus");
        router.setAsset(t0, address(feeds[0]), 1 hours, false); // didaftarkan lagi
        assertEq(uint8(_routerStatus(t0)), uint8(IOracleRouter.Status.AssetPaused));
        router.unpauseAsset(t0);
        vm.stopPrank();
        assertEq(uint8(_routerStatus(t0)), uint8(IOracleRouter.Status.Ok));
    }

    function test_pause_navBecomesUnavailable() public {
        _seed();
        (bool ok,,) = vault.tryNav();
        assertTrue(ok);

        vm.prank(guardian);
        router.pauseAsset(address(tk[1]));
        (ok,,) = vault.tryNav();
        assertFalse(ok);
        vm.expectRevert(
            abi.encodeWithSelector(CordonVault.PriceUnavailable.selector, 1, IOracleRouter.Status.AssetPaused)
        );
        vault.nav();

        vm.prank(admin);
        router.unpauseAsset(address(tk[1]));
        (ok,,) = vault.tryNav();
        assertTrue(ok);
    }

    // ------------------------------------------------------ jeda di CordonVault

    function test_vault_mintBlockedWhenAnyComponentPaused() public {
        _seed();
        _fund(alice, 1e24, 1e24, 1e24);
        uint256[] memory max = _amounts(type(uint256).max, type(uint256).max, type(uint256).max);
        assertEq(vault.mintPausedBy(), address(0));

        for (uint256 i; i < 3; i++) {
            vm.prank(guardian);
            router.pauseAsset(address(tk[i]));
            assertEq(vault.mintPausedBy(), address(tk[i]));
            vm.expectRevert(abi.encodeWithSelector(CordonVault.AssetPaused.selector, address(tk[i])));
            vm.prank(alice);
            vault.mint(1e18, alice, max);
            vm.prank(admin);
            router.unpauseAsset(address(tk[i]));
        }
        vm.prank(alice);
        vault.mint(1e18, alice, max); // setelah semua dibuka, berhasil
        assertEq(vault.balanceOf(alice), 1e18);
    }

    function test_vault_redeemNeverBlockedByPause() public {
        _seed();
        _fund(alice, 1e24, 1e24, 1e24);
        vm.prank(alice);
        vault.mint(10e18, alice, _amounts(type(uint256).max, type(uint256).max, type(uint256).max));

        for (uint256 i; i < 3; i++) {
            vm.prank(guardian);
            router.pauseAsset(address(tk[i]));
        }
        uint256 a0 = tk[0].balanceOf(alice);
        vm.prank(alice);
        uint256[] memory out = vault.redeem(10e18, alice, 7, _amounts(0, 0, 0));
        assertGt(out[0], 0);
        assertEq(tk[0].balanceOf(alice), a0 + out[0], "keluar in-kind tetap jalan saat semua aset dijeda");
        assertEq(vault.balanceOf(alice), 0);

        vm.prank(admin);
        vault.redeem(100e18, admin, 7, _amounts(0, 0, 0)); // seeder juga bisa keluar
        assertEq(vault.totalSupply(), 0);
    }

    // ------------------------------------------------------- batas tiap peran

    function test_guardian_cannotDoAnythingExceptPause() public {
        _seed();
        bytes32 adminRole = vault.DEFAULT_ADMIN_ROLE();
        vm.startPrank(guardian);

        vm.expectRevert(_noRole(guardian, adminRole));
        vault.setFees(1, 1, 1);
        vm.expectRevert(_noRole(guardian, adminRole));
        vault.setFeeRecipient(guardian);
        vm.expectRevert(_noRole(guardian, adminRole));
        router.setAsset(address(tk[0]), address(feeds[0]), 1 hours, false);
        vm.expectRevert(_noRole(guardian, adminRole));
        router.removeAsset(address(tk[0]));
        vm.expectRevert(_noRole(guardian, adminRole));
        router.unpauseAsset(address(tk[0]));
        vm.expectRevert(_noRole(guardian, adminRole));
        market.setHoliday(2026, 10, 8, false);
        vm.expectRevert(_noRole(guardian, market.KEEPER_ROLE()));
        market.setHoliday(2026, 10, 8, true);

        // Tidak bisa memberi peran kepada diri sendiri maupun siapa pun.
        bytes32 gRole = router.GUARDIAN_ROLE();
        vm.expectRevert(_noRole(guardian, adminRole));
        router.grantRole(gRole, stranger);
        vm.expectRevert(_noRole(guardian, adminRole));
        router.grantRole(adminRole, guardian);
        vm.stopPrank();

        // Vault tidak punya fungsi yang memindahkan dana milik orang lain; saldo vault tetap utuh.
        assertEq(tk[0].balanceOf(address(vault)), 10e18);
    }

    function test_keeper_canOnlyAddHolidays() public {
        vm.startPrank(keeper);
        market.setHoliday(2026, 11, 26, true); // menambah: boleh
        assertTrue(market.isHoliday(2026, 11, 26));

        bytes32 adminRole = market.DEFAULT_ADMIN_ROLE();
        vm.expectRevert(_noRole(keeper, adminRole));
        market.setHoliday(2026, 11, 26, false); // menghapus: hanya admin
        assertTrue(market.isHoliday(2026, 11, 26));

        // Tidak punya wewenang lain.
        vm.expectRevert(_noRole(keeper, router.GUARDIAN_ROLE()));
        router.pauseAsset(address(tk[0]));
        vm.expectRevert(_noRole(keeper, adminRole));
        router.setAsset(address(tk[0]), address(feeds[0]), 1 hours, false);
        vm.expectRevert(_noRole(keeper, adminRole));
        vault.setFees(0, 0, 0);
        bytes32 kRole = market.KEEPER_ROLE(); // dibaca sebelum expectRevert (argumen dievaluasi lebih dulu)
        vm.expectRevert(_noRole(keeper, adminRole));
        market.grantRole(kRole, stranger);
        vm.stopPrank();

        vm.prank(admin);
        market.setHoliday(2026, 11, 26, false); // admin bisa menghapus
        assertFalse(market.isHoliday(2026, 11, 26));
    }

    function test_strangerHasNoPowers() public {
        vm.startPrank(stranger);
        vm.expectRevert(_noRole(stranger, market.KEEPER_ROLE()));
        market.setHoliday(2026, 11, 26, true);
        vm.expectRevert(_noRole(stranger, router.GUARDIAN_ROLE()));
        router.pauseAsset(address(tk[0]));
        vm.stopPrank();
    }

    function test_adminCanRevokeGuardianAndKeeper() public {
        bytes32 gRole = router.GUARDIAN_ROLE();
        bytes32 kRole = market.KEEPER_ROLE();
        vm.startPrank(admin);
        router.revokeRole(gRole, guardian);
        market.revokeRole(kRole, keeper);
        vm.stopPrank();
        vm.expectRevert(_noRole(guardian, gRole));
        vm.prank(guardian);
        router.pauseAsset(address(tk[0]));
        vm.expectRevert(_noRole(keeper, kRole));
        vm.prank(keeper);
        market.setHoliday(2026, 11, 26, true);
    }
}

/// ADMIN = TimelockController 48 jam (multisig sebagai proposer/executor); GUARDIAN tetap langsung.
contract TimelockAdminTest is Test {
    uint256 internal constant FRI = 1_790_913_600;
    uint256 internal constant DELAY = 48 hours;

    TimelockController internal timelock;
    OracleRouter internal router;
    MarketSession internal market;
    CordonVault internal vault;
    MockERC20[3] internal tk;
    MockAggregator[3] internal feeds;

    address internal multisig = makeAddr("multisig");
    address internal guardian = makeAddr("guardian");
    address internal treasury = makeAddr("treasury");

    function setUp() public {
        vm.warp(FRI + 12 hours);
        address[] memory who = new address[](1);
        who[0] = multisig;
        timelock = new TimelockController(DELAY, who, who, address(0)); // timelock mengatur dirinya sendiri

        market = new MarketSession(address(timelock));
        MockAggregator seq = new MockAggregator(0);
        seq.setRaw(1, 0, FRI - 30 days, FRI - 30 days, 1);
        router = new OracleRouter(address(timelock), address(seq), 1 hours, address(market));

        address[] memory comps = new address[](3);
        uint16[] memory w = new uint16[](3);
        w[0] = 5000;
        w[1] = 3000;
        w[2] = 2000;
        vm.startPrank(address(timelock)); // konfigurasi awal saat deploy
        for (uint256 i; i < 3; i++) {
            tk[i] = new MockERC20("T", "T", 18);
            feeds[i] = new MockAggregator(8);
            feeds[i].setRound(int256(100e8));
            router.setAsset(address(tk[i]), address(feeds[i]), 1 hours, false);
            comps[i] = address(tk[i]);
        }
        router.grantRole(router.GUARDIAN_ROLE(), guardian);
        vm.stopPrank();
        vault = new CordonVault(address(timelock), address(router), "Cordon", "c", comps, w);
    }

    function _schedule(address target, bytes memory data) internal returns (bytes32 id) {
        id = timelock.hashOperation(target, 0, data, bytes32(0), bytes32(0));
        vm.prank(multisig);
        timelock.schedule(target, 0, data, bytes32(0), bytes32(0), DELAY);
    }

    function _execute(address target, bytes memory data) internal {
        vm.prank(multisig);
        timelock.execute(target, 0, data, bytes32(0), bytes32(0));
    }

    function test_noEoaHoldsAdmin() public view {
        bytes32 a = vault.DEFAULT_ADMIN_ROLE();
        assertTrue(vault.hasRole(a, address(timelock)));
        assertFalse(vault.hasRole(a, multisig));
        assertTrue(router.hasRole(a, address(timelock)));
        assertFalse(router.hasRole(a, multisig));
        assertTrue(market.hasRole(a, address(timelock)));
        assertFalse(timelock.hasRole(a, multisig), "multisig tidak admin timelock; timelock mengatur dirinya sendiri");
        assertTrue(timelock.hasRole(a, address(timelock)));
    }

    function test_feeChangeNeedsTheFullDelay() public {
        bytes memory feeRecipientCall = abi.encodeCall(CordonVault.setFeeRecipient, (treasury));
        bytes memory feesCall = abi.encodeCall(CordonVault.setFees, (50, 50, 100));

        // Multisig tidak bisa memanggil langsung.
        vm.expectRevert(
            abi.encodeWithSelector(
                IAccessControl.AccessControlUnauthorizedAccount.selector, multisig, vault.DEFAULT_ADMIN_ROLE()
            )
        );
        vm.prank(multisig);
        vault.setFees(50, 50, 100);

        // Penjadwalan dengan jeda kurang dari 48 jam ditolak.
        vm.expectRevert();
        vm.prank(multisig);
        timelock.schedule(address(vault), 0, feesCall, bytes32(0), bytes32(0), DELAY - 1);

        _schedule(address(vault), feeRecipientCall);
        bytes32 id = _schedule(address(vault), feesCall);
        assertTrue(timelock.isOperationPending(id));

        vm.expectRevert(); // langsung dieksekusi: ditolak
        _execute(address(vault), feeRecipientCall);
        vm.warp(block.timestamp + DELAY - 1);
        vm.expectRevert(); // satu detik sebelum waktunya: ditolak
        _execute(address(vault), feeRecipientCall);

        vm.warp(block.timestamp + 1);
        _execute(address(vault), feeRecipientCall);
        _execute(address(vault), feesCall);
        assertEq(vault.mintFeeBps(), 50);
        assertEq(vault.redeemFeeBps(), 50);
        assertEq(vault.managementFeeBps(), 100);
        assertEq(vault.feeRecipient(), treasury);
    }

    function test_feeAboveCapStillRejectedEvenThroughTimelock() public {
        bytes memory recipientCall = abi.encodeCall(CordonVault.setFeeRecipient, (treasury));
        _schedule(address(vault), recipientCall);
        bytes memory bad = abi.encodeCall(CordonVault.setFees, (101, 0, 0));
        _schedule(address(vault), bad);
        vm.warp(block.timestamp + DELAY);
        _execute(address(vault), recipientCall);
        vm.expectRevert(); // timelock membungkus revert CordonVault.FeeTooHigh
        _execute(address(vault), bad);
        assertEq(vault.mintFeeBps(), 0);
    }

    function test_guardianPausesInstantlyButUnpauseNeedsTimelock() public {
        address t0 = address(tk[0]);
        vm.prank(guardian);
        router.pauseAsset(t0); // langsung, tanpa jeda waktu
        assertTrue(router.isAssetPaused(t0));

        // Multisig tidak bisa membuka langsung.
        vm.expectRevert(
            abi.encodeWithSelector(
                IAccessControl.AccessControlUnauthorizedAccount.selector, multisig, router.DEFAULT_ADMIN_ROLE()
            )
        );
        vm.prank(multisig);
        router.unpauseAsset(t0);

        bytes memory call_ = abi.encodeCall(OracleRouter.unpauseAsset, (t0));
        _schedule(address(router), call_);
        vm.warp(block.timestamp + DELAY - 1);
        vm.expectRevert();
        _execute(address(router), call_);
        assertTrue(router.isAssetPaused(t0));
        vm.warp(block.timestamp + 1);
        _execute(address(router), call_);
        assertFalse(router.isAssetPaused(t0));
    }
}
