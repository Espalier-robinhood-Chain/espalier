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

contract OracleRouterTest is Test {
    uint256 internal constant T0 = 1_800_000_000;
    uint256 internal constant GRACE = 1 hours;
    uint32 internal constant MAX_STALE = 1 hours;

    OracleRouter internal router;
    MockAggregator internal feed; // 8 desimal
    MockAggregator internal seq;
    MockStockToken internal token;
    MarketSession internal market;

    address internal admin = makeAddr("admin");
    address internal stranger = makeAddr("stranger");

    function setUp() public {
        vm.warp(T0);

        seq = new MockAggregator(0);
        seq.setRaw(1, 0, T0 - 2 hours, T0 - 2 hours, 1); // up sejak 2 jam lalu

        market = new MarketSession(admin);
        router = new OracleRouter(admin, address(seq), GRACE, address(market));

        token = new MockStockToken();
        feed = new MockAggregator(8);
        feed.setRound(250e8); // 250.00 USD

        vm.prank(admin);
        router.setAsset(address(token), address(feed), MAX_STALE, true);
    }

    // ------------------------------------------------------------ helpers

    function _expectUnavailable(IOracleRouter.Status s) internal {
        vm.expectRevert(abi.encodeWithSelector(IOracleRouter.PriceUnavailable.selector, s));
    }

    function _status(address t) internal view returns (IOracleRouter.Status s) {
        (s,,) = router.tryGetPrice(t);
    }

    // ------------------------------------------------------- jalur normal

    function test_getPrice_scalesTo18Decimals() public view {
        (uint256 p, uint256 updatedAt) = router.getPrice(address(token));
        assertEq(p, 250e18);
        assertEq(updatedAt, T0);
    }

    function test_tryGetPrice_okMatchesGetPrice() public view {
        (IOracleRouter.Status s, uint256 p, uint256 u) = router.tryGetPrice(address(token));
        assertEq(uint8(s), uint8(IOracleRouter.Status.Ok));
        assertEq(p, 250e18);
        assertEq(u, T0);
    }

    function test_decimalsAreReadFromFeed_6_8_18_20() public {
        uint8[4] memory ds = [uint8(6), 8, 18, 20];
        for (uint256 i; i < ds.length; i++) {
            MockAggregator f = new MockAggregator(ds[i]);
            MockStockToken t = new MockStockToken();
            f.setRound(int256(250 * 10 ** uint256(ds[i]))); // 250.00 pada desimal feed
            vm.prank(admin);
            router.setAsset(address(t), address(f), MAX_STALE, true);
            (uint256 p,) = router.getPrice(address(t));
            assertEq(p, 250e18, "harga harus 250e18 di semua desimal");
        }
    }

    function test_routerIgnoresUiMultiplier() public {
        // Harga feed sudah per token. Mengubah multiplier tidak boleh mengubah hasil router.
        token.setUiMultiplier(1.05e18);
        (uint256 p,) = router.getPrice(address(token));
        assertEq(p, 250e18);
        token.setUiMultiplier(2e18); // mis. split
        (p,) = router.getPrice(address(token));
        assertEq(p, 250e18);
    }

    function test_unknownAsset() public {
        assertEq(uint8(_status(makeAddr("x"))), uint8(IOracleRouter.Status.UnknownAsset));
        _expectUnavailable(IOracleRouter.Status.UnknownAsset);
        router.getPrice(makeAddr("x"));
    }

    // ------------------------------------------------------------ staleness

    function test_stale_boundaryInclusive() public {
        vm.warp(T0 + MAX_STALE); // umur persis = maxStaleness: masih valid
        (uint256 p,) = router.getPrice(address(token));
        assertEq(p, 250e18);

        vm.warp(T0 + MAX_STALE + 1); // lewat 1 detik: stale
        _expectUnavailable(IOracleRouter.Status.Stale);
        router.getPrice(address(token));
    }

    function test_stale_closedSessionLiveIsRejected() public {
        // Sesi Closed (Minggu 03:00 ET): harga live ditolak sebagai MarketClosed, bukan Stale.
        // Perilaku sesi selengkapnya diuji di OracleRouterSession.t.sol.
        vm.warp(T0 + 2 days);
        assertEq(uint8(_status(address(token))), uint8(IOracleRouter.Status.MarketClosed));
    }

    function testFuzz_stalenessBoundary(uint32 maxStale, uint256 age) public {
        maxStale = uint32(bound(maxStale, 1, router.MAX_STALENESS_LIMIT()));
        age = bound(age, 0, 30 days);
        vm.prank(admin);
        router.setAsset(address(token), address(feed), maxStale, true);

        // Batas staleness berlaku saat sesi terbuka; sesi Closed punya aturan sendiri (OracleRouterSession.t.sol).
        vm.assume(market.sessionAt(T0 + age) != IMarketSession.Session.Closed);

        // Sequencer harus tetap sehat saat waktu maju.
        vm.warp(T0 + age);
        seq.setRaw(1, 0, T0 - 2 hours, T0 - 2 hours, 1);

        IOracleRouter.Status s = _status(address(token));
        if (age > maxStale) assertEq(uint8(s), uint8(IOracleRouter.Status.Stale));
        else assertEq(uint8(s), uint8(IOracleRouter.Status.Ok));
    }

    // -------------------------------------------------- jawaban dan round

    function test_zeroAnswer() public {
        feed.setRound(0);
        _expectUnavailable(IOracleRouter.Status.InvalidAnswer);
        router.getPrice(address(token));
    }

    function test_negativeAnswer() public {
        feed.setRound(-1);
        _expectUnavailable(IOracleRouter.Status.InvalidAnswer);
        router.getPrice(address(token));
    }

    function test_updatedAtZero() public {
        feed.setRaw(5, 250e8, T0, 0, 5);
        _expectUnavailable(IOracleRouter.Status.InvalidRound);
        router.getPrice(address(token));
    }

    function test_updatedAtInFuture() public {
        feed.setRaw(5, 250e8, T0, T0 + 1, 5);
        _expectUnavailable(IOracleRouter.Status.InvalidRound);
        router.getPrice(address(token));
    }

    function test_answeredInRoundBehindRoundId() public {
        feed.setRaw(7, 250e8, T0, T0, 6); // jawaban berasal dari round lama
        _expectUnavailable(IOracleRouter.Status.InvalidRound);
        router.getPrice(address(token));
    }

    function test_roundIdZero() public {
        feed.setRaw(0, 250e8, T0, T0, 0);
        _expectUnavailable(IOracleRouter.Status.InvalidRound);
        router.getPrice(address(token));
    }

    function test_feedLatestRoundDataReverts_failClosed() public {
        feed.setFailLatest(true);
        assertEq(uint8(_status(address(token))), uint8(IOracleRouter.Status.FeedCallFailed));
    }

    function test_feedDecimalsReverts_failClosed() public {
        feed.setFailDecimals(true);
        assertEq(uint8(_status(address(token))), uint8(IOracleRouter.Status.FeedCallFailed));
    }

    function test_overflowOnScalingIsInvalidNotRevert() public {
        MockAggregator f = new MockAggregator(0);
        MockStockToken t = new MockStockToken();
        f.setRound(type(int256).max);
        vm.prank(admin);
        router.setAsset(address(t), address(f), MAX_STALE, false);
        assertEq(uint8(_status(address(t))), uint8(IOracleRouter.Status.InvalidAnswer));
    }

    function test_truncationToZeroIsInvalid() public {
        MockAggregator f = new MockAggregator(36);
        MockStockToken t = new MockStockToken();
        f.setRound(1); // 1 / 10**18 = 0
        vm.prank(admin);
        router.setAsset(address(t), address(f), MAX_STALE, false);
        assertEq(uint8(_status(address(t))), uint8(IOracleRouter.Status.InvalidAnswer));
    }

    function testFuzz_scaling(uint8 d, uint128 answer) public {
        d = uint8(bound(d, 0, 36));
        answer = uint128(bound(answer, 1, type(uint128).max));
        MockAggregator f = new MockAggregator(d);
        MockStockToken t = new MockStockToken();
        f.setRound(int256(uint256(answer)));
        vm.prank(admin);
        router.setAsset(address(t), address(f), MAX_STALE, false);

        (IOracleRouter.Status s, uint256 p,) = router.tryGetPrice(address(t));
        uint256 expected = d <= 18 ? uint256(answer) * 10 ** (18 - d) : uint256(answer) / 10 ** (d - 18);
        if (expected == 0) {
            assertEq(uint8(s), uint8(IOracleRouter.Status.InvalidAnswer));
        } else {
            assertEq(uint8(s), uint8(IOracleRouter.Status.Ok));
            assertEq(p, expected);
        }
    }

    // ------------------------------------------------------------ sequencer

    function test_sequencerDown() public {
        seq.setRaw(2, 1, T0 - 10 minutes, T0 - 10 minutes, 2);
        _expectUnavailable(IOracleRouter.Status.SequencerDown);
        router.getPrice(address(token));
    }

    function test_sequencerGracePeriod_afterRecovery() public {
        seq.setRaw(2, 0, T0 - 10 minutes, T0 - 10 minutes, 2); // baru pulih 10 menit lalu
        _expectUnavailable(IOracleRouter.Status.SequencerGracePeriod);
        router.getPrice(address(token));
    }

    function test_sequencerGracePeriod_boundary() public {
        seq.setRaw(2, 0, T0 - GRACE, T0 - GRACE, 2); // persis = grace: masih ditolak
        assertEq(uint8(_status(address(token))), uint8(IOracleRouter.Status.SequencerGracePeriod));
        seq.setRaw(2, 0, T0 - GRACE - 1, T0 - GRACE - 1, 2);
        assertEq(uint8(_status(address(token))), uint8(IOracleRouter.Status.Ok));
    }

    function test_sequencerStartedAtZeroIsInvalid() public {
        seq.setRaw(1, 0, 0, 0, 1);
        assertEq(uint8(_status(address(token))), uint8(IOracleRouter.Status.SequencerDown));
    }

    function test_sequencerStartedAtFutureIsInvalid() public {
        seq.setRaw(1, 0, T0 + 1, T0 + 1, 1);
        assertEq(uint8(_status(address(token))), uint8(IOracleRouter.Status.SequencerDown));
    }

    function test_sequencerFeedReverts_failClosed() public {
        seq.setFailLatest(true);
        assertEq(uint8(_status(address(token))), uint8(IOracleRouter.Status.SequencerDown));
    }

    function test_sequencerCheckedBeforeAsset() public {
        // Sequencer down dan feed aset juga rusak: status yang dilaporkan adalah sequencer.
        seq.setRaw(2, 1, T0 - 10 minutes, T0 - 10 minutes, 2);
        feed.setRound(0);
        assertEq(uint8(_status(address(token))), uint8(IOracleRouter.Status.SequencerDown));
    }

    function test_sequencerCheckDisabledWhenFeedZero() public {
        OracleRouter r = new OracleRouter(admin, address(0), 0, address(market));
        assertFalse(r.sequencerCheckEnabled());
        assertTrue(router.sequencerCheckEnabled());
        vm.prank(admin);
        r.setAsset(address(token), address(feed), MAX_STALE, true);
        (IOracleRouter.Status s,,) = r.tryGetPrice(address(token));
        assertEq(uint8(s), uint8(IOracleRouter.Status.Ok));
    }

    // ---------------------------------------------------------- oracle pause

    function test_oraclePaused() public {
        token.setPaused(true);
        _expectUnavailable(IOracleRouter.Status.OraclePaused);
        router.getPrice(address(token));
    }

    function test_oraclePausedCallReverts_failClosed() public {
        token.setFailPausedCall(true);
        assertEq(uint8(_status(address(token))), uint8(IOracleRouter.Status.OraclePaused));
    }

    function test_oraclePausedIgnoredWhenCheckDisabled() public {
        vm.prank(admin);
        router.setAsset(address(token), address(feed), MAX_STALE, false);
        token.setPaused(true);
        token.setFailPausedCall(true);
        (uint256 p,) = router.getPrice(address(token));
        assertEq(p, 250e18);
    }

    function test_stalenessStillGuardsWhenPauseFlagIsFalse() public {
        // Flag advisory: tidak paused, tetapi harga basi tetap ditolak.
        token.setPaused(false);
        vm.warp(T0 + MAX_STALE + 1);
        seq.setRaw(1, 0, T0 - 2 hours, T0 - 2 hours, 1);
        assertEq(uint8(_status(address(token))), uint8(IOracleRouter.Status.Stale));
    }

    // ----------------------------------------------------------------- admin

    function test_setAsset_onlyAdmin() public {
        bytes32 role = router.DEFAULT_ADMIN_ROLE(); // dibaca sebelum prank
        vm.expectRevert(
            abi.encodeWithSelector(IAccessControl.AccessControlUnauthorizedAccount.selector, stranger, role)
        );
        vm.prank(stranger);
        router.setAsset(address(token), address(feed), MAX_STALE, true);
    }

    function test_removeAsset_onlyAdminAndMakesUnknown() public {
        vm.prank(stranger);
        vm.expectRevert();
        router.removeAsset(address(token));

        vm.prank(admin);
        router.removeAsset(address(token));
        assertEq(uint8(_status(address(token))), uint8(IOracleRouter.Status.UnknownAsset));
    }

    function test_setAsset_validation() public {
        vm.startPrank(admin);
        vm.expectRevert(OracleRouter.ZeroAddress.selector);
        router.setAsset(address(0), address(feed), MAX_STALE, true);
        vm.expectRevert(OracleRouter.ZeroAddress.selector);
        router.setAsset(address(token), address(0), MAX_STALE, true);
        vm.expectRevert(OracleRouter.InvalidMaxStaleness.selector);
        router.setAsset(address(token), address(feed), 0, true);
        uint32 tooLong = router.MAX_STALENESS_LIMIT() + 1;
        vm.expectRevert(OracleRouter.InvalidMaxStaleness.selector);
        router.setAsset(address(token), address(feed), tooLong, true);
        vm.stopPrank();
    }

    function test_setAsset_rejectsBrokenFeeds() public {
        vm.startPrank(admin);
        // Alamat tanpa kode (bukan feed).
        vm.expectRevert(OracleRouter.InvalidFeed.selector);
        router.setAsset(address(token), makeAddr("eoa"), MAX_STALE, true);
        // decimals() revert.
        MockAggregator bad = new MockAggregator(8);
        bad.setFailDecimals(true);
        vm.expectRevert(OracleRouter.InvalidFeed.selector);
        router.setAsset(address(token), address(bad), MAX_STALE, true);
        // decimals > 36.
        MockAggregator huge = new MockAggregator(37);
        vm.expectRevert(OracleRouter.InvalidFeed.selector);
        router.setAsset(address(token), address(huge), MAX_STALE, true);
        vm.stopPrank();
    }

    function test_setAsset_rejectsTokenWithoutCode() public {
        vm.prank(admin);
        vm.expectRevert(OracleRouter.InvalidFeed.selector);
        router.setAsset(makeAddr("not-a-token"), address(feed), MAX_STALE, true);
    }

    function test_feedCodeRemovedAfterConfig_failClosedNotRevert() public {
        vm.etch(address(feed), ""); // kontrak hilang setelah dikonfigurasi
        assertEq(uint8(_status(address(token))), uint8(IOracleRouter.Status.FeedCallFailed));
    }

    function test_sequencerFeedWithoutCode_failClosedNotRevert() public {
        vm.etch(address(seq), "");
        assertEq(uint8(_status(address(token))), uint8(IOracleRouter.Status.SequencerDown));
    }

    function test_tokenCodeRemovedWithPauseCheck_failClosedNotRevert() public {
        vm.etch(address(token), "");
        assertEq(uint8(_status(address(token))), uint8(IOracleRouter.Status.OraclePaused));
    }

    function test_constructor_rejectsSequencerFeedWithoutCode() public {
        vm.expectRevert(OracleRouter.InvalidFeed.selector);
        new OracleRouter(admin, makeAddr("eoa"), GRACE, address(market));
    }

    function test_constructor_validation() public {
        vm.expectRevert(OracleRouter.ZeroAddress.selector);
        new OracleRouter(address(0), address(seq), GRACE, address(market));
        uint256 tooLong = router.MAX_SEQUENCER_GRACE() + 1;
        vm.expectRevert(OracleRouter.InvalidGracePeriod.selector);
        new OracleRouter(admin, address(seq), tooLong, address(market));
    }

    function test_assetConfig_view() public view {
        OracleRouter.Asset memory a = router.assetConfig(address(token));
        assertEq(address(a.feed), address(feed));
        assertEq(a.stalenessRegular, MAX_STALE);
        assertEq(a.stalenessExtended, MAX_STALE);
        assertEq(a.stalenessOvernight, MAX_STALE);
        assertTrue(a.checkOraclePause);
    }
}
