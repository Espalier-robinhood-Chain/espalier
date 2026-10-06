// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {IAccessControl} from "@openzeppelin/contracts/access/IAccessControl.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {OracleRouter} from "../src/OracleRouter.sol";
import {MarketSession} from "../src/MarketSession.sol";
import {SettlementOracle} from "../src/SettlementOracle.sol";
import {SpurVault} from "../src/SpurVault.sol";
import {HarvestAuction} from "../src/HarvestAuction.sol";
import {MockAggregator} from "./mocks/MockAggregator.sol";
import {MockERC20} from "./mocks/MockERC20.sol";

/// SpurVault + HarvestAuction. Garis waktu uji (semua dalam ET, 2026):
///   FRI = Jumat 2026-10-02 00:00. Round 1: roll Senin 10-05 10:00, expiry Jumat 10-09 16:00.
///   Round 2: roll Senin 10-12 10:00, expiry Jumat 10-16 16:00.
contract SpurVaultTest is Test {
    uint256 internal constant FRI = 1_790_913_600;
    uint256 internal constant T1 = FRI + 3 days + 10 hours;
    uint64 internal constant E1 = uint64(FRI + 7 days + 16 hours);
    uint256 internal constant T2 = FRI + 10 days + 10 hours;
    uint64 internal constant E2 = uint64(FRI + 14 days + 16 hours);

    bytes32 internal constant KEEPER = keccak256("KEEPER_ROLE");
    bytes32 internal constant GUARDIAN = keccak256("GUARDIAN_ROLE");

    OracleRouter internal router;
    MarketSession internal market;
    SettlementOracle internal so;
    MockAggregator internal feed; // 8 desimal
    MockAggregator internal seq;
    MockERC20 internal stock; // 18 desimal
    MockERC20 internal usdg; // 6 desimal
    HarvestAuction internal auction;
    SpurVault internal vault;

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
        vault = new SpurVault(
            admin,
            address(stock),
            address(usdg),
            address(router),
            address(so),
            address(auction),
            6 hours,
            1e12,
            type(uint256).max,
            1000, // 10% OTM
            0
        );
        vm.startPrank(admin);
        vault.grantRole(KEEPER, keeper);
        vault.grantRole(GUARDIAN, guardian);
        auction.grantRole(KEEPER, keeper);
        auction.setPicker(picker, true);
        vm.stopPrank();

        stock.mint(alice, 1_000_000e18);
        stock.mint(bob, 1_000_000e18);
        usdg.mint(picker, 1_000_000_000e6);
        vm.prank(alice);
        stock.approve(address(vault), type(uint256).max);
        vm.prank(bob);
        stock.approve(address(vault), type(uint256).max);
        vm.prank(picker);
        usdg.approve(address(auction), type(uint256).max);
    }

    // ------------------------------------------------------------------ helpers

    function _dep(address who, uint256 amt) internal {
        vm.prank(who);
        vault.deposit(amt);
    }

    /// Roll round berikutnya pada waktu sekarang dengan harga feed `p8` (8 desimal).
    function _roll(uint64 expiry, int256 p8) internal {
        feed.setRound(p8);
        vm.prank(keeper);
        vault.rollRound(expiry);
    }

    function _rd() internal view returns (uint64 expiry, uint256 strike, uint256 notional, address who, uint256 prem) {
        SpurVault.Round memory r = vault.getRound(vault.round());
        return (r.expiry, r.strikeE18, r.notional, r.picker, r.premium);
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

    /// Settlement print pada `expiry` dengan harga `p8`, lalu tutup round di vault.
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

    function _conserved() internal view {
        assertGe(
            stock.balanceOf(address(vault)),
            vault.managedAssets() + vault.pendingDeposits() + vault.reservedWithdraw() + vault.totalPickerOwed(),
            "aset: saldo < pembukuan"
        );
        assertGe(usdg.balanceOf(address(vault)), vault.premiumHeld(), "premium: saldo < pembukuan");
    }

    // ------------------------------------------------------------------ jalur utama

    function test_fullCycle_otm_premiumSplitAndWithdraw() public {
        _dep(alice, 100e18);
        _dep(bob, 50e18);
        assertEq(vault.pendingDeposits(), 150e18);
        assertEq(vault.sharesOf(alice), 0, "belum jadi share sebelum roll");

        vm.warp(T1);
        _roll(E1, 100e8);
        (uint64 e, uint256 k, uint256 n,,) = _rd();
        assertEq(e, E1);
        assertEq(k, 110e18, "strike = 100 x 1,10");
        assertEq(n, 150e18);
        assertEq(vault.sharesOf(alice), 100e18);
        assertEq(vault.sharesOf(bob), 50e18);
        assertTrue(vault.active());

        _fill(150e6);
        assertApproxEqAbs(vault.pendingPremium(alice), 100e6, 2);
        assertApproxEqAbs(vault.pendingPremium(bob), 50e6, 2);

        _settle(E1, 105e8); // P <= K: tidak ada payout
        assertFalse(vault.active());
        SpurVault.Round memory r1 = vault.getRound(1);
        assertEq(r1.settlePriceE18, 105e18);
        assertEq(r1.payout, 0);
        assertEq(uint8(r1.outcome), uint8(SpurVault.Outcome.Settled));
        assertEq(vault.managedAssets(), 150e18);

        vm.prank(alice);
        vault.claimPremium();
        assertApproxEqAbs(usdg.balanceOf(alice), 100e6, 2);
        vm.prank(alice);
        vm.expectRevert(SpurVault.NothingToClaim.selector);
        vault.claimPremium();

        // Alice menarik semuanya: antre, diproses roll 2 (tanpa opsi bila hanya Bob tersisa pun tetap jalan).
        vm.prank(alice);
        vault.requestWithdraw(100e18);
        vm.warp(T2);
        _roll(E2, 100e8);
        assertEq(vault.sharesOf(alice), 0);
        assertEq(vault.pendingWithdrawAssets(alice), 100e18);
        vm.prank(alice);
        vault.claimWithdraw();
        assertEq(stock.balanceOf(alice), 1_000_000e18, "kembali penuh");
        assertEq(vault.getRound(2).notional, 50e18, "tinggal posisi Bob");
        _conserved();
    }

    function test_fullCycle_itm_pickerGetsStockAndPpsDrops() public {
        _dep(alice, 100e18);
        _dep(bob, 50e18);
        _round1(150e6, 121e8); // P=121 > K=110

        uint256 expectedPayout = uint256(150e18) * 11e18 / 121e18;
        assertEq(vault.getRound(1).payout, expectedPayout);
        assertEq(vault.managedAssets(), 150e18 - expectedPayout);
        assertEq(vault.pickerOwed(picker), expectedPayout);

        vm.prank(picker);
        vault.claimPickerPayout();
        assertEq(stock.balanceOf(picker), expectedPayout);
        vm.prank(picker);
        vm.expectRevert(SpurVault.NothingToClaim.selector);
        vault.claimPickerPayout();

        // Alice memegang 2/3 dari sisa aset.
        assertApproxEqAbs(vault.assetsOf(alice), (150e18 - expectedPayout) * 2 / 3, 2);
        vm.prank(alice);
        vault.requestWithdraw(100e18);
        vm.warp(T2);
        _roll(E2, 100e8);
        // Harga per share dibulatkan ke bawah pada resolusi 1e-18, jadi selisih hingga shares/1e18 wei (selalu merugikan penarik, bukan vault).
        assertApproxEqAbs(vault.pendingWithdrawAssets(alice), (150e18 - expectedPayout) * 2 / 3, 200);
        vm.prank(alice);
        vault.claimWithdraw();
        _conserved();
    }

    function test_lateDepositorOnlyEarnsFromNextRound() public {
        _dep(alice, 100e18);
        vm.warp(T1);
        _roll(E1, 100e8);
        _dep(bob, 100e18); // antre, masuk di roll 2
        assertEq(vault.sharesOf(bob), 0);
        _fill(100e6);
        _settle(E1, 100e8);

        vm.warp(T2);
        _roll(E2, 100e8);
        assertEq(vault.sharesOf(bob), 100e18);
        assertApproxEqAbs(vault.pendingPremium(alice), 100e6, 2, "round 1 penuh untuk Alice");
        assertEq(vault.pendingPremium(bob), 0, "Bob tidak ikut round 1");

        _fill(200e6);
        assertApproxEqAbs(vault.pendingPremium(alice), 200e6, 3, "100 + setengah dari 200");
        assertApproxEqAbs(vault.pendingPremium(bob), 100e6, 3);
        _conserved();
    }

    function test_withdrawRequestStillEarnsCurrentRoundPremium() public {
        _dep(alice, 100e18);
        _dep(bob, 100e18);
        vm.warp(T1);
        _roll(E1, 100e8);
        vm.prank(alice);
        vault.requestWithdraw(100e18); // diminta saat round berjalan
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
        assertEq(stock.balanceOf(alice), 1_000_000e18);
        _conserved();
    }

    function test_unsoldRound_closeUnsoldThenRollAgain() public {
        _dep(alice, 100e18);
        vm.warp(T1);
        _roll(E1, 100e8);
        vm.expectRevert(SpurVault.FillWindowOpen.selector);
        vault.closeUnsold();
        vm.warp(T1 + 6 hours + 1);
        vault.closeUnsold();
        assertFalse(vault.active());
        vm.expectRevert(SpurVault.NotActive.selector);
        vault.settleRound();

        vm.warp(T1 + 7 hours);
        _roll(E1, 100e8);
        assertEq(vault.round(), 2);
        assertTrue(vault.active());
    }

    function test_allWithdrawn_roundSkippedWithoutOracle() public {
        _dep(alice, 100e18);
        _round1(100e6, 100e8);
        vm.prank(alice);
        vault.requestWithdraw(100e18);
        vm.warp(T2); // sengaja tanpa menyegarkan feed: round skipped tidak butuh harga
        vm.prank(keeper);
        vault.rollRound(E2);
        assertFalse(vault.active());
        assertEq(vault.totalShares(), 0);
        vm.prank(alice);
        vault.claimWithdraw();
        assertEq(stock.balanceOf(alice), 1_000_000e18);
        assertApproxEqAbs(vault.pendingPremium(alice), 100e6, 2);
        _conserved();
    }

    // ------------------------------------------------------------------ setoran dan penarikan

    function test_cancelDeposit_instantOnlyBeforeRoll() public {
        _dep(alice, 100e18);
        vm.prank(alice);
        vault.cancelDeposit(40e18);
        assertEq(stock.balanceOf(alice), 1_000_000e18 - 60e18);
        assertEq(vault.pendingDeposits(), 60e18);

        vm.warp(T1);
        _roll(E1, 100e8);
        vm.prank(alice);
        vm.expectRevert(SpurVault.NothingToCancel.selector);
        vault.cancelDeposit(1e18);
        assertEq(vault.sharesOf(alice), 60e18);
    }

    function test_depositAfterRoll_mergesOnlyWithSameRoundReceipt() public {
        _dep(alice, 100e18);
        vm.warp(T1);
        _roll(E1, 100e8);
        _dep(alice, 30e18); // receipt lama dikonversi, yang baru untuk round 2
        _dep(alice, 20e18); // digabung ke receipt round 2
        (uint64 r, uint256 a) = vault.depositOf(alice);
        assertEq(r, 2);
        assertEq(a, 50e18);
        assertEq(vault.sharesOf(alice), 100e18);
        assertEq(vault.pendingDeposits(), 50e18);
    }

    function test_requestWithdraw_needsConvertedShares() public {
        _dep(alice, 100e18);
        vm.prank(alice);
        vm.expectRevert(SpurVault.InsufficientShares.selector);
        vault.requestWithdraw(1e18);

        vm.warp(T1);
        _roll(E1, 100e8);
        vm.startPrank(alice);
        vault.requestWithdraw(60e18);
        vm.expectRevert(SpurVault.InsufficientShares.selector);
        vault.requestWithdraw(41e18); // hanya 40 yang tersisa
        vault.cancelWithdraw(10e18);
        vault.requestWithdraw(50e18);
        vm.stopPrank();
        assertEq(vault.queuedWithdrawShares(), 100e18);
    }

    function test_depositLimits() public {
        vm.prank(alice);
        vm.expectRevert(SpurVault.DepositTooSmall.selector);
        vault.deposit(1e11);

        vm.prank(admin);
        vault.setDepositCap(120e18);
        _dep(alice, 100e18);
        vm.prank(bob);
        vm.expectRevert(SpurVault.DepositCapExceeded.selector);
        vault.deposit(21e18);
        _dep(bob, 20e18);
    }

    function test_donationDoesNotMoveSharePrice() public {
        _dep(alice, 100e18);
        vm.warp(T1);
        _roll(E1, 100e8);
        uint256 pps = vault.pricePerShare();
        stock.mint(address(vault), 1_000_000e18); // donasi langsung
        assertEq(vault.pricePerShare(), pps);
        _dep(bob, 100e18);
        _fill(10e6);
        _settle(E1, 100e8);
        vm.warp(T2);
        _roll(E2, 100e8);
        assertEq(vault.sharesOf(bob), 100e18, "Bob tetap 1:1");
    }

    // ------------------------------------------------------------------ roll dan oracle

    function test_roll_onlyKeeper_onlyIdle_expiryBounds() public {
        _dep(alice, 100e18);
        vm.warp(T1);
        feed.setRound(100e8);
        vm.prank(alice);
        vm.expectRevert();
        vault.rollRound(E1);

        vm.startPrank(keeper);
        vm.expectRevert(SpurVault.InvalidExpiry.selector);
        vault.rollRound(uint64(block.timestamp + 1 hours)); // < 1 hari
        vm.expectRevert(SpurVault.InvalidExpiry.selector);
        vault.rollRound(uint64(block.timestamp + 15 days)); // > 14 hari
        vault.rollRound(E1);
        vm.expectRevert(SpurVault.NotIdle.selector);
        vault.rollRound(E1);
        vm.stopPrank();
    }

    function test_roll_revertsWhenMarketClosedOrPriceStale() public {
        _dep(alice, 100e18);
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
        // Aset dijeda.
        feed.setRound(100e8);
        vm.prank(admin);
        router.pauseAsset(address(stock));
        vm.prank(keeper);
        vm.expectRevert();
        vault.rollRound(E1);
    }

    function test_strikeUsesLivePriceAndOtmBps() public {
        _dep(alice, 100e18);
        vm.prank(admin);
        vault.setOtmBps(2500);
        vm.warp(T1);
        _roll(E1, 200e8);
        (, uint256 k,,,) = _rd();
        assertEq(k, 250e18);
        vm.prank(admin);
        vm.expectRevert(SpurVault.InvalidConfig.selector);
        vault.setOtmBps(99);
        vm.prank(admin);
        vm.expectRevert(SpurVault.InvalidConfig.selector);
        vault.setOtmBps(5001);
    }

    // ------------------------------------------------------------------ auction

    function test_fill_authorizationAndSignature() public {
        _dep(alice, 100e18);
        vm.warp(T1);
        _roll(E1, 100e8);
        HarvestAuction.Quote memory q = _quote(100e6, uint64(block.timestamp + 1 hours));
        bytes memory sig = _sign(q);

        vm.prank(makeAddr("stranger"));
        vm.expectRevert(HarvestAuction.NotAuthorized.selector);
        auction.fill(q, sig);

        // Tanda tangan orang lain.
        (, uint256 otherKey) = makeAddrAndKey("other");
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(otherKey, auction.hashQuote(q));
        vm.prank(keeper);
        vm.expectRevert(HarvestAuction.BadSignature.selector);
        auction.fill(q, abi.encodePacked(r, s, v));

        // Quote diubah setelah ditandatangani.
        HarvestAuction.Quote memory tampered = _quote(1e6, q.deadline); // premium berbeda dari yang ditandatangani
        vm.prank(keeper);
        vm.expectRevert(HarvestAuction.BadSignature.selector);
        auction.fill(tampered, sig);

        // Picker boleh mengisi sendiri.
        vm.prank(picker);
        auction.fill(q, sig);
        assertEq(usdg.balanceOf(address(vault)), 100e6);
        _conserved();
    }

    function test_fill_whitelistDeadlineWrongVault() public {
        _dep(alice, 100e18);
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

        // Vault yang tidak menunjuk auction ini.
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
        _dep(alice, 100e18);
        vm.warp(T1);
        _roll(E1, 100e8);
        HarvestAuction.Quote memory q = _quote(100e6, uint64(block.timestamp + 30 hours));
        bytes memory sig = _sign(q);
        vm.prank(keeper);
        auction.fill(q, sig);

        vm.prank(keeper);
        vm.expectRevert(HarvestAuction.AlreadyFilled.selector);
        auction.fill(q, sig);

        // Quote lain untuk round yang sama ditolak vault.
        HarvestAuction.Quote memory q2 = _quote(120e6, uint64(block.timestamp + 30 days));
        bytes memory sig2 = _sign(q2);
        vm.prank(keeper);
        vm.expectRevert(SpurVault.AlreadySold.selector);
        auction.fill(q2, sig2);

        // Round berikutnya: quote lama tidak berlaku (nomor round dan parameter berbeda).
        _settle(E1, 100e8);
        vm.warp(T2);
        _roll(E2, 100e8);
        vm.prank(keeper);
        vm.expectRevert(SpurVault.RoundMismatch.selector);
        auction.fill(q2, sig2);
    }

    function test_fill_rejectsWrongTermsAndLateFill() public {
        _dep(alice, 100e18);
        vm.warp(T1);
        _roll(E1, 100e8);
        HarvestAuction.Quote memory q = _quote(100e6, uint64(block.timestamp + 20 hours));
        q.strikeE18 += 1; // bukan strike round
        bytes memory badSig = _sign(q);
        vm.prank(keeper);
        vm.expectRevert(SpurVault.RoundMismatch.selector);
        auction.fill(q, badSig);

        q = _quote(100e6, uint64(block.timestamp + 20 hours));
        bytes memory sig = _sign(q);
        vm.warp(T1 + 6 hours + 1);
        vm.prank(keeper);
        vm.expectRevert(SpurVault.FillWindowClosed.selector);
        auction.fill(q, sig);
    }

    function test_recordSale_onlyAuction() public {
        _dep(alice, 100e18);
        vm.warp(T1);
        _roll(E1, 100e8);
        (uint64 e, uint256 k, uint256 n,,) = _rd();
        vm.prank(keeper);
        vm.expectRevert(SpurVault.NotAuction.selector);
        vault.recordSale(picker, 1, k, e, n, 1e6);
    }

    function test_recordSale_requiresPremiumActuallyReceived() public {
        _dep(alice, 100e18);
        vm.warp(T1);
        _roll(E1, 100e8);
        (uint64 e, uint256 k, uint256 n,,) = _rd();
        vm.prank(address(auction));
        vm.expectRevert(SpurVault.PremiumNotReceived.selector);
        vault.recordSale(picker, 1, k, e, n, 5e6); // tidak ada USDG yang dikirim
    }

    function test_minPremiumFloor() public {
        _dep(alice, 100e18);
        vm.prank(admin);
        vault.setMinPremiumBps(100); // 1% dari nilai notional
        vm.warp(T1);
        _roll(E1, 100e8);
        (,,,, uint256 prem) = _rd();
        assertEq(prem, 0);
        assertEq(vault.getRound(1).minPremium, 100e6, "1% x (100 token x $100) = $100");

        HarvestAuction.Quote memory q = _quote(99e6, uint64(block.timestamp + 1 hours));
        bytes memory sig = _sign(q);
        vm.prank(keeper);
        vm.expectRevert(SpurVault.PremiumBelowFloor.selector);
        auction.fill(q, sig);

        _fill(100e6);
        vm.prank(admin);
        vm.expectRevert(SpurVault.InvalidConfig.selector);
        vault.setMinPremiumBps(2001);
    }

    // ------------------------------------------------------------------ settlement

    function test_settleRound_needsExpiryAndOraclePrint() public {
        _dep(alice, 100e18);
        vm.warp(T1);
        _roll(E1, 100e8);
        _fill(100e6);
        vm.expectRevert(SpurVault.NotExpired.selector);
        vault.settleRound();
        vm.warp(E1 + 1 hours);
        vm.expectRevert(SpurVault.SettlementUnavailable.selector);
        vault.settleRound();
        feed.pushRound(100e8, E1 + 5 minutes);
        so.settle(address(stock), E1, feed.roundId());
        vault.settleRound();
        assertFalse(vault.active());
    }

    function test_settleRound_unsoldRoundCannotBeSettled() public {
        _dep(alice, 100e18);
        vm.warp(T1);
        _roll(E1, 100e8);
        vm.warp(E1 + 1 hours);
        vm.expectRevert(SpurVault.NotSold.selector);
        vault.settleRound();
    }

    function test_pickerPayoutCannotBeBlockedByVault() public {
        // Picker diblokir menerima token: settlement tetap selesai, pembayaran menunggu klaim.
        _dep(alice, 100e18);
        _round1(100e6, 150e8);
        assertGt(vault.pickerOwed(picker), 0);
        assertFalse(vault.active());
    }

    // ------------------------------------------------------------------ jeda

    function test_pause_blocksDepositAndRollOnly() public {
        _dep(alice, 100e18);
        vm.prank(guardian);
        vault.pause();
        vm.prank(bob);
        vm.expectRevert(Pausable.EnforcedPause.selector);
        vault.deposit(1e18);
        vm.warp(T1);
        feed.setRound(100e8);
        vm.prank(keeper);
        vm.expectRevert(Pausable.EnforcedPause.selector);
        vault.rollRound(E1);

        // Keluar tetap terbuka.
        vm.prank(alice);
        vault.cancelDeposit(100e18);
        assertEq(stock.balanceOf(alice), 1_000_000e18);

        vm.prank(guardian);
        vm.expectRevert();
        vault.unpause();
        vm.prank(admin);
        vault.unpause();
        _dep(bob, 1e18);
    }

    function test_pause_notForStrangers() public {
        vm.prank(alice);
        vm.expectRevert(SpurVault.NotGuardian.selector);
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
        address a = address(stock);
        vm.expectRevert(SpurVault.ZeroAddress.selector);
        new SpurVault(
            address(0), a, address(usdg), address(router), address(so), address(auction), 6 hours, 1, 1, 1000, 0
        );
        vm.expectRevert(SpurVault.InvalidConfig.selector);
        new SpurVault(
            admin, a, address(usdg), address(router), address(so), address(auction), 30 minutes, 1, 1, 1000, 0
        );
        vm.expectRevert(SpurVault.InvalidConfig.selector);
        new SpurVault(admin, a, address(usdg), address(router), address(so), address(auction), 6 hours, 0, 1, 1000, 0);
        vm.expectRevert(SpurVault.InvalidConfig.selector);
        new SpurVault(admin, a, address(usdg), address(router), address(so), address(auction), 6 hours, 1, 1, 50, 0);
    }

    // ------------------------------------------------------------------ fuzz: kekekalan nilai

    /// Apa pun harga settlement dan ukuran setoran: tidak ada aset atau premium yang tercipta dari udara,
    /// dan setelah semua orang keluar hanya debu pembulatan yang tersisa.
    function testFuzz_valueConservation(uint96 aAmt, uint96 bAmt, uint32 settle8, uint32 premium6) public {
        uint256 a = bound(aAmt, 1e12, 1e24);
        uint256 b = bound(bAmt, 1e12, 1e24);
        int256 p8 = int256(bound(settle8, 1e6, 1e11)); // $0,01 .. $1000
        uint256 prem = bound(premium6, 1, 1e12);
        _dep(alice, a);
        _dep(bob, b);
        _round1(prem, p8);

        // Semua keluar. (Hitung share dulu: panggilan view di dalam argumen akan memakai vm.prank.)
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
        uint256 pOwed = vault.pickerOwed(picker);
        if (pOwed != 0) {
            vm.prank(picker);
            vault.claimPickerPayout();
        }
        uint256 gotPremium;
        if (vault.pendingPremium(alice) != 0) {
            vm.prank(alice);
            vault.claimPremium();
        }
        if (vault.pendingPremium(bob) != 0) {
            vm.prank(bob);
            vault.claimPremium();
        }
        gotPremium = usdg.balanceOf(alice) + usdg.balanceOf(bob);

        uint256 totalIn = a + b;
        uint256 totalOut = (stock.balanceOf(alice) - (1_000_000e18 - a)) + (stock.balanceOf(bob) - (1_000_000e18 - b))
            + stock.balanceOf(picker);
        assertLe(totalOut, totalIn, "tidak boleh keluar lebih dari yang masuk");
        // Debu: harga per share dibulatkan ke 1e-18, jadi hingga ~totalIn/1e18 wei per pemegang tertinggal di vault.
        assertGe(totalOut + totalIn / 1e18 * 2 + 8, totalIn, "selisih hanya debu pembulatan");
        assertLe(gotPremium, prem, "premium tidak boleh lebih dari yang dibayar");
        assertLe(prem - gotPremium, 4, "debu premium");
        _conserved();
    }

    // ------------------------------------------------------------------ fuzz: beberapa round, tiga pemegang

    function _rnd(uint256 seed, uint256 a, uint256 b, uint256 c) internal pure returns (uint256) {
        return uint256(keccak256(abi.encode(seed, a, b, c)));
    }

    /// Tiga pemegang menyetor dan menarik acak selama tiga round dengan harga settlement acak, lalu semua keluar.
    /// Pembukuan harus selalu solven, dan total yang keluar tidak pernah melebihi yang masuk.
    function testFuzz_multiRound_solvencyAndConservation(uint256 seed) public {
        address carol = makeAddr("carol");
        stock.mint(carol, 1_000_000e18);
        vm.prank(carol);
        stock.approve(address(vault), type(uint256).max);
        address[3] memory us = [alice, bob, carol];

        uint256 totalIn;
        uint256 totalPrem;
        uint256[3] memory dep;
        for (uint256 k = 0; k < 3; k++) {
            for (uint256 u = 0; u < 3; u++) {
                if (_rnd(seed, k, u, 0) % 3 != 0) {
                    uint256 amt = 1e12 + _rnd(seed, k, u, 1) % 1e22;
                    _dep(us[u], amt);
                    totalIn += amt;
                    dep[u] += amt;
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
                uint256 prem = 1 + _rnd(seed, k, 9, 5) % 1e9;
                _fill(prem);
                totalPrem += prem;
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

        uint256 stockOut;
        uint256 premOut;
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
            stockOut += stock.balanceOf(who) - (1_000_000e18 - dep[u]);
            premOut += usdg.balanceOf(who);
        }
        if (vault.pickerOwed(picker) != 0) {
            vm.prank(picker);
            vault.claimPickerPayout();
        }
        stockOut += stock.balanceOf(picker);

        assertLe(stockOut, totalIn, "tidak ada aset tercipta");
        assertLe(premOut, totalPrem, "tidak ada premium tercipta");
        _conserved();
    }
}
