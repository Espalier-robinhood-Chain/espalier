// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {OracleRouter} from "../src/OracleRouter.sol";
import {MarketSession} from "../src/MarketSession.sol";
import {SettlementOracle} from "../src/SettlementOracle.sol";
import {GraftVault} from "../src/GraftVault.sol";
import {HarvestAuction} from "../src/HarvestAuction.sol";
import {MockAggregator} from "./mocks/MockAggregator.sol";
import {MockERC20} from "./mocks/MockERC20.sol";

/// GraftVault (cash-secured put) + HarvestAuction. Garis waktu uji sama dengan SpurVault.t.sol (ET, 2026):
///   FRI = Jumat 2026-10-02 00:00. Round 1: roll Senin 10-05 10:00, expiry Jumat 10-09 16:00.
///   Round 2: roll Senin 10-12 10:00, expiry Jumat 10-16 16:00.
/// Collateral USDG (6 desimal), acuan harga NVDA (18 desimal, feed 8 desimal). otmBps 1000: strike = 90% harga roll.
contract GraftVaultTest is Test {
    uint256 internal constant FRI = 1_790_913_600;
    uint256 internal constant T1 = FRI + 3 days + 10 hours;
    uint64 internal constant E1 = uint64(FRI + 7 days + 16 hours);
    uint256 internal constant T2 = FRI + 10 days + 10 hours;
    uint64 internal constant E2 = uint64(FRI + 14 days + 16 hours);

    uint256 internal constant INIT = 1_000_000e6; // saldo awal Alice/Bob (USDG)
    uint256 internal constant PICKER0 = 1_000_000_000e6;

    bytes32 internal constant KEEPER = keccak256("KEEPER_ROLE");
    bytes32 internal constant GUARDIAN = keccak256("GUARDIAN_ROLE");

    OracleRouter internal router;
    MarketSession internal market;
    SettlementOracle internal so;
    MockAggregator internal feed; // 8 desimal, harga NVDA
    MockAggregator internal seq;
    MockERC20 internal stock; // 18 desimal (acuan harga saja)
    MockERC20 internal usdg; // 6 desimal (collateral dan premium)
    HarvestAuction internal auction;
    GraftVault internal vault;

    address internal admin = makeAddr("admin");
    address internal keeper = makeAddr("keeper");
    address internal guardian = makeAddr("guardian");
    address internal alice = makeAddr("alice");
    address internal bob = makeAddr("bob");
    address internal picker;
    uint256 internal pickerKey;

    function setUp() public {
        (picker, pickerKey) = makeAddrAndKey("picker");
        vm.warp(FRI);
        market = new MarketSession(admin);
        seq = new MockAggregator(0);
        seq.setRaw(1, 0, FRI - 30 days, FRI - 30 days, 1);
        router = new OracleRouter(admin, address(seq), 1 hours, address(market));
        stock = new MockERC20("NVDA token", "NVDA", 18);
        usdg = new MockERC20("USDG", "USDG", 6);
        feed = new MockAggregator(8);
        vm.prank(admin);
        router.setAssetWindows(address(stock), address(feed), 30 minutes, 1 hours, 1 hours, false);
        so = new SettlementOracle(address(router), 2 hours);
        auction = new HarvestAuction(admin);
        vault = new GraftVault(
            admin,
            address(usdg),
            address(stock),
            address(router),
            address(so),
            address(auction),
            6 hours,
            1e6, // minimum setoran $1
            type(uint256).max,
            1000, // 10% OTM (strike = 0,9 x harga)
            0
        );
        vm.startPrank(admin);
        vault.grantRole(KEEPER, keeper);
        vault.grantRole(GUARDIAN, guardian);
        auction.grantRole(KEEPER, keeper);
        auction.setPicker(picker, true);
        vm.stopPrank();

        usdg.mint(alice, INIT);
        usdg.mint(bob, INIT);
        usdg.mint(picker, PICKER0);
        vm.prank(alice);
        usdg.approve(address(vault), type(uint256).max);
        vm.prank(bob);
        usdg.approve(address(vault), type(uint256).max);
        vm.prank(picker);
        usdg.approve(address(auction), type(uint256).max);
    }

    // ------------------------------------------------------------------ helpers

    function _dep(address who, uint256 amt) internal {
        vm.prank(who);
        vault.deposit(amt);
    }

    function _roll(uint64 expiry, int256 p8) internal {
        feed.setRound(p8);
        vm.prank(keeper);
        vault.rollRound(expiry);
    }

    function _rd() internal view returns (uint64 expiry, uint256 strike, uint256 notional, address who, uint256 prem) {
        GraftVault.Round memory r = vault.getRound(vault.round());
        return (r.expiry, r.strikeE18, r.notional, r.picker, r.premium);
    }

    /// Notional yang diharapkan: collateral (USDG, 6 desimal) / strike (E18) dalam satuan terkecil token 18 desimal, dibulatkan ke bawah.
    function _notional(uint256 collateral, uint256 strikeE18) internal pure returns (uint256) {
        return collateral * 1e30 / strikeE18;
    }

    /// Payout put yang diharapkan: notional x (K - P) dalam USDG, dibulatkan ke bawah.
    function _payout(uint256 notional, uint256 strikeE18, uint256 priceE18) internal pure returns (uint256) {
        return notional * (strikeE18 - priceE18) / 1e30;
    }

    function _quote(uint256 premium, uint64 deadline) internal view returns (HarvestAuction.Quote memory q) {
        (uint64 e, uint256 k, uint256 n,,) = _rd();
        q = HarvestAuction.Quote(address(vault), picker, vault.round(), k, e, n, premium, deadline);
    }

    function _sign(HarvestAuction.Quote memory q) internal view returns (bytes memory) {
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(pickerKey, auction.hashQuote(q));
        return abi.encodePacked(r, s, v);
    }

    function _fill(uint256 premium) internal {
        HarvestAuction.Quote memory q = _quote(premium, uint64(block.timestamp + 1 hours));
        bytes memory sig = _sign(q);
        vm.prank(keeper);
        auction.fill(q, sig);
    }

    function _settle(uint64 expiry, int256 p8) internal {
        feed.pushRound(p8, expiry + 5 minutes);
        vm.warp(expiry + 1 hours);
        so.settle(address(stock), expiry, feed.roundId());
        vault.settleRound();
    }

    /// Satu round penuh: roll di T1 pada harga 100, jual dengan `premium`, settle di `p8`.
    function _round1(uint256 premium, int256 p8) internal {
        vm.warp(T1);
        _roll(E1, 100e8);
        _fill(premium);
        _settle(E1, p8);
    }

    /// Satu token untuk collateral, premium, klaim penarikan, dan klaim Picker: saldo harus menutup semuanya.
    function _conserved() internal view {
        assertGe(
            usdg.balanceOf(address(vault)),
            vault.managedAssets() + vault.pendingDeposits() + vault.reservedWithdraw() + vault.totalPickerOwed()
                + vault.premiumHeld(),
            "saldo < pembukuan"
        );
    }

    // ------------------------------------------------------------------ jalur utama

    function test_fullCycle_otm_premiumSplitAndWithdraw() public {
        _dep(alice, 10_000e6);
        _dep(bob, 5_000e6);
        assertEq(vault.pendingDeposits(), 15_000e6);
        assertEq(vault.sharesOf(alice), 0, "belum jadi share sebelum roll");

        vm.warp(T1);
        _roll(E1, 100e8);
        (uint64 e, uint256 k, uint256 n,,) = _rd();
        assertEq(e, E1);
        assertEq(k, 90e18, "strike = 100 x 0,90");
        assertEq(n, _notional(15_000e6, 90e18), "seluruh collateral / strike");
        assertLe(n * k / 1e30, 15_000e6, "cash-secured: notional x strike <= collateral");
        assertEq(vault.sharesOf(alice), 10_000e6);
        assertEq(vault.sharesOf(bob), 5_000e6);
        assertTrue(vault.active());

        _fill(150e6);
        assertApproxEqAbs(vault.pendingPremium(alice), 100e6, 2);
        assertApproxEqAbs(vault.pendingPremium(bob), 50e6, 2);

        _settle(E1, 95e8); // P >= K: tidak ada payout
        assertFalse(vault.active());
        GraftVault.Round memory r1 = vault.getRound(1);
        assertEq(r1.settlePriceE18, 95e18);
        assertEq(r1.payout, 0);
        assertEq(uint8(r1.outcome), uint8(GraftVault.Outcome.Settled));
        assertEq(vault.managedAssets(), 15_000e6);

        vm.prank(alice);
        vault.claimPremium();
        assertApproxEqAbs(usdg.balanceOf(alice), INIT - 10_000e6 + 100e6, 2);
        vm.prank(alice);
        vm.expectRevert(GraftVault.NothingToClaim.selector);
        vault.claimPremium();

        vm.prank(alice);
        vault.requestWithdraw(10_000e6);
        vm.warp(T2);
        _roll(E2, 100e8);
        assertEq(vault.sharesOf(alice), 0);
        assertEq(vault.pendingWithdrawAssets(alice), 10_000e6);
        vm.prank(alice);
        vault.claimWithdraw();
        assertApproxEqAbs(usdg.balanceOf(alice), INIT + 100e6, 2, "collateral kembali penuh + premium");
        assertEq(vault.getRound(2).notional, _notional(5_000e6, 90e18), "tinggal posisi Bob");
        _conserved();
    }

    function test_fullCycle_itm_pickerGetsUsdgAndPpsDrops() public {
        _dep(alice, 10_000e6);
        _dep(bob, 5_000e6);
        _round1(150e6, 72e8); // P=72 < K=90

        uint256 n = _notional(15_000e6, 90e18);
        uint256 expectedPayout = _payout(n, 90e18, 72e18);
        assertApproxEqAbs(expectedPayout, 3_000e6, 1, "166,67 token x $18");
        assertEq(vault.getRound(1).payout, expectedPayout);
        assertEq(vault.managedAssets(), 15_000e6 - expectedPayout);
        assertEq(vault.pickerOwed(picker), expectedPayout);

        vm.prank(picker);
        vault.claimPickerPayout();
        assertEq(usdg.balanceOf(picker), PICKER0 - 150e6 + expectedPayout);
        vm.prank(picker);
        vm.expectRevert(GraftVault.NothingToClaim.selector);
        vault.claimPickerPayout();

        assertApproxEqAbs(vault.assetsOf(alice), (15_000e6 - expectedPayout) * 2 / 3, 2);
        vm.prank(alice);
        vault.requestWithdraw(10_000e6);
        vm.warp(T2);
        _roll(E2, 100e8);
        assertApproxEqAbs(vault.pendingWithdrawAssets(alice), (15_000e6 - expectedPayout) * 2 / 3, 2);
        vm.prank(alice);
        vault.claimWithdraw();
        _conserved();
    }

    function test_deepItm_payoutNeverExceedsCollateral() public {
        _dep(alice, 10_000e6);
        _round1(100e6, 1e6); // P = $0,01
        uint256 n = _notional(10_000e6, 90e18);
        uint256 expected = _payout(n, 90e18, 1e16);
        assertEq(vault.getRound(1).payout, expected);
        assertLt(expected, 10_000e6, "payout selalu di bawah collateral");
        assertEq(vault.managedAssets(), 10_000e6 - expected);
        assertGt(vault.managedAssets(), 0, "sisa = notional x harga");
        _conserved();
    }

    function test_atStrike_noPayout() public {
        _dep(alice, 10_000e6);
        _round1(100e6, 90e8); // P == K
        assertEq(vault.getRound(1).payout, 0);
        assertEq(vault.managedAssets(), 10_000e6);
    }

    function test_lateDepositorOnlyEarnsFromNextRound() public {
        _dep(alice, 10_000e6);
        vm.warp(T1);
        _roll(E1, 100e8);
        _dep(bob, 10_000e6); // antre, masuk di roll 2
        assertEq(vault.sharesOf(bob), 0);
        _fill(100e6);
        _settle(E1, 100e8);

        vm.warp(T2);
        _roll(E2, 100e8);
        assertEq(vault.sharesOf(bob), 10_000e6);
        assertApproxEqAbs(vault.pendingPremium(alice), 100e6, 2, "round 1 penuh untuk Alice");
        assertEq(vault.pendingPremium(bob), 0, "Bob tidak ikut round 1");

        _fill(200e6);
        assertApproxEqAbs(vault.pendingPremium(alice), 200e6, 3, "100 + setengah dari 200");
        assertApproxEqAbs(vault.pendingPremium(bob), 100e6, 3);
        _conserved();
    }

    function test_withdrawRequestStillEarnsCurrentRoundPremium() public {
        _dep(alice, 10_000e6);
        _dep(bob, 10_000e6);
        vm.warp(T1);
        _roll(E1, 100e8);
        vm.prank(alice);
        vault.requestWithdraw(10_000e6);
        _fill(200e6);
        assertApproxEqAbs(vault.pendingPremium(alice), 100e6, 2, "masih berhak atas round yang berjalan");
        _settle(E1, 100e8);

        vm.warp(T2);
        _roll(E2, 100e8);
        assertEq(vault.sharesOf(alice), 0);
        _fill(60e6);
        assertApproxEqAbs(vault.pendingPremium(alice), 100e6, 2, "tidak ikut round 2");
        assertApproxEqAbs(vault.pendingPremium(bob), 160e6, 3);
        vm.prank(alice);
        vault.claimWithdraw();
        assertEq(usdg.balanceOf(alice), INIT, "collateral kembali; premium belum diklaim");
        _conserved();
    }

    function test_unsoldRound_closeUnsoldThenRollAgain() public {
        _dep(alice, 10_000e6);
        vm.warp(T1);
        _roll(E1, 100e8);
        vm.expectRevert(GraftVault.FillWindowOpen.selector);
        vault.closeUnsold();
        vm.warp(T1 + 6 hours + 1);
        vault.closeUnsold();
        assertFalse(vault.active());
        vm.expectRevert(GraftVault.NotActive.selector);
        vault.settleRound();

        vm.warp(T1 + 7 hours);
        _roll(E1, 100e8);
        assertEq(vault.round(), 2);
        assertTrue(vault.active());
        assertEq(vault.managedAssets(), 10_000e6, "collateral utuh");
    }

    function test_allWithdrawn_roundSkippedWithoutOracle() public {
        _dep(alice, 10_000e6);
        _round1(100e6, 100e8);
        vm.prank(alice);
        vault.requestWithdraw(10_000e6);
        vm.warp(T2); // sengaja tanpa menyegarkan feed: round skipped tidak butuh harga
        vm.prank(keeper);
        vault.rollRound(E2);
        assertFalse(vault.active());
        assertEq(vault.totalShares(), 0);
        vm.prank(alice);
        vault.claimWithdraw();
        assertEq(usdg.balanceOf(alice), INIT);
        assertApproxEqAbs(vault.pendingPremium(alice), 100e6, 2);
        _conserved();
    }

    // ------------------------------------------------------------------ setoran dan penarikan

    function test_cancelDeposit_instantOnlyBeforeRoll() public {
        _dep(alice, 10_000e6);
        vm.prank(alice);
        vault.cancelDeposit(4_000e6);
        assertEq(usdg.balanceOf(alice), INIT - 6_000e6);
        assertEq(vault.pendingDeposits(), 6_000e6);

        vm.warp(T1);
        _roll(E1, 100e8);
        vm.prank(alice);
        vm.expectRevert(GraftVault.NothingToCancel.selector);
        vault.cancelDeposit(1e6);
        assertEq(vault.sharesOf(alice), 6_000e6);
    }

    function test_depositAfterRoll_mergesOnlyWithSameRoundReceipt() public {
        _dep(alice, 10_000e6);
        vm.warp(T1);
        _roll(E1, 100e8);
        _dep(alice, 3_000e6); // receipt lama dikonversi, yang baru untuk round 2
        _dep(alice, 2_000e6); // digabung ke receipt round 2
        (uint64 r, uint256 a) = vault.depositOf(alice);
        assertEq(r, 2);
        assertEq(a, 5_000e6);
        assertEq(vault.sharesOf(alice), 10_000e6);
        assertEq(vault.pendingDeposits(), 5_000e6);
    }

    function test_requestWithdraw_needsConvertedShares() public {
        _dep(alice, 10_000e6);
        vm.prank(alice);
        vm.expectRevert(GraftVault.InsufficientShares.selector);
        vault.requestWithdraw(1e6);

        vm.warp(T1);
        _roll(E1, 100e8);
        vm.startPrank(alice);
        vault.requestWithdraw(6_000e6);
        vm.expectRevert(GraftVault.InsufficientShares.selector);
        vault.requestWithdraw(4_100e6); // hanya 4.000 yang tersisa
        vault.cancelWithdraw(1_000e6);
        vault.requestWithdraw(5_000e6);
        vm.stopPrank();
        assertEq(vault.queuedWithdrawShares(), 10_000e6);
    }

    function test_depositLimits() public {
        vm.prank(alice);
        vm.expectRevert(GraftVault.DepositTooSmall.selector);
        vault.deposit(1e5);

        vm.prank(admin);
        vault.setDepositCap(12_000e6);
        _dep(alice, 10_000e6);
        vm.prank(bob);
        vm.expectRevert(GraftVault.DepositCapExceeded.selector);
        vault.deposit(2_100e6);
        _dep(bob, 2_000e6);
    }

    function test_donationDoesNotMoveSharePrice() public {
        _dep(alice, 10_000e6);
        vm.warp(T1);
        _roll(E1, 100e8);
        uint256 pps = vault.pricePerShare();
        usdg.mint(address(vault), 1_000_000e6); // donasi langsung
        assertEq(vault.pricePerShare(), pps);
        _dep(bob, 10_000e6);
        _fill(10e6);
        _settle(E1, 100e8);
        vm.warp(T2);
        _roll(E2, 100e8);
        assertEq(vault.sharesOf(bob), 10_000e6, "Bob tetap 1:1");
    }

    // ------------------------------------------------------------------ roll dan oracle

    function test_roll_onlyKeeper_onlyIdle_expiryBounds() public {
        _dep(alice, 10_000e6);
        vm.warp(T1);
        feed.setRound(100e8);
        vm.prank(alice);
        vm.expectRevert();
        vault.rollRound(E1);

        vm.startPrank(keeper);
        vm.expectRevert(GraftVault.InvalidExpiry.selector);
        vault.rollRound(uint64(block.timestamp + 1 hours));
        vm.expectRevert(GraftVault.InvalidExpiry.selector);
        vault.rollRound(uint64(block.timestamp + 15 days));
        vault.rollRound(E1);
        vm.expectRevert(GraftVault.NotIdle.selector);
        vault.rollRound(E1);
        vm.stopPrank();
    }

    function test_roll_revertsWhenMarketClosedOrPriceStaleOrUnderlyingPaused() public {
        _dep(alice, 10_000e6);
        // Sabtu: pasar tutup.
        vm.warp(FRI + 1 days + 12 hours);
        feed.setRound(100e8);
        vm.prank(keeper);
        vm.expectRevert();
        vault.rollRound(E1);
        // Senin, harga basi.
        vm.warp(T1);
        vm.prank(keeper);
        vm.expectRevert();
        vault.rollRound(E1);
        // Aset acuan dijeda (corporate action): round ditahan, bukan dibatalkan.
        feed.setRound(100e8);
        vm.prank(admin);
        router.pauseAsset(address(stock));
        vm.prank(keeper);
        vm.expectRevert();
        vault.rollRound(E1);
        assertEq(vault.round(), 0, "tidak ada keadaan setengah jalan");
        assertEq(vault.pendingDeposits(), 10_000e6);
    }

    function test_strikeUsesLivePriceAndOtmBps_roundsDown() public {
        _dep(alice, 10_000e6);
        vm.prank(admin);
        vault.setOtmBps(2500);
        vm.warp(T1);
        _roll(E1, 200e8);
        (, uint256 k,,,) = _rd();
        assertEq(k, 150e18, "strike = 200 x 0,75");
        vm.prank(admin);
        vm.expectRevert(GraftVault.InvalidConfig.selector);
        vault.setOtmBps(99);
        vm.prank(admin);
        vm.expectRevert(GraftVault.InvalidConfig.selector);
        vault.setOtmBps(5001);
    }

    /// Apa pun jumlah setoran dan harga: notional x strike tidak pernah melebihi collateral, dan strike di bawah harga.
    function testFuzz_cashSecured(uint96 amt, uint32 price8, uint16 otm) public {
        uint256 a = bound(amt, 1e6, 1e15);
        int256 p8 = int256(bound(price8, 1e6, 1e12)); // $0,01 .. $10.000
        vm.prank(admin);
        vault.setOtmBps(uint16(bound(otm, 100, 5000)));
        usdg.mint(alice, a);
        vm.prank(alice);
        usdg.approve(address(vault), type(uint256).max);
        _dep(alice, a);
        vm.warp(T1);
        _roll(E1, p8);
        if (!vault.active()) return;
        (, uint256 k, uint256 n,,) = _rd();
        assertLt(k, uint256(p8) * 1e10, "strike di bawah harga");
        assertLe(n * k / 1e30, vault.managedAssets(), "cash-secured");
        // Payout maksimum (harga mendekati nol) tetap di bawah collateral.
        assertLe(_payout(n, k, 1), vault.managedAssets());
    }

    // ------------------------------------------------------------------ auction

    function test_fill_authorizationAndSignature() public {
        _dep(alice, 10_000e6);
        vm.warp(T1);
        _roll(E1, 100e8);
        HarvestAuction.Quote memory q = _quote(100e6, uint64(block.timestamp + 1 hours));
        bytes memory sig = _sign(q);

        vm.prank(makeAddr("stranger"));
        vm.expectRevert(HarvestAuction.NotAuthorized.selector);
        auction.fill(q, sig);

        (, uint256 otherKey) = makeAddrAndKey("other");
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(otherKey, auction.hashQuote(q));
        vm.prank(keeper);
        vm.expectRevert(HarvestAuction.BadSignature.selector);
        auction.fill(q, abi.encodePacked(r, s, v));

        HarvestAuction.Quote memory tampered = _quote(1e6, q.deadline);
        vm.prank(keeper);
        vm.expectRevert(HarvestAuction.BadSignature.selector);
        auction.fill(tampered, sig);

        vm.prank(picker);
        auction.fill(q, sig);
        assertEq(usdg.balanceOf(address(vault)), 10_000e6 + 100e6);
        assertEq(vault.premiumHeld(), 100e6);
        _conserved();
    }

    function test_fill_whitelistDeadlineWrongVault() public {
        _dep(alice, 10_000e6);
        vm.warp(T1);
        _roll(E1, 100e8);
        HarvestAuction.Quote memory q = _quote(100e6, uint64(block.timestamp + 1 hours));
        bytes memory sig = _sign(q);

        vm.prank(admin);
        auction.setPicker(picker, false);
        vm.prank(keeper);
        vm.expectRevert(HarvestAuction.PickerNotAllowed.selector);
        auction.fill(q, sig);
        vm.prank(admin);
        auction.setPicker(picker, true);

        vm.warp(block.timestamp + 2 hours);
        vm.prank(keeper);
        vm.expectRevert(HarvestAuction.QuoteExpired.selector);
        auction.fill(q, sig);

        HarvestAuction other = new HarvestAuction(admin);
        vm.prank(admin);
        other.grantRole(KEEPER, keeper);
        vm.prank(admin);
        other.setPicker(picker, true);
        HarvestAuction.Quote memory q2 = _quote(100e6, uint64(block.timestamp + 1 hours));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(pickerKey, other.hashQuote(q2));
        vm.prank(keeper);
        vm.expectRevert(HarvestAuction.WrongAuction.selector);
        other.fill(q2, abi.encodePacked(r, s, v));
    }

    function test_fill_onlyOncePerRound_noReplayAcrossRounds() public {
        _dep(alice, 10_000e6);
        vm.warp(T1);
        _roll(E1, 100e8);
        HarvestAuction.Quote memory q = _quote(100e6, uint64(block.timestamp + 30 hours));
        bytes memory sig = _sign(q);
        vm.prank(keeper);
        auction.fill(q, sig);

        vm.prank(keeper);
        vm.expectRevert(HarvestAuction.AlreadyFilled.selector);
        auction.fill(q, sig);

        HarvestAuction.Quote memory q2 = _quote(120e6, uint64(block.timestamp + 30 days));
        bytes memory sig2 = _sign(q2);
        vm.prank(keeper);
        vm.expectRevert(GraftVault.AlreadySold.selector);
        auction.fill(q2, sig2);

        _settle(E1, 100e8);
        vm.warp(T2);
        _roll(E2, 100e8);
        vm.prank(keeper);
        vm.expectRevert(GraftVault.RoundMismatch.selector);
        auction.fill(q2, sig2);
    }

    function test_fill_rejectsWrongTermsAndLateFill() public {
        _dep(alice, 10_000e6);
        vm.warp(T1);
        _roll(E1, 100e8);
        HarvestAuction.Quote memory q = _quote(100e6, uint64(block.timestamp + 20 hours));
        q.strikeE18 += 1;
        bytes memory badSig = _sign(q);
        vm.prank(keeper);
        vm.expectRevert(GraftVault.RoundMismatch.selector);
        auction.fill(q, badSig);

        q = _quote(100e6, uint64(block.timestamp + 20 hours));
        q.notional += 1; // notional tidak sama dengan round
        bytes memory badSig2 = _sign(q);
        vm.prank(keeper);
        vm.expectRevert(GraftVault.RoundMismatch.selector);
        auction.fill(q, badSig2);

        q = _quote(100e6, uint64(block.timestamp + 20 hours));
        bytes memory sig = _sign(q);
        vm.warp(T1 + 6 hours + 1);
        vm.prank(keeper);
        vm.expectRevert(GraftVault.FillWindowClosed.selector);
        auction.fill(q, sig);
    }

    function test_recordSale_onlyAuction() public {
        _dep(alice, 10_000e6);
        vm.warp(T1);
        _roll(E1, 100e8);
        (uint64 e, uint256 k, uint256 n,,) = _rd();
        vm.prank(keeper);
        vm.expectRevert(GraftVault.NotAuction.selector);
        vault.recordSale(picker, 1, k, e, n, 1e6);
    }

    /// Satu token: collateral di saldo vault TIDAK boleh dihitung sebagai premium yang diterima.
    function test_recordSale_collateralIsNotPremium() public {
        _dep(alice, 10_000e6);
        vm.warp(T1);
        _roll(E1, 100e8);
        (uint64 e, uint256 k, uint256 n,,) = _rd();
        vm.prank(address(auction));
        vm.expectRevert(GraftVault.PremiumNotReceived.selector);
        vault.recordSale(picker, 1, k, e, n, 5e6); // saldo 10.000 USDG ada, tetapi premium tidak dikirim

        // Dikirim sebagian: tetap kurang.
        vm.prank(picker);
        usdg.transfer(address(vault), 3e6);
        vm.prank(address(auction));
        vm.expectRevert(GraftVault.PremiumNotReceived.selector);
        vault.recordSale(picker, 1, k, e, n, 5e6);

        // Dikirim penuh: diterima.
        vm.prank(picker);
        usdg.transfer(address(vault), 2e6);
        vm.prank(address(auction));
        vault.recordSale(picker, 1, k, e, n, 5e6);
        assertEq(vault.premiumHeld(), 5e6);
        _conserved();
    }

    function test_minPremiumFloor() public {
        _dep(alice, 10_000e6);
        vm.prank(admin);
        vault.setMinPremiumBps(100); // 1% dari collateral
        vm.warp(T1);
        _roll(E1, 100e8);
        (,,,, uint256 prem) = _rd();
        assertEq(prem, 0);
        assertEq(vault.getRound(1).minPremium, 100e6, "1% x $10.000 = $100");

        HarvestAuction.Quote memory q = _quote(99e6, uint64(block.timestamp + 1 hours));
        bytes memory sig = _sign(q);
        vm.prank(keeper);
        vm.expectRevert(GraftVault.PremiumBelowFloor.selector);
        auction.fill(q, sig);

        _fill(100e6);
        vm.prank(admin);
        vm.expectRevert(GraftVault.InvalidConfig.selector);
        vault.setMinPremiumBps(2001);
    }

    // ------------------------------------------------------------------ settlement

    function test_settleRound_needsExpiryAndOraclePrint() public {
        _dep(alice, 10_000e6);
        vm.warp(T1);
        _roll(E1, 100e8);
        _fill(100e6);
        vm.expectRevert(GraftVault.NotExpired.selector);
        vault.settleRound();
        vm.warp(E1 + 1 hours);
        vm.expectRevert(GraftVault.SettlementUnavailable.selector);
        vault.settleRound();
        feed.pushRound(100e8, E1 + 5 minutes);
        so.settle(address(stock), E1, feed.roundId());
        vault.settleRound();
        assertFalse(vault.active());
    }

    function test_settleRound_unsoldRoundCannotBeSettled() public {
        _dep(alice, 10_000e6);
        vm.warp(T1);
        _roll(E1, 100e8);
        vm.warp(E1 + 1 hours);
        vm.expectRevert(GraftVault.NotSold.selector);
        vault.settleRound();
    }

    function test_settlementWaitsWhileUnderlyingPaused() public {
        _dep(alice, 10_000e6);
        vm.warp(T1);
        _roll(E1, 100e8);
        _fill(100e6);
        feed.pushRound(70e8, E1 + 5 minutes);
        vm.warp(E1 + 1 hours);
        vm.prank(admin);
        router.pauseAsset(address(stock));
        // Settlement ditunda selama aset dijeda; round tetap aktif dan collateral tetap terkunci.
        uint80 rid = feed.roundId(); // dibaca dulu: vm.expectRevert berlaku untuk panggilan eksternal berikutnya
        vm.expectRevert();
        so.settle(address(stock), E1, rid);
        vm.expectRevert(GraftVault.SettlementUnavailable.selector);
        vault.settleRound();
        assertTrue(vault.active());
        assertEq(vault.managedAssets(), 10_000e6);
    }

    function test_pickerPayoutCannotBeBlockedByVault() public {
        _dep(alice, 10_000e6);
        _round1(100e6, 50e8);
        assertGt(vault.pickerOwed(picker), 0);
        assertFalse(vault.active());
    }

    // ------------------------------------------------------------------ jeda dan admin

    function test_pause_blocksDepositAndRollOnly() public {
        _dep(alice, 10_000e6);
        vm.prank(guardian);
        vault.pause();
        vm.prank(bob);
        vm.expectRevert(Pausable.EnforcedPause.selector);
        vault.deposit(1e6);
        vm.warp(T1);
        feed.setRound(100e8);
        vm.prank(keeper);
        vm.expectRevert(Pausable.EnforcedPause.selector);
        vault.rollRound(E1);

        vm.prank(alice);
        vault.cancelDeposit(10_000e6);
        assertEq(usdg.balanceOf(alice), INIT);

        vm.prank(guardian);
        vm.expectRevert();
        vault.unpause();
        vm.prank(admin);
        vault.unpause();
        _dep(bob, 1e6);
    }

    function test_pause_notForStrangers() public {
        vm.prank(alice);
        vm.expectRevert(GraftVault.NotGuardian.selector);
        vault.pause();
    }

    function test_adminFunctionsRestricted() public {
        vm.startPrank(alice);
        vm.expectRevert();
        vault.setOtmBps(1000);
        vm.expectRevert();
        vault.setMinPremiumBps(1);
        vm.expectRevert();
        vault.setDepositCap(1);
        vm.expectRevert();
        vault.grantRole(KEEPER, alice);
        vm.stopPrank();
    }

    function test_constructorValidation() public {
        address u = address(usdg);
        address s = address(stock);
        vm.expectRevert(GraftVault.ZeroAddress.selector);
        new GraftVault(address(0), u, s, address(router), address(so), address(auction), 6 hours, 1, 1, 1000, 0);
        vm.expectRevert(GraftVault.ZeroAddress.selector);
        new GraftVault(admin, u, address(0), address(router), address(so), address(auction), 6 hours, 1, 1, 1000, 0);
        vm.expectRevert(GraftVault.InvalidConfig.selector);
        new GraftVault(admin, u, s, address(router), address(so), address(auction), 30 minutes, 1, 1, 1000, 0);
        vm.expectRevert(GraftVault.InvalidConfig.selector);
        new GraftVault(admin, u, s, address(router), address(so), address(auction), 6 hours, 0, 1, 1000, 0);
        vm.expectRevert(GraftVault.InvalidConfig.selector);
        new GraftVault(admin, u, s, address(router), address(so), address(auction), 6 hours, 1, 1, 50, 0);
        vm.expectRevert(GraftVault.InvalidConfig.selector);
        new GraftVault(admin, u, u, address(router), address(so), address(auction), 6 hours, 1, 1, 1000, 0); // asset == underlying
    }

    // ------------------------------------------------------------------ fuzz: kekekalan nilai

    /// Apa pun harga settlement, ukuran setoran, dan premium: Picker tidak pernah menerima lebih dari collateral,
    /// pemegang menerima persis (premium - payout) hingga debu pembulatan, dan tidak ada nilai tertinggal di vault.
    function testFuzz_valueConservation(uint96 aAmt, uint96 bAmt, uint32 settle8, uint32 premium6) public {
        uint256 a = bound(aAmt, 1e6, 1e11); // sampai $100.000, di bawah saldo awal
        uint256 b = bound(bAmt, 1e6, 1e11);
        int256 p8 = int256(bound(settle8, 1e6, 1e11)); // $0,01 .. $1000
        uint256 prem = bound(premium6, 1, 1e12);
        _dep(alice, a);
        _dep(bob, b);
        _round1(prem, p8);

        uint256 payout = vault.getRound(1).payout;
        assertLe(payout, a + b, "payout tidak melebihi collateral");

        uint256 aShares = vault.sharesOf(alice);
        uint256 bShares = vault.sharesOf(bob);
        vm.prank(alice);
        vault.requestWithdraw(aShares);
        vm.prank(bob);
        vault.requestWithdraw(bShares);
        vm.warp(T2);
        vm.prank(keeper);
        vault.rollRound(E2);

        vm.prank(alice);
        vault.claimWithdraw();
        vm.prank(bob);
        vault.claimWithdraw();
        if (vault.pickerOwed(picker) != 0) {
            vm.prank(picker);
            vault.claimPickerPayout();
        }
        if (vault.pendingPremium(alice) != 0) {
            vm.prank(alice);
            vault.claimPremium();
        }
        if (vault.pendingPremium(bob) != 0) {
            vm.prank(bob);
            vault.claimPremium();
        }

        int256 net = int256(usdg.balanceOf(alice) + usdg.balanceOf(bob)) - int256(2 * INIT);
        assertLe(net, int256(prem) - int256(payout), "pemegang tidak boleh menerima lebih dari premium - payout");
        assertGe(net + int256(vault.managedAssets()) + 8, int256(prem) - int256(payout), "selisih hanya debu pembulatan");
        assertLt(vault.managedAssets(), vault.MIN_DEPOSIT(), "hanya debu yang tersisa");
        assertLe(usdg.balanceOf(address(vault)), vault.managedAssets() + 8, "tidak ada nilai tertinggal");
        _conserved();
    }

    // ------------------------------------------------------------------ fuzz: beberapa round, tiga pemegang

    function _rnd(uint256 seed, uint256 a, uint256 b, uint256 c) internal pure returns (uint256) {
        return uint256(keccak256(abi.encode(seed, a, b, c)));
    }

    function testFuzz_multiRound_solvencyAndConservation(uint256 seed) public {
        address carol = makeAddr("carol");
        usdg.mint(carol, INIT);
        vm.prank(carol);
        usdg.approve(address(vault), type(uint256).max);
        address[3] memory us = [alice, bob, carol];

        for (uint256 k = 0; k < 3; k++) {
            for (uint256 u = 0; u < 3; u++) {
                if (_rnd(seed, k, u, 0) % 3 != 0) {
                    uint256 bal = usdg.balanceOf(us[u]);
                    uint256 amt = 1e6 + _rnd(seed, k, u, 1) % 1e11;
                    if (amt <= bal) _dep(us[u], amt);
                }
                (uint64 wr, uint256 ws) = vault.withdrawOf(us[u]);
                uint256 avail = vault.sharesOf(us[u]) - (wr > vault.round() ? ws : 0);
                if (avail > 0 && _rnd(seed, k, u, 2) % 3 == 0) {
                    vm.prank(us[u]);
                    vault.requestWithdraw(1 + (avail - 1) * (_rnd(seed, k, u, 3) % 100 + 1) / 100);
                }
            }
            vm.warp(T1 + k * 7 days);
            feed.setRound(int256(50e8 + _rnd(seed, k, 9, 4) % 200e8));
            vm.prank(keeper);
            vault.rollRound(uint64(T1 + k * 7 days + 4 days + 6 hours));
            if (vault.active()) {
                _fill(1 + _rnd(seed, k, 9, 5) % 1e9);
                (uint64 e,,,,) = _rd();
                _settle(e, int256(10e8 + _rnd(seed, k, 9, 6) % 300e8));
            }
            _conserved();
        }

        // Semua keluar lewat satu roll terakhir (tanpa share tersisa, round ini dilewati).
        for (uint256 u = 0; u < 3; u++) {
            (uint64 wr, uint256 ws) = vault.withdrawOf(us[u]);
            uint256 avail = vault.sharesOf(us[u]) - (wr > vault.round() ? ws : 0);
            if (avail > 0) {
                vm.prank(us[u]);
                vault.requestWithdraw(avail);
            }
        }
        vm.warp(T1 + 3 * 7 days);
        vm.prank(keeper);
        vault.rollRound(uint64(T1 + 3 * 7 days + 4 days + 6 hours));
        assertFalse(vault.active(), "round dilewati: tidak ada yang layak dijual");
        assertLt(vault.managedAssets(), vault.MIN_DEPOSIT(), "hanya debu pembulatan yang tersisa");

        // Semua klaim harus berhasil (solven); tidak ada yang bisa mengambil lebih dari saldo.
        for (uint256 u = 0; u < 3; u++) {
            address who = us[u];
            if (vault.pendingWithdrawAssets(who) != 0) {
                vm.prank(who);
                vault.claimWithdraw();
            }
            if (vault.pendingPremium(who) != 0) {
                vm.prank(who);
                vault.claimPremium();
            }
        }
        if (vault.pickerOwed(picker) != 0) {
            vm.prank(picker);
            vault.claimPickerPayout();
        }
        assertLe(usdg.balanceOf(address(vault)), vault.managedAssets() + 64, "tidak ada nilai tertinggal selain debu");
        _conserved();
    }
}
