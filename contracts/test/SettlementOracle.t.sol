// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {OracleRouter} from "../src/OracleRouter.sol";
import {MarketSession} from "../src/MarketSession.sol";
import {SettlementOracle} from "../src/SettlementOracle.sol";
import {ISettlementOracle} from "../src/interfaces/ISettlementOracle.sol";
import {MockAggregator} from "./mocks/MockAggregator.sol";
import {MockStockToken} from "./mocks/MockStockToken.sol";

/// Settlement print (Fase 2 item 3). Expiry uji = Jumat 2026-10-02 16:00 EDT = 20:00 UTC.
contract SettlementOracleTest is Test {
    uint256 internal constant FRI = 1_790_913_600; // Jumat 00:00 ET
    uint64 internal constant EXPIRY = uint64(FRI + 16 hours);
    uint32 internal constant DELAY = 2 hours;
    uint32 internal constant W_REG = 30 minutes;
    uint32 internal constant W_EXT = 1 hours;

    OracleRouter internal router;
    MarketSession internal market;
    SettlementOracle internal so;
    MockAggregator internal feed; // 8 desimal
    MockAggregator internal seq;
    MockStockToken internal token;
    address internal admin = makeAddr("admin");

    function setUp() public {
        vm.warp(FRI);
        market = new MarketSession(admin);
        seq = new MockAggregator(0);
        seq.setRaw(1, 0, FRI - 30 days, FRI - 30 days, 1);
        router = new OracleRouter(admin, address(seq), 1 hours, address(market));
        token = new MockStockToken();
        feed = new MockAggregator(8);
        vm.prank(admin);
        router.setAssetWindows(address(token), address(feed), W_REG, W_EXT, W_EXT, true);
        so = new SettlementOracle(address(router), DELAY);

        // Riwayat: round 1..3 sebelum expiry, 4 dan 5 sesudah.
        feed.pushRound(100e8, EXPIRY - 3 hours); // 1
        feed.pushRound(101e8, EXPIRY - 2 hours); // 2
        feed.pushRound(102e8, EXPIRY - 10 minutes); // 3  (terakhir sebelum expiry)
        feed.pushRound(103e8, EXPIRY + 5 minutes); // 4  (print)
        feed.pushRound(104e8, EXPIRY + 40 minutes); // 5
        vm.warp(EXPIRY + 1 hours);
    }

    function _get() internal view returns (ISettlementOracle.Settlement memory) {
        return so.settlement(address(token), EXPIRY);
    }

    // ------------------------------------------------------------------ print

    function test_settle_printIsFirstRoundAtOrAfterExpiry() public {
        vm.expectEmit(true, true, false, true, address(so));
        emit ISettlementOracle.Settled(
            address(token), EXPIRY, 4, 103e18, EXPIRY + 5 minutes, ISettlementOracle.Kind.Print
        );
        so.settle(address(token), EXPIRY, 4);
        ISettlementOracle.Settlement memory s = _get();
        assertTrue(s.exists);
        assertEq(s.priceE18, 103e18);
        assertEq(s.roundId, 4);
        assertEq(s.roundUpdatedAt, EXPIRY + 5 minutes);
        assertEq(s.settledAt, block.timestamp);
        assertEq(uint8(s.kind), uint8(ISettlementOracle.Kind.Print));
    }

    function test_settle_anyoneCanSubmit() public {
        vm.prank(makeAddr("random"));
        so.settle(address(token), EXPIRY, 4);
        assertTrue(_get().exists);
    }

    function test_settle_roundUpdatedExactlyAtExpiryIsThePrint() public {
        MockAggregator f = new MockAggregator(8);
        MockStockToken t = new MockStockToken();
        vm.prank(admin);
        router.setAsset(address(t), address(f), 1 hours, false);
        f.pushRound(100e8, EXPIRY - 1);
        f.pushRound(105e8, EXPIRY); // updatedAt == expiry
        f.pushRound(106e8, EXPIRY + 1);
        so.settle(address(t), EXPIRY, 2);
        assertEq(so.settlement(address(t), EXPIRY).priceE18, 105e18);
        // Round 3 bukan print karena round 2 sudah >= expiry.
        MockStockToken t2 = new MockStockToken();
        vm.prank(admin);
        router.setAsset(address(t2), address(f), 1 hours, false);
        vm.expectRevert(SettlementOracle.NotFirstRoundAfterExpiry.selector);
        so.settle(address(t2), EXPIRY, 3);
    }

    function test_settle_rejectsWrongRounds() public {
        vm.expectRevert(SettlementOracle.RoundBeforeExpiry.selector);
        so.settle(address(token), EXPIRY, 3); // terakhir sebelum expiry
        vm.expectRevert(SettlementOracle.NotFirstRoundAfterExpiry.selector);
        so.settle(address(token), EXPIRY, 5); // bukan yang pertama
        vm.expectRevert(SettlementOracle.RoundUnavailable.selector);
        so.settle(address(token), EXPIRY, 99); // tidak ada
        vm.expectRevert(SettlementOracle.RoundUnavailable.selector);
        so.settle(address(token), EXPIRY, 0);
    }

    function test_settle_cannotRepeat() public {
        so.settle(address(token), EXPIRY, 4);
        vm.expectRevert(SettlementOracle.AlreadySettled.selector);
        so.settle(address(token), EXPIRY, 4);
        // Fallback juga tidak bisa menimpa.
        vm.warp(EXPIRY + DELAY + 1);
        vm.expectRevert(SettlementOracle.AlreadySettled.selector);
        so.settleFallback(address(token), EXPIRY, 3);
    }

    function test_settle_notBeforeExpiry() public {
        vm.warp(EXPIRY - 1);
        vm.expectRevert(SettlementOracle.NotExpired.selector);
        so.settle(address(token), EXPIRY, 4);
        vm.expectRevert(SettlementOracle.NotExpired.selector);
        so.settle(address(token), 0, 4);
    }

    function test_settle_atExactExpiryTimestampIfRoundExists() public {
        MockAggregator f = new MockAggregator(8);
        MockStockToken t = new MockStockToken();
        vm.prank(admin);
        router.setAsset(address(t), address(f), 1 hours, false);
        f.pushRound(100e8, EXPIRY - 5);
        vm.warp(EXPIRY);
        f.pushRound(107e8, EXPIRY);
        so.settle(address(t), EXPIRY, 2);
        assertEq(so.settlement(address(t), EXPIRY).priceE18, 107e18);
    }

    function test_settle_printTooLate() public {
        MockAggregator f = new MockAggregator(8);
        MockStockToken t = new MockStockToken();
        vm.prank(admin);
        router.setAsset(address(t), address(f), 1 hours, false);
        f.pushRound(100e8, EXPIRY - 1);
        f.pushRound(110e8, EXPIRY + DELAY); // persis batas: valid
        so.settle(address(t), EXPIRY, 2);

        MockAggregator f2 = new MockAggregator(8);
        MockStockToken t2 = new MockStockToken();
        vm.prank(admin);
        router.setAsset(address(t2), address(f2), 1 hours, false);
        f2.pushRound(100e8, EXPIRY - 1);
        vm.warp(EXPIRY + DELAY + 1);
        f2.pushRound(110e8, EXPIRY + DELAY + 1); // 1 detik lewat batas
        vm.expectRevert(SettlementOracle.PrintTooLate.selector);
        so.settle(address(t2), EXPIRY, 2);
    }

    function test_settle_invalidAnswer() public {
        MockAggregator f = new MockAggregator(8);
        MockStockToken t = new MockStockToken();
        vm.prank(admin);
        router.setAsset(address(t), address(f), 1 hours, false);
        f.pushRound(100e8, EXPIRY - 1);
        f.pushRound(0, EXPIRY + 1);
        vm.expectRevert(SettlementOracle.InvalidAnswer.selector);
        so.settle(address(t), EXPIRY, 2);
        f.pushRound(-5, EXPIRY + 2);
        vm.expectRevert(SettlementOracle.InvalidAnswer.selector);
        so.settle(address(t), EXPIRY, 3);
    }

    function test_settle_answeredInRoundBehindIsInvalid() public {
        MockAggregator f = new MockAggregator(8);
        MockStockToken t = new MockStockToken();
        vm.prank(admin);
        router.setAsset(address(t), address(f), 1 hours, false);
        f.pushRound(100e8, EXPIRY - 1);
        f.setRaw(2, 105e8, EXPIRY + 1, EXPIRY + 1, 1);
        vm.expectRevert(SettlementOracle.InvalidRound.selector);
        so.settle(address(t), EXPIRY, 2);
    }

    function test_settle_phaseBoundaryIsRejected() public {
        MockAggregator f = new MockAggregator(8);
        MockStockToken t = new MockStockToken();
        vm.prank(admin);
        router.setAsset(address(t), address(f), 1 hours, false);
        uint80 first = (uint80(2) << 64) | 1; // round pertama fase 2
        f.setRaw((uint80(1) << 64) | 77, 100e8, EXPIRY - 1, EXPIRY - 1, (uint80(1) << 64) | 77);
        f.setRaw(first, 105e8, EXPIRY + 1, EXPIRY + 1, first);
        vm.expectRevert(SettlementOracle.PhaseBoundary.selector);
        so.settle(address(t), EXPIRY, first);
    }

    function test_settle_phaseIdsWorkInsideAPhase() public {
        MockAggregator f = new MockAggregator(8);
        MockStockToken t = new MockStockToken();
        vm.prank(admin);
        router.setAsset(address(t), address(f), 1 hours, false);
        uint80 base = uint80(3) << 64;
        f.setRaw(base | 10, 100e8, EXPIRY - 1, EXPIRY - 1, base | 10);
        f.setRaw(base | 11, 105e8, EXPIRY + 1, EXPIRY + 1, base | 11);
        so.settle(address(t), EXPIRY, base | 11);
        assertEq(so.settlement(address(t), EXPIRY).roundId, base | 11);
    }

    function test_settle_scalesDecimals() public {
        MockAggregator f = new MockAggregator(6);
        MockStockToken t = new MockStockToken();
        vm.prank(admin);
        router.setAsset(address(t), address(f), 1 hours, false);
        f.pushRound(100e6, EXPIRY - 1);
        f.pushRound(123_456_789, EXPIRY + 1); // 123.456789
        so.settle(address(t), EXPIRY, 2);
        assertEq(so.settlement(address(t), EXPIRY).priceE18, 123_456_789e12);
    }

    function test_settle_unknownAsset() public {
        vm.expectRevert(SettlementOracle.UnknownAsset.selector);
        so.settle(makeAddr("nope"), EXPIRY, 4);
    }

    function test_settle_deferredWhileOraclePaused() public {
        token.setPaused(true);
        vm.expectRevert(SettlementOracle.OraclePaused.selector);
        so.settle(address(token), EXPIRY, 4);
        token.setPaused(false);
        so.settle(address(token), EXPIRY, 4); // sukses setelah aktif lagi
        assertTrue(_get().exists);
    }

    function test_settle_pauseFlagReadFailureIsFailClosed() public {
        token.setFailPausedCall(true);
        vm.expectRevert(SettlementOracle.OraclePaused.selector);
        so.settle(address(token), EXPIRY, 4);
    }

    function test_settle_tokenWithPauseCheckOffIgnoresFlag() public {
        MockStockToken t = new MockStockToken();
        vm.prank(admin);
        router.setAsset(address(t), address(feed), 1 hours, false);
        t.setPaused(true);
        so.settle(address(t), EXPIRY, 4);
        assertTrue(so.settlement(address(t), EXPIRY).exists);
    }

    function test_settle_separateExpiriesAreIndependent() public {
        so.settle(address(token), EXPIRY, 4);
        uint64 e2 = EXPIRY + 7 days;
        vm.warp(e2 + 1 hours);
        feed.pushRound(110e8, e2 - 5 minutes); // 6
        feed.pushRound(111e8, e2 + 3 minutes); // 7
        so.settle(address(token), e2, 7);
        assertEq(so.settlement(address(token), e2).priceE18, 111e18);
        assertEq(so.settlement(address(token), EXPIRY).priceE18, 103e18);
    }

    // --------------------------------------------------------------- fallback

    function _noPrintFeed() internal returns (MockAggregator f, MockStockToken t) {
        f = new MockAggregator(8);
        t = new MockStockToken();
        vm.prank(admin);
        router.setAssetWindows(address(t), address(f), W_REG, W_EXT, W_EXT, false);
    }

    function test_fallback_usesLastRoundBeforeExpiryWhenNoPrintAndFresh() public {
        (MockAggregator f, MockStockToken t) = _noPrintFeed();
        f.pushRound(100e8, EXPIRY - 3 hours);
        f.pushRound(102e8, EXPIRY - 10 minutes); // segar saat expiry (regular 30 menit)
        vm.warp(EXPIRY + DELAY); // jendela print baru tutup saat > expiry + delay
        vm.expectRevert(SettlementOracle.PrintWindowOpen.selector);
        so.settleFallback(address(t), EXPIRY, 2);
        vm.warp(EXPIRY + DELAY + 1);
        vm.expectEmit(true, true, false, true, address(so));
        emit ISettlementOracle.Settled(
            address(t), EXPIRY, 2, 102e18, EXPIRY - 10 minutes, ISettlementOracle.Kind.LastBeforeExpiry
        );
        so.settleFallback(address(t), EXPIRY, 2);
        ISettlementOracle.Settlement memory s = so.settlement(address(t), EXPIRY);
        assertEq(s.priceE18, 102e18);
        assertEq(uint8(s.kind), uint8(ISettlementOracle.Kind.LastBeforeExpiry));
    }

    function test_fallback_rejectedWhenPrintExistsInWindow() public {
        vm.warp(EXPIRY + DELAY + 1);
        // Feed utama punya round 4 pada expiry + 5 menit (print valid).
        vm.expectRevert(SettlementOracle.PrintExists.selector);
        so.settleFallback(address(token), EXPIRY, 3);
    }

    function test_fallback_allowedWhenNextRoundIsAfterWindow() public {
        (MockAggregator f, MockStockToken t) = _noPrintFeed();
        f.pushRound(100e8, EXPIRY - 10 minutes);
        vm.warp(EXPIRY + DELAY + 30 minutes);
        f.pushRound(120e8, EXPIRY + DELAY + 10 minutes); // round berikutnya terlalu telat jadi print
        vm.expectRevert(SettlementOracle.PrintTooLate.selector);
        so.settle(address(t), EXPIRY, 2);
        so.settleFallback(address(t), EXPIRY, 1);
        assertEq(so.settlement(address(t), EXPIRY).priceE18, 100e18);
    }

    function test_fallback_boundaryNextRoundExactlyAtWindowEndIsPrint() public {
        (MockAggregator f, MockStockToken t) = _noPrintFeed();
        f.pushRound(100e8, EXPIRY - 10 minutes);
        f.pushRound(120e8, EXPIRY + DELAY); // persis batas: masih print yang sah
        vm.warp(EXPIRY + DELAY + 1);
        vm.expectRevert(SettlementOracle.PrintExists.selector);
        so.settleFallback(address(t), EXPIRY, 1);
        so.settle(address(t), EXPIRY, 2);
    }

    function test_fallback_rejectsRoundNotLastBeforeExpiry() public {
        (MockAggregator f, MockStockToken t) = _noPrintFeed();
        f.pushRound(100e8, EXPIRY - 20 minutes); // 1
        f.pushRound(102e8, EXPIRY - 10 minutes); // 2
        vm.warp(EXPIRY + DELAY + 1);
        // Round 1 bukan yang terakhir: round 2 masih sebelum expiry.
        vm.expectRevert(SettlementOracle.NotLastRoundBeforeExpiry.selector);
        so.settleFallback(address(t), EXPIRY, 1);
        so.settleFallback(address(t), EXPIRY, 2);
    }

    function test_fallback_rejectsRoundAtOrAfterExpiry() public {
        (MockAggregator f, MockStockToken t) = _noPrintFeed();
        f.pushRound(100e8, EXPIRY);
        vm.warp(EXPIRY + DELAY + 1);
        vm.expectRevert(SettlementOracle.RoundNotBeforeExpiry.selector);
        so.settleFallback(address(t), EXPIRY, 1);
    }

    function test_fallback_rejectsStaleHeldPrice() public {
        (MockAggregator f, MockStockToken t) = _noPrintFeed();
        // Sesi tepat sebelum expiry = Regular (jendela 30 menit). Round 31 menit sebelum expiry: terlalu tua.
        f.pushRound(100e8, EXPIRY - 1 - 30 minutes - 1);
        vm.warp(EXPIRY + DELAY + 1);
        vm.expectRevert(SettlementOracle.StalePrice.selector);
        so.settleFallback(address(t), EXPIRY, 1);

        // Persis di batas jendela (diukur dari expiry - 1): valid.
        (MockAggregator f2, MockStockToken t2) = _noPrintFeed();
        f2.pushRound(100e8, EXPIRY - 1 - 30 minutes);
        so.settleFallback(address(t2), EXPIRY, 1);
        assertTrue(so.settlement(address(t2), EXPIRY).exists);
    }

    function test_fallback_expiryDuringClosedSessionUsesFreshnessAtClose() public {
        // Expiry Sabtu 12:00 ET (Closed). Harga terakhir Jumat 19:30 segar saat tutup 20:00 (jendela extended 1 jam).
        uint64 e = uint64(FRI + 1 days + 12 hours);
        (MockAggregator f, MockStockToken t) = _noPrintFeed();
        f.pushRound(100e8, FRI + 19 hours + 30 minutes);
        vm.warp(e + DELAY + 1);
        so.settleFallback(address(t), e, 1);
        assertEq(so.settlement(address(t), e).priceE18, 100e18);

        // Harga Jumat 18:30 (90 menit sebelum tutup) tidak segar.
        (MockAggregator f2, MockStockToken t2) = _noPrintFeed();
        f2.pushRound(100e8, FRI + 18 hours + 30 minutes);
        vm.expectRevert(SettlementOracle.StalePrice.selector);
        so.settleFallback(address(t2), e, 1);
    }

    function test_fallback_deferredWhileOraclePaused() public {
        (MockAggregator f, MockStockToken t) = _noPrintFeed();
        vm.prank(admin);
        router.setAssetWindows(address(t), address(f), W_REG, W_EXT, W_EXT, true);
        f.pushRound(100e8, EXPIRY - 10 minutes);
        vm.warp(EXPIRY + DELAY + 1);
        t.setPaused(true);
        vm.expectRevert(SettlementOracle.OraclePaused.selector);
        so.settleFallback(address(t), EXPIRY, 1);
    }

    function test_fallback_unavailableRounds() public {
        (MockAggregator f, MockStockToken t) = _noPrintFeed();
        f.pushRound(100e8, EXPIRY - 10 minutes);
        vm.warp(EXPIRY + DELAY + 1);
        vm.expectRevert(SettlementOracle.RoundUnavailable.selector);
        so.settleFallback(address(t), EXPIRY, 9);
        f.setFailLatest(true);
        vm.expectRevert(SettlementOracle.FeedCallFailed.selector);
        so.settleFallback(address(t), EXPIRY, 1);
    }

    // ------------------------------------------------------------ konstruktor

    function test_constructor_validation() public {
        vm.expectRevert(SettlementOracle.InvalidConfig.selector);
        new SettlementOracle(address(0), DELAY);
        vm.expectRevert(SettlementOracle.InvalidConfig.selector);
        new SettlementOracle(makeAddr("eoa"), DELAY);
        vm.expectRevert(SettlementOracle.InvalidConfig.selector);
        new SettlementOracle(address(router), 0);
        uint32 tooLong = so.MAX_PRINT_DELAY_LIMIT() + 1;
        vm.expectRevert(SettlementOracle.InvalidConfig.selector);
        new SettlementOracle(address(router), tooLong);
        assertEq(address(so.ROUTER()), address(router));
        assertEq(so.MAX_PRINT_DELAY(), DELAY);
    }

    // ------------------------------------------------------------------ fuzz

    /// Untuk riwayat acak dengan updatedAt naik, tepat satu roundId lolos `settle` sebagai print, dan itu round
    /// pertama dengan updatedAt >= expiry (bila ada dalam batas). Tidak ada id lain (di dalam atau di luar riwayat) yang lolos.
    function testFuzz_onlyTheFirstRoundAtOrAfterExpiryCanBePrint(uint8 nSeed, uint256 seed) public {
        uint256 n = bound(nSeed, 2, 12);
        MockAggregator f = new MockAggregator(8);
        MockStockToken t = new MockStockToken();
        vm.prank(admin);
        router.setAsset(address(t), address(f), 1 hours, false);

        uint256 ts = EXPIRY - 6 hours;
        uint256 expected; // roundId print yang diharapkan; 0 = tidak ada yang sah
        for (uint256 i = 1; i <= n; i++) {
            seed = uint256(keccak256(abi.encode(seed, i)));
            ts += seed % 90 minutes; // boleh sama (selisih 0): updatedAt non-menurun
            f.pushRound(int256(100e8 + int256(i)), ts == 0 ? 1 : ts);
            if (expected == 0 && ts >= EXPIRY && ts - EXPIRY <= DELAY) expected = i;
            // Round pertama >= expiry yang terlalu telat berarti tidak ada print yang sah, tapi round
            // setelahnya juga tidak sah karena round sebelumnya (yang telat) sudah >= expiry.
            if (expected == 0 && ts >= EXPIRY) expected = type(uint256).max;
        }
        if (expected == type(uint256).max) expected = 0;
        vm.warp(ts > EXPIRY ? ts + 1 : uint256(EXPIRY) + 1);

        uint256 snap = vm.snapshotState();
        uint256 successes;
        for (uint80 id = 0; id <= n + 2; id++) {
            try so.settle(address(t), EXPIRY, id) {
                successes++;
                assertEq(id, expected, "hanya round pertama >= expiry yang sah");
                assertEq(so.settlement(address(t), EXPIRY).priceE18, (100e8 + id) * 1e10);
            } catch {}
            vm.revertToState(snap);
            snap = vm.snapshotState();
        }
        assertEq(successes, expected == 0 ? 0 : 1);
    }

    // ------------------------------------------------- jeda aset (item 5)

    function _guardianPauses() internal {
        address g = makeAddr("guardian");
        bytes32 role = router.GUARDIAN_ROLE();
        vm.prank(admin);
        router.grantRole(role, g);
        vm.prank(g);
        router.pauseAsset(address(token));
    }

    function test_settle_delayedWhileAssetPausedThenStillValidAfterUnpause() public {
        _guardianPauses();
        vm.expectRevert(SettlementOracle.AssetPaused.selector);
        so.settle(address(token), EXPIRY, 4);
        vm.expectRevert(SettlementOracle.AssetPaused.selector);
        so.settleFallback(address(token), EXPIRY, 3);

        // Jeda lama (lewat jendela print): settlement tidak terkunci, karena dinilai dari waktu feed.
        vm.warp(EXPIRY + DELAY + 1 days);
        vm.expectRevert(SettlementOracle.AssetPaused.selector);
        so.settle(address(token), EXPIRY, 4);

        vm.prank(admin);
        router.unpauseAsset(address(token));
        so.settle(address(token), EXPIRY, 4);
        assertEq(_get().priceE18, 103e18);
        assertEq(uint8(_get().kind), uint8(ISettlementOracle.Kind.Print));
    }

    function test_settle_otherAssetsUnaffectedByPause() public {
        _guardianPauses();
        MockAggregator f = new MockAggregator(8);
        MockStockToken t = new MockStockToken();
        vm.prank(admin);
        router.setAsset(address(t), address(f), 1 hours, false);
        f.pushRound(100e8, EXPIRY - 1);
        f.pushRound(105e8, EXPIRY + 1);
        so.settle(address(t), EXPIRY, 2);
        assertEq(so.settlement(address(t), EXPIRY).priceE18, 105e18);
    }
}
