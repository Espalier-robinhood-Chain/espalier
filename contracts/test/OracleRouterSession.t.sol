// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {IAccessControl} from "@openzeppelin/contracts/access/IAccessControl.sol";
import {OracleRouter} from "../src/OracleRouter.sol";
import {MarketSession} from "../src/MarketSession.sol";
import {IOracleRouter} from "../src/interfaces/IOracleRouter.sol";
import {IMarketSession} from "../src/interfaces/IMarketSession.sol";
import {MockAggregator} from "./mocks/MockAggregator.sol";
import {MockStockToken} from "./mocks/MockStockToken.sol";

/// Staleness sadar sesi pasar (Fase 2 item 3). Titik acuan: Jumat 2026-10-02 00:00 EDT (04:00 UTC).
contract OracleRouterSessionTest is Test {
    uint256 internal constant FRI = 1_790_913_600; // Jumat 00:00 ET
    uint256 internal constant MON = FRI + 3 days; // Senin 00:00 ET

    uint32 internal constant W_REG = 15 minutes;
    uint32 internal constant W_EXT = 1 hours;
    uint32 internal constant W_NIGHT = 6 hours;

    OracleRouter internal router;
    MarketSession internal market;
    MockAggregator internal feed;
    MockAggregator internal seq;
    MockStockToken internal token;

    address internal admin = makeAddr("admin");

    IOracleRouter.Status internal constant OK = IOracleRouter.Status.Ok;
    IOracleRouter.Status internal constant STALE = IOracleRouter.Status.Stale;
    IOracleRouter.Status internal constant CLOSED_ST = IOracleRouter.Status.MarketClosed;

    function setUp() public {
        vm.warp(FRI);
        market = new MarketSession(admin);
        seq = new MockAggregator(0);
        seq.setRaw(1, 0, FRI - 30 days, FRI - 30 days, 1);
        router = new OracleRouter(admin, address(seq), 1 hours, address(market));
        token = new MockStockToken();
        feed = new MockAggregator(8);
        vm.prank(admin);
        router.setAssetWindows(address(token), address(feed), W_REG, W_EXT, W_NIGHT, true);
    }

    // ------------------------------------------------------------ helpers

    /// Pindah ke `at` lalu catat harga feed dengan umur `age` detik.
    function _at(uint256 at, uint256 age) internal {
        vm.warp(at);
        feed.pushRound(250e8, at - age);
    }

    function _live() internal view returns (IOracleRouter.Status s) {
        (s,,) = router.tryGetPrice(address(token));
    }

    function _ref() internal view returns (IOracleRouter.Status s, IMarketSession.Session sess) {
        (s,,, sess) = router.tryGetReferencePrice(address(token));
    }

    // --------------------------------------------------- jendela per sesi

    function test_regularWindow_isTight() public {
        _at(FRI + 12 hours, W_REG);
        assertEq(uint8(_live()), uint8(OK), "umur = jendela: valid");
        _at(FRI + 12 hours + 1, W_REG + 1);
        assertEq(uint8(_live()), uint8(STALE), "lewat 1 detik: stale");
    }

    function test_extendedWindow_afterHours() public {
        _at(FRI + 17 hours, W_EXT);
        assertEq(uint8(_live()), uint8(OK));
        _at(FRI + 17 hours + 1, W_EXT + 1);
        assertEq(uint8(_live()), uint8(STALE));
        // Umur yang lolos di extended tetapi tidak di regular.
        _at(FRI + 17 hours + 2, 30 minutes);
        assertEq(uint8(_live()), uint8(OK));
    }

    function test_overnightWindow_isLoose() public {
        _at(FRI + 2 hours, W_NIGHT); // Jumat 02:00, overnight
        assertEq(uint8(_live()), uint8(OK));
        _at(FRI + 2 hours + 1, W_NIGHT + 1);
        assertEq(uint8(_live()), uint8(STALE));
        // Umur 30 menit: terlalu tua di regular, aman di overnight.
        _at(FRI + 3 hours, 30 minutes);
        assertEq(uint8(_live()), uint8(OK));
        _at(FRI + 12 hours, 30 minutes);
        assertEq(uint8(_live()), uint8(STALE), "umur sama ditolak saat regular");
    }

    function test_setAsset_fourArgSetsAllThreeWindowsEqual() public {
        MockStockToken t2 = new MockStockToken();
        vm.prank(admin);
        router.setAsset(address(t2), address(feed), 42 minutes, false);
        OracleRouter.Asset memory a = router.assetConfig(address(t2));
        assertEq(a.stalenessRegular, 42 minutes);
        assertEq(a.stalenessExtended, 42 minutes);
        assertEq(a.stalenessOvernight, 42 minutes);
    }

    // ------------------------------------------------------------ live: Closed

    function test_live_closedIsRejected_evenWhenFresh() public {
        _at(FRI + 24 hours + 12 hours, 0); // Sabtu 12:00, harga baru saja ditulis
        assertEq(uint8(_live()), uint8(CLOSED_ST));
        vm.expectRevert(abi.encodeWithSelector(IOracleRouter.PriceUnavailable.selector, CLOSED_ST));
        router.getPrice(address(token));
    }

    function test_live_firstSecondOfSundayOpenNeedsFreshUpdate() public {
        // Harga ditahan sejak Jumat 19:50; Minggu 20:00 sesi dibuka lagi, tetapi harga pra-pembukaan tidak dianggap segar.
        uint256 sunOpen = MON - 4 hours;
        vm.warp(FRI + 19 hours + 50 minutes);
        feed.setRound(250e8);
        vm.warp(sunOpen);
        assertEq(uint8(_live()), uint8(STALE), "konservatif terhadap gap pembukaan");
        feed.setRound(251e8); // update pertama setelah buka
        (uint256 p,) = router.getPrice(address(token));
        assertEq(p, 251e18);
    }

    // ------------------------------------------------- referensi: saat Closed

    function test_reference_closedAcceptsPriceFreshAtClose() public {
        uint256 close = FRI + 20 hours;
        vm.warp(close - 30 minutes);
        feed.setRound(250e8); // umur 30 menit saat tutup (jendela extended 1 jam)
        vm.warp(FRI + 1 days + 12 hours); // Sabtu 12:00
        (IOracleRouter.Status s, IMarketSession.Session sess) = _ref();
        assertEq(uint8(s), uint8(OK));
        assertEq(uint8(sess), uint8(IMarketSession.Session.Closed));
        (uint256 p, uint256 u, IMarketSession.Session sess2) = router.getReferencePrice(address(token));
        assertEq(p, 250e18);
        assertEq(u, close - 30 minutes);
        assertEq(uint8(sess2), uint8(IMarketSession.Session.Closed));
        // Harga live tetap ditolak.
        assertEq(uint8(_live()), uint8(CLOSED_ST));
    }

    function test_reference_closedBoundaryAtWindowOfLastSession() public {
        uint256 close = FRI + 20 hours;
        // Sesi terakhir sebelum tutup = Extended (jendela 1 jam). Umur persis 1 jam saat tutup: valid.
        vm.warp(close - W_EXT);
        feed.setRound(250e8);
        vm.warp(FRI + 1 days + 12 hours);
        (IOracleRouter.Status s,) = _ref();
        assertEq(uint8(s), uint8(OK), "persis jendela");

        // 1 detik lebih tua: stale, walaupun sedang Closed.
        feed.setRaw(feed.roundId() + 1, 250e8, close - W_EXT - 1, close - W_EXT - 1, feed.roundId() + 1);
        (s,) = _ref();
        assertEq(uint8(s), uint8(STALE));
    }

    function test_reference_updateDuringClosedCountsAsFresh() public {
        vm.warp(FRI + 1 days + 12 hours);
        feed.setRound(250e8); // feed memperbarui saat Closed (mis. ditahan ulang)
        (IOracleRouter.Status s,) = _ref();
        assertEq(uint8(s), uint8(OK));
    }

    function test_reference_longWeekendUsesLastCloseNotWallClock() public {
        vm.prank(admin);
        market.setHoliday(2026, 10, 5, true); // Senin libur
        vm.warp(FRI + 19 hours);
        feed.setRound(250e8); // umur 1 jam saat Jumat 20:00 tutup
        // Selasa 03:00: 3 hari lebih setelah update, tetapi masih Closed dan segar saat tutup.
        vm.warp(MON + 1 days + 3 hours);
        (IOracleRouter.Status s, IMarketSession.Session sess) = _ref();
        assertEq(uint8(s), uint8(OK));
        assertEq(uint8(sess), uint8(IMarketSession.Session.Closed));
        // Selasa 04:00 sesi extended: harga lama tidak segar lagi sampai ada update.
        vm.warp(MON + 1 days + 4 hours);
        (s, sess) = _ref();
        assertEq(uint8(s), uint8(STALE));
        assertEq(uint8(sess), uint8(IMarketSession.Session.Extended));
    }

    function test_reference_untrackedClosedPeriodIsStale() public {
        vm.startPrank(admin);
        for (uint8 d = 5; d <= 31; d++) {
            market.setHoliday(2026, 10, d, true);
        }
        vm.stopPrank();
        vm.warp(MON + 20 days + 12 hours);
        feed.setRound(250e8); // bahkan harga yang baru ditulis: periode tutup tidak terlacak -> fail-closed
        (IOracleRouter.Status s,) = _ref();
        assertEq(uint8(s), uint8(STALE));
    }

    function test_reference_openSessionBehavesLikeLive() public {
        _at(FRI + 12 hours, W_REG);
        (IOracleRouter.Status s, IMarketSession.Session sess) = _ref();
        assertEq(uint8(s), uint8(OK));
        assertEq(uint8(sess), uint8(IMarketSession.Session.Regular));
        _at(FRI + 12 hours + 1, W_REG + 1);
        (s,) = _ref();
        assertEq(uint8(s), uint8(STALE));
    }

    // ------------------------------------------------ urutan pemeriksaan

    function test_sequencerDownBeatsClosed() public {
        vm.warp(FRI + 1 days + 12 hours);
        feed.setRound(250e8);
        seq.setRaw(2, 1, block.timestamp - 1 days, block.timestamp - 1 days, 2);
        assertEq(uint8(_live()), uint8(IOracleRouter.Status.SequencerDown));
        (IOracleRouter.Status s,) = _ref();
        assertEq(uint8(s), uint8(IOracleRouter.Status.SequencerDown));
    }

    function test_pauseAppliesToReferenceButLiveSaysClosedFirst() public {
        vm.warp(FRI + 19 hours);
        feed.setRound(250e8);
        vm.warp(FRI + 1 days + 12 hours);
        token.setPaused(true);
        assertEq(uint8(_live()), uint8(CLOSED_ST), "live: pasar tutup dicek lebih dulu");
        (IOracleRouter.Status s,) = _ref();
        assertEq(uint8(s), uint8(IOracleRouter.Status.OraclePaused), "acuan: pause tetap dihormati");
    }

    function test_stalenessStillGuardsWhenPauseFlagFalseInClosedSession() public {
        // Flag pause advisory: harga lama saat tutup tetap ditolak walau flag false.
        vm.warp(FRI + 15 hours);
        feed.setRound(250e8); // 5 jam sebelum tutup, jauh di atas jendela
        vm.warp(FRI + 1 days + 12 hours);
        (IOracleRouter.Status s,) = _ref();
        assertEq(uint8(s), uint8(STALE));
    }

    function test_unknownAssetStillReported() public {
        (IOracleRouter.Status s,,,) = router.tryGetReferencePrice(makeAddr("nope"));
        assertEq(uint8(s), uint8(IOracleRouter.Status.UnknownAsset));
    }

    // ------------------------------------------------------------ views admin

    function test_freshnessReference_view() public {
        (uint256 ref, uint32 w, IMarketSession.Session s) = router.freshnessReference(address(token), FRI + 12 hours);
        assertEq(ref, FRI + 12 hours);
        assertEq(w, W_REG);
        assertEq(uint8(s), uint8(IMarketSession.Session.Regular));

        (ref, w, s) = router.freshnessReference(address(token), FRI + 1 days + 12 hours);
        assertEq(ref, FRI + 20 hours, "awal periode tutup");
        assertEq(w, W_EXT, "jendela sesi terakhir sebelum tutup");
        assertEq(uint8(s), uint8(IMarketSession.Session.Closed));

        (ref, w, s) = router.freshnessReference(address(token), FRI + 2 hours);
        assertEq(w, W_NIGHT);
        assertEq(uint8(s), uint8(IMarketSession.Session.Overnight));

        (address f, bool check) = router.feedOf(address(token));
        assertEq(f, address(feed));
        assertTrue(check);
        (f, check) = router.feedOf(makeAddr("nope"));
        assertEq(f, address(0));
        assertFalse(check);
    }

    function test_setAssetWindows_validationAndAuth() public {
        vm.startPrank(admin);
        vm.expectRevert(OracleRouter.InvalidMaxStaleness.selector);
        router.setAssetWindows(address(token), address(feed), 0, W_EXT, W_NIGHT, true);
        vm.expectRevert(OracleRouter.InvalidMaxStaleness.selector);
        router.setAssetWindows(address(token), address(feed), W_REG, 0, W_NIGHT, true);
        vm.expectRevert(OracleRouter.InvalidMaxStaleness.selector);
        router.setAssetWindows(address(token), address(feed), W_REG, W_EXT, 0, true);
        uint32 tooLong = router.MAX_STALENESS_LIMIT() + 1;
        vm.expectRevert(OracleRouter.InvalidMaxStaleness.selector);
        router.setAssetWindows(address(token), address(feed), W_REG, W_EXT, tooLong, true);
        vm.stopPrank();

        vm.expectRevert(
            abi.encodeWithSelector(
                IAccessControl.AccessControlUnauthorizedAccount.selector, address(this), router.DEFAULT_ADMIN_ROLE()
            )
        );
        router.setAssetWindows(address(token), address(feed), W_REG, W_EXT, W_NIGHT, true);
    }

    function test_setAssetWindows_emitsEvent() public {
        vm.expectEmit(true, true, false, true, address(router));
        emit OracleRouter.AssetConfigured(address(token), address(feed), 1, 2, 3, false);
        vm.prank(admin);
        router.setAssetWindows(address(token), address(feed), 1, 2, 3, false);
    }

    function test_constructor_requiresMarketSession() public {
        vm.expectRevert(OracleRouter.ZeroAddress.selector);
        new OracleRouter(admin, address(seq), 1 hours, address(0));
        vm.expectRevert(OracleRouter.InvalidMarketSession.selector);
        new OracleRouter(admin, address(seq), 1 hours, makeAddr("eoa"));
        assertEq(address(router.marketSession()), address(market));
    }

    // ------------------------------------------------------------------ fuzz

    /// Spesifikasi dalam bentuk primitif kalender: sesi terbuka -> umur <= jendela sesi; Closed -> kesegaran dinilai
    /// pada awal periode tutup. Router harus sama persis untuk waktu dan umur acak.
    function testFuzz_referenceMatchesSpec(uint256 offset, uint256 age) public {
        offset = bound(offset, 0, 40 days);
        uint256 now_ = FRI + offset;
        age = bound(age, 0, 3 days);
        vm.warp(now_);
        feed.pushRound(250e8, now_ - age);
        seq.setRaw(2, 0, FRI - 30 days, FRI - 30 days, 2);

        (IOracleRouter.Status s,,, IMarketSession.Session sess) = router.tryGetReferencePrice(address(token));
        IMarketSession.Session expectSess = market.sessionAt(now_);
        assertEq(uint8(sess), uint8(expectSess));

        bool fresh;
        if (expectSess != IMarketSession.Session.Closed) {
            fresh = age <= _w(expectSess);
        } else {
            uint256 ref = market.lastOpenEnd(now_);
            fresh = ref != 0 && (ref <= now_ - age || ref - (now_ - age) <= _w(market.sessionAt(ref - 1)));
        }
        assertEq(uint8(s), fresh ? uint8(OK) : uint8(STALE));

        // Live: nilai sama saat sesi terbuka; MarketClosed saat Closed.
        (IOracleRouter.Status live,,) = router.tryGetPrice(address(token));
        if (expectSess == IMarketSession.Session.Closed) assertEq(uint8(live), uint8(CLOSED_ST));
        else assertEq(uint8(live), uint8(s));
    }

    function _w(IMarketSession.Session s) internal pure returns (uint32) {
        if (s == IMarketSession.Session.Regular) return W_REG;
        if (s == IMarketSession.Session.Extended) return W_EXT;
        return W_NIGHT;
    }

    function testFuzz_liveOkImpliesSessionOpenAndFreshWindow(uint256 offset, uint256 age) public {
        offset = bound(offset, 0, 40 days);
        age = bound(age, 0, 3 days);
        vm.warp(FRI + offset);
        feed.pushRound(250e8, FRI + offset - age);
        (IOracleRouter.Status s,,) = router.tryGetPrice(address(token));
        if (s == OK) {
            IMarketSession.Session sess = market.sessionAt(block.timestamp);
            assertTrue(sess != IMarketSession.Session.Closed);
            assertLe(age, _w(sess));
        }
    }
}
