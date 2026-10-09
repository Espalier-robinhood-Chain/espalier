// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IAccessControl} from "@openzeppelin/contracts/access/IAccessControl.sol";
import {CordonVault} from "../src/CordonVault.sol";
import {IOracleRouter} from "../src/interfaces/IOracleRouter.sol";
import {Roles} from "../src/libraries/Roles.sol";
import {MockPruneVenue} from "./mocks/MockPruneVenue.sol";
import {CordonVaultBase} from "./CordonVault.t.sol";

/// `prune` (peran KEEPER) + `setPruneVenue` / `setPruneSlippageBps`. Harga uji: AAA $100, BBB $50, CCC $10; target 50/30/20.
/// Seed `_seed()`: 10 AAA + 20 BBB + 50 CCC = $1.000 + $1.000 + $500 = $2.500, jadi bobot 40/40/20: drift 1000 bps
/// (AAA kurang $250, BBB lebih $250). Pruning sempurna: jual 5 BBB ($250), beli 2,5 AAA.
contract CordonVaultPruneTest is CordonVaultBase {
    MockPruneVenue internal venue;
    address internal keeper = makeAddr("keeper");

    function setUp() public override {
        super.setUp();
        venue = new MockPruneVenue(address(router), 0);
        bytes32 role = Roles.KEEPER_ROLE;
        vm.prank(admin);
        vault.grantRole(role, keeper);
    }

    function _configure(uint16 slip) internal {
        vm.startPrank(admin);
        vault.setPruneVenue(address(venue));
        vault.setPruneSlippageBps(slip);
        vm.stopPrank();
    }

    function _one(uint256 i, uint256 o, uint256 amt, uint256 minOut)
        internal
        pure
        returns (CordonVault.PruneTrade[] memory t)
    {
        t = new CordonVault.PruneTrade[](1);
        t[0] = CordonVault.PruneTrade(i, o, amt, minOut);
    }

    /// Jual 5 BBB ($250), beli AAA: nilai persis ke target.
    function _perfect() internal pure returns (CordonVault.PruneTrade[] memory) {
        return _one(1, 0, 5e18, 0);
    }

    function _prune(CordonVault.PruneTrade[] memory t) internal {
        vm.prank(keeper);
        vault.prune(t);
    }

    function _noRole(address who, bytes32 role) internal pure returns (bytes memory) {
        return abi.encodeWithSelector(IAccessControl.AccessControlUnauthorizedAccount.selector, who, role);
    }

    // ------------------------------------------------------------ konfigurasi

    function test_disabledByDefault() public {
        _seed();
        CordonVault.PruneTrade[] memory t = _perfect();
        vm.expectRevert(CordonVault.PruneNotConfigured.selector);
        _prune(t);
        // venue saja tanpa slippage = tetap mati
        vm.prank(admin);
        vault.setPruneVenue(address(venue));
        vm.expectRevert(CordonVault.PruneNotConfigured.selector);
        _prune(t);
        // slippage saja tanpa venue = tetap mati
        vm.startPrank(admin);
        vault.setPruneVenue(address(0));
        vault.setPruneSlippageBps(100);
        vm.stopPrank();
        vm.expectRevert(CordonVault.PruneNotConfigured.selector);
        _prune(t);
    }

    function test_setters_authAndBounds() public {
        bytes32 adminRole = vault.DEFAULT_ADMIN_ROLE();
        vm.expectRevert(_noRole(keeper, adminRole)); // KEEPER bukan ADMIN
        vm.prank(keeper);
        vault.setPruneVenue(address(venue));
        vm.expectRevert(_noRole(alice, adminRole));
        vm.prank(alice);
        vault.setPruneSlippageBps(10);

        uint16 tooHigh = uint16(vault.MAX_PRUNE_SLIPPAGE_BPS() + 1); // dibaca sebelum expectRevert
        vm.startPrank(admin);
        vm.expectRevert(CordonVault.InvalidPruneVenue.selector);
        vault.setPruneVenue(address(vault));
        vm.expectRevert(CordonVault.InvalidPruneVenue.selector);
        vault.setPruneVenue(makeAddr("eoa"));
        vm.expectRevert(CordonVault.FeeTooHigh.selector);
        vault.setPruneSlippageBps(tooHigh);

        vm.expectEmit(true, false, false, false, address(vault));
        emit CordonVault.PruneVenueSet(address(venue));
        vault.setPruneVenue(address(venue));
        vm.expectEmit(false, false, false, true, address(vault));
        emit CordonVault.PruneSlippageSet(300);
        vault.setPruneSlippageBps(300);
        vm.stopPrank();
        assertEq(address(vault.pruneVenue()), address(venue));
        assertEq(vault.pruneSlippageBps(), 300);
    }

    function test_prune_onlyKeeper() public {
        _seed();
        _configure(50);
        bytes32 k = Roles.KEEPER_ROLE;
        CordonVault.PruneTrade[] memory t = _perfect();
        vm.expectRevert(_noRole(alice, k));
        vm.prank(alice);
        vault.prune(t);
        vm.expectRevert(_noRole(admin, k)); // ADMIN tanpa peran KEEPER juga tidak bisa
        vm.prank(admin);
        vault.prune(t);
    }

    // ------------------------------------------------------------ jalan normal

    function test_tryDriftBps_matchesHandComputation() public {
        _seed();
        (bool ok, uint256 d) = vault.tryDriftBps();
        assertTrue(ok);
        assertEq(d, 1000);
    }

    function test_prune_restoresTargetWeights() public {
        _seed();
        _configure(50);
        uint256 navBefore;
        (, navBefore,) = vault.tryNav();

        vm.expectEmit(true, true, false, true, address(vault));
        emit CordonVault.PruneSwap(address(tk[1]), address(tk[0]), 5e18, 2.5e18);
        vm.expectEmit(false, false, false, true, address(vault));
        emit CordonVault.Pruned(1000, 0, 1);
        _prune(_perfect());

        assertEq(tk[0].balanceOf(address(vault)), 12.5e18);
        assertEq(tk[1].balanceOf(address(vault)), 15e18);
        assertEq(tk[2].balanceOf(address(vault)), 50e6);
        (bool ok, uint256 d) = vault.tryDriftBps();
        assertTrue(ok);
        assertEq(d, 0);
        (, uint256 navAfter,) = vault.tryNav();
        assertEq(navAfter, navBefore); // spread 0: nilai tidak berubah
        assertEq(vault.lastPrune(), block.timestamp);
        assertEq(tk[1].allowance(address(vault), address(venue)), 0); // tidak ada sisa allowance
        assertEq(vault.totalSupply(), 100e18); // share tidak tersentuh
    }

    function test_prune_spreadWithinCapPasses_andCostIsBounded() public {
        _seed();
        _configure(100);
        venue.setSpreadBps(60); // 0,6% < cap 1%
        (, uint256 before_,) = vault.tryNav();
        _prune(_perfect());
        (, uint256 after_,) = vault.tryNav();
        assertLt(after_, before_);
        // kerugian <= slippage x nilai yang dijual ($250 x 1%)
        assertLe(before_ - after_, 2.5e18);
    }

    function test_prune_multipleTrades() public {
        _seed();
        _configure(50);
        CordonVault.PruneTrade[] memory t = new CordonVault.PruneTrade[](2);
        t[0] = CordonVault.PruneTrade(1, 0, 2e18, 0);
        t[1] = CordonVault.PruneTrade(1, 0, 3e18, 0);
        vm.expectEmit(false, false, false, true, address(vault));
        emit CordonVault.Pruned(1000, 0, 2);
        _prune(t);
        assertEq(tk[0].balanceOf(address(vault)), 12.5e18);
    }

    function test_prune_crossDecimals() public {
        _seed();
        _configure(50);
        // Naikkan CCC (6 desimal) di atas target dulu: donasi 100 CCC ($1000) -> vault $3.500; CCC 1.500/3.500 = 42,9%.
        tk[2].mint(address(vault), 100e6);
        (, uint256 d0) = vault.tryDriftBps();
        // jual 50 CCC ($500) -> beli 5 AAA... cukup uji bahwa drift turun dan angka lintas desimal benar:
        uint256 aaaBefore = tk[0].balanceOf(address(vault));
        _prune(_one(2, 0, 50e6, 0));
        assertEq(tk[0].balanceOf(address(vault)) - aaaBefore, 5e18); // $500 / $100
        (, uint256 d1) = vault.tryDriftBps();
        assertLt(d1, d0);
    }

    // ------------------------------------------------------------ pagar

    function test_prune_revertsWhenMarketClosed() public {
        _seed();
        _configure(50);
        vm.warp(FRI + 1 days + 12 hours); // Sabtu, Closed
        vm.expectRevert(
            abi.encodeWithSelector(CordonVault.PriceUnavailable.selector, 0, IOracleRouter.Status.MarketClosed)
        );
        _prune(_perfect());
        (bool ok,) = vault.tryDriftBps();
        assertFalse(ok);
    }

    function test_prune_revertsWhenAnyComponentPaused() public {
        _seed();
        _configure(50);
        vm.prank(admin);
        router.pauseAsset(address(tk[2]));
        vm.expectRevert(
            abi.encodeWithSelector(CordonVault.PriceUnavailable.selector, 2, IOracleRouter.Status.AssetPaused)
        );
        _prune(_perfect());
    }

    function test_prune_revertsWhenPriceStale() public {
        _seed();
        _configure(50);
        vm.warp(block.timestamp + 2 hours); // lewat jendela 1 jam, sesi masih terbuka
        vm.expectRevert(abi.encodeWithSelector(CordonVault.PriceUnavailable.selector, 0, IOracleRouter.Status.Stale));
        _prune(_perfect());
    }

    function test_prune_slippageCapEnforcedEvenIfVenueIgnoresMin() public {
        _seed();
        _configure(100); // cap 1%
        venue.setSpreadBps(200); // venue membayar 2% kurang dan mengabaikan minAmountOut
        venue.setIgnoreMin(true);
        // out = 2,5 x 0,98 = 2,45; floor = 2,5 x 0,99 = 2,475
        vm.expectRevert(abi.encodeWithSelector(CordonVault.PruneSlippageExceeded.selector, 0, 2.45e18, 2.475e18));
        _prune(_perfect());
    }

    function test_prune_keeperMinOutCanBeStricterButNotLooser() public {
        _seed();
        _configure(100);
        venue.setSpreadBps(50); // out = 2,4875
        venue.setIgnoreMin(true);
        // minOut keeper lebih ketat dari floor kontrak (2,475): ditegakkan
        vm.expectRevert(abi.encodeWithSelector(CordonVault.PruneSlippageExceeded.selector, 0, 2.4875e18, 2.49e18));
        _prune(_one(1, 0, 5e18, 2.49e18));
        // minOut keeper 0 tidak melonggarkan batas kontrak
        venue.setSpreadBps(150);
        vm.expectRevert(abi.encodeWithSelector(CordonVault.PruneSlippageExceeded.selector, 0, 2.4625e18, 2.475e18));
        _prune(_one(1, 0, 5e18, 0));
    }

    function test_prune_revertsIfVenueDoesNotPullFullAmount() public {
        _seed();
        _configure(50);
        venue.setPullBps(5000);
        vm.expectRevert(abi.encodeWithSelector(CordonVault.PruneShortSpend.selector, 0, 2.5e18, 5e18));
        _prune(_perfect());
    }

    function test_prune_revertsIfDriftNotReduced() public {
        _seed();
        _configure(50);
        // Jual AAA (yang sudah kurang) untuk beli BBB (yang sudah lebih): drift naik.
        vm.expectRevert(abi.encodeWithSelector(CordonVault.DriftNotReduced.selector, 1000, 1400));
        _prune(_one(0, 1, 1e18, 0));
    }

    function test_prune_revertsIfAlreadyBalanced() public {
        _seed();
        _configure(50);
        _prune(_perfect()); // drift 0
        vm.warp(block.timestamp + 4 days); // Selasa
        _refreshFeeds();
        // Sudah seimbang: trade apa pun tidak memperbaiki.
        vm.expectRevert(abi.encodeWithSelector(CordonVault.DriftNotReduced.selector, 0, 200));
        _prune(_one(1, 0, 1e18, 0));
    }

    function test_prune_cooldown() public {
        _seed();
        _configure(50);
        _prune(_one(1, 0, 2e18, 0)); // sebagian: drift turun tapi belum 0
        uint256 next = block.timestamp + vault.MIN_PRUNE_INTERVAL();
        vm.warp(block.timestamp + 1 hours);
        _refreshFeeds();
        vm.expectRevert(abi.encodeWithSelector(CordonVault.PruneTooSoon.selector, next));
        _prune(_one(1, 0, 3e18, 0));
        vm.warp(FRI + 4 days + 12 hours); // Selasa siang
        _refreshFeeds();
        _prune(_one(1, 0, 3e18, 0));
        assertEq(tk[0].balanceOf(address(vault)), 12.5e18);
    }

    function test_prune_invalidTrades() public {
        _seed();
        _configure(50);
        CordonVault.PruneTrade[] memory none = new CordonVault.PruneTrade[](0);
        vm.expectRevert(abi.encodeWithSelector(CordonVault.InvalidTrade.selector, 0));
        _prune(none);
        vm.expectRevert(abi.encodeWithSelector(CordonVault.InvalidTrade.selector, 0));
        _prune(_one(1, 1, 1e18, 0)); // token sama
        vm.expectRevert(abi.encodeWithSelector(CordonVault.InvalidTrade.selector, 0));
        _prune(_one(3, 0, 1e18, 0)); // indeks di luar jangkauan
        vm.expectRevert(abi.encodeWithSelector(CordonVault.InvalidTrade.selector, 0));
        _prune(_one(1, 7, 1e18, 0));
        vm.expectRevert(abi.encodeWithSelector(CordonVault.InvalidTrade.selector, 0));
        _prune(_one(1, 0, 0, 0)); // jumlah 0
        vm.expectRevert(abi.encodeWithSelector(CordonVault.InvalidTrade.selector, 0));
        _prune(_one(1, 0, 20e18 + 1, 0)); // lebih dari saldo
    }

    function test_prune_revertsBeforeSeed() public {
        _configure(50);
        vm.expectRevert(CordonVault.NotSeeded.selector);
        _prune(_perfect());
    }

    function test_prune_doesNotBlockMintOrRedeem() public {
        _seed();
        _configure(50);
        _prune(_perfect());
        uint256[] memory minAmt = new uint256[](3);
        vm.prank(admin);
        vault.redeem(10e18, admin, 7, minAmt); // in-kind tetap jalan sesudah prune
        assertEq(vault.totalSupply(), 90e18);
    }

    function test_prune_revokingKeeperDisablesPruning() public {
        _seed();
        _configure(50);
        bytes32 k = Roles.KEEPER_ROLE;
        vm.prank(admin);
        vault.revokeRole(k, keeper); // mencabut KEEPER langsung mematikan pruning
        vm.expectRevert(_noRole(keeper, k));
        _prune(_perfect());
    }

    // ------------------------------------------------------------ fuzz

    /// Untuk jumlah jual dan spread apa pun: bila prune sukses maka drift turun STRICT, vault tidak menjual melebihi
    /// saldo, dan nilai yang hilang <= slippage kontrak x nilai yang dijual.
    function testFuzz_prune_successImpliesReducedDriftAndBoundedLoss(uint256 amtSeed, uint16 spread, uint8 pair)
        public
    {
        _seed();
        _configure(200);
        spread = uint16(bound(spread, 0, 400));
        venue.setSpreadBps(spread);
        venue.setIgnoreMin(true); // venue tidak membantu: hanya pemeriksaan vault yang menjaga
        uint256 i = bound(pair, 0, 2);
        uint256 o = (i + 1 + bound(pair >> 4, 0, 1)) % 3;
        uint256 bal = tk[i].balanceOf(address(vault));
        uint256 amt = bound(amtSeed, 1, bal);
        (, uint256 d0) = vault.tryDriftBps();
        (, uint256 v0,) = vault.tryNav();
        (uint256 pIn,) = router.getPrice(address(tk[i]));
        uint256 soldValue = amt * pIn / (10 ** tk[i].decimals());

        vm.prank(keeper);
        try vault.prune(_one(i, o, amt, 0)) {
            (, uint256 d1) = vault.tryDriftBps();
            assertLt(d1, d0);
            (, uint256 v1,) = vault.tryNav();
            assertLe(v0 - v1, soldValue * 200 / 10_000 + 1e6); // + pembulatan desimal
            assertLe(spread, 200 + 1); // spread di atas cap tidak mungkin lolos
        } catch {}
    }

    function _refreshFeeds() internal {
        uint256[3] memory px = [uint256(100e8), 50e8, 10e8];
        for (uint256 i; i < 3; i++) {
            feeds[i].setRound(int256(px[i]));
        }
        seq.setRaw(1, 0, block.timestamp - 30 days, block.timestamp - 30 days, 1);
    }
}
