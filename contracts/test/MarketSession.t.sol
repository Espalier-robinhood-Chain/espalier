// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {IAccessControl} from "@openzeppelin/contracts/access/IAccessControl.sol";
import {MarketSession} from "../src/MarketSession.sol";
import {IMarketSession} from "../src/interfaces/IMarketSession.sol";

contract MarketSessionTest is Test {
    MarketSession internal ms;
    address internal admin = makeAddr("admin");

    IMarketSession.Session internal constant CLOSED = IMarketSession.Session.Closed;
    IMarketSession.Session internal constant OVERNIGHT = IMarketSession.Session.Overnight;
    IMarketSession.Session internal constant EXTENDED = IMarketSession.Session.Extended;
    IMarketSession.Session internal constant REGULAR = IMarketSession.Session.Regular;

    // 2026-10-02 adalah Jumat; DST (EDT, UTC-4) berlaku. 00:00 ET = 04:00 UTC.
    uint256 internal constant FRI_00_ET = 1_790_913_600;
    // 2026-10-05 Senin 00:00 ET.
    uint256 internal constant MON_00_ET = FRI_00_ET + 3 days;

    function setUp() public {
        ms = new MarketSession(admin);
    }

    function _s(uint256 ts) internal view returns (IMarketSession.Session) {
        return ms.sessionAt(ts);
    }

    // ---------------------------------------------------- titik acuan (hitungan tangan)

    function test_anchorDatesAreWhatTheyClaim() public pure {
        // Jumat 2026-10-02 00:00 EDT = 2026-10-02 04:00 UTC.
        assertEq(FRI_00_ET, 1_790_913_600);
        assertEq((FRI_00_ET / 1 days + 4) % 7, 5, "Jumat");
        assertEq((MON_00_ET / 1 days + 4) % 7, 1, "Senin");
    }

    function test_fridayBoundaries() public view {
        assertEq(uint8(_s(FRI_00_ET)), uint8(OVERNIGHT), "00:00 overnight (sisa Kamis malam)");
        assertEq(uint8(_s(FRI_00_ET + 4 hours - 1)), uint8(OVERNIGHT));
        assertEq(uint8(_s(FRI_00_ET + 4 hours)), uint8(EXTENDED), "04:00 extended");
        assertEq(uint8(_s(FRI_00_ET + 9.5 hours - 1)), uint8(EXTENDED));
        assertEq(uint8(_s(FRI_00_ET + 9.5 hours)), uint8(REGULAR), "09:30 regular");
        assertEq(uint8(_s(FRI_00_ET + 16 hours - 1)), uint8(REGULAR));
        assertEq(uint8(_s(FRI_00_ET + 16 hours)), uint8(EXTENDED), "16:00 extended (after-hours)");
        assertEq(uint8(_s(FRI_00_ET + 20 hours - 1)), uint8(EXTENDED));
        assertEq(uint8(_s(FRI_00_ET + 20 hours)), uint8(CLOSED), "Jumat 20:00 tutup");
    }

    function test_weekendClosedUntilSunday20() public view {
        assertEq(uint8(_s(FRI_00_ET + 1 days)), uint8(CLOSED), "Sabtu 00:00");
        assertEq(uint8(_s(FRI_00_ET + 2 days + 12 hours)), uint8(CLOSED), "Sabtu siang");
        assertEq(uint8(_s(MON_00_ET - 4 hours - 1)), uint8(CLOSED), "Minggu 19:59:59");
        assertEq(uint8(_s(MON_00_ET - 4 hours)), uint8(OVERNIGHT), "Minggu 20:00 buka");
        assertEq(uint8(_s(MON_00_ET + 4 hours)), uint8(EXTENDED), "Senin 04:00");
    }

    // -------------------------------------------------------------------- DST

    function test_dst_2026_transitions() public view {
        // Mulai: Minggu 8 Maret 2026 02:00 EST = 07:00 UTC.
        uint256 start = 1_772_953_200;
        assertFalse(ms.isDst(start - 1));
        assertTrue(ms.isDst(start));
        // Akhir: Minggu 1 November 2026 02:00 EDT = 06:00 UTC.
        uint256 end = 1_793_512_800;
        assertTrue(ms.isDst(end - 1));
        assertFalse(ms.isDst(end));
    }

    function test_sessionShiftsAnHourAcrossDst() public view {
        // Jumat 6 Maret 2026 (EST): regular 09:30 ET = 14:30 UTC. Jumat 13 Maret (EDT): 09:30 ET = 13:30 UTC.
        uint256 fri6 = 1_772_773_200; // 2026-03-06 00:00 EST = 05:00 UTC
        assertEq(uint8(_s(fri6 + 9.5 hours - 1)), uint8(EXTENDED));
        assertEq(uint8(_s(fri6 + 9.5 hours)), uint8(REGULAR));
        uint256 fri13 = 1_773_374_400; // 2026-03-13 00:00 EDT = 04:00 UTC
        assertEq(uint8(_s(fri13 + 9.5 hours - 1)), uint8(EXTENDED));
        assertEq(uint8(_s(fri13 + 9.5 hours)), uint8(REGULAR));
    }

    // ------------------------------------------------------------------ libur

    function test_holiday_strangerCannotSetAnything() public {
        bytes32 keeperRole = ms.KEEPER_ROLE();
        bytes32 adminRole = ms.DEFAULT_ADMIN_ROLE();
        vm.expectRevert(
            abi.encodeWithSelector(IAccessControl.AccessControlUnauthorizedAccount.selector, address(this), keeperRole)
        );
        ms.setHoliday(2026, 10, 7, true);
        vm.expectRevert(
            abi.encodeWithSelector(IAccessControl.AccessControlUnauthorizedAccount.selector, address(this), adminRole)
        );
        ms.setHoliday(2026, 10, 7, false);
    }

    function test_holiday_invalidDatesRevert() public {
        vm.startPrank(admin);
        vm.expectRevert(MarketSession.InvalidDate.selector);
        ms.setHoliday(2026, 2, 30, true);
        vm.expectRevert(MarketSession.InvalidDate.selector);
        ms.setHoliday(2026, 13, 1, true);
        vm.expectRevert(MarketSession.InvalidDate.selector);
        ms.setHoliday(2026, 0, 1, true);
        vm.expectRevert(MarketSession.InvalidDate.selector);
        ms.setHoliday(2026, 1, 0, true);
        vm.expectRevert(MarketSession.InvalidDate.selector);
        ms.setHoliday(2006, 1, 2, true);
        vm.expectRevert(MarketSession.InvalidDate.selector);
        ms.setHoliday(2101, 1, 2, true);
        vm.stopPrank();
    }

    function test_holiday_setAndUnset() public {
        // Rabu 2026-10-07 libur.
        uint256 wed = MON_00_ET + 2 days;
        assertEq(uint8(_s(wed + 12 hours)), uint8(REGULAR));
        vm.prank(admin);
        ms.setHoliday(2026, 10, 7, true);
        assertTrue(ms.isHoliday(2026, 10, 7));
        assertEq(uint8(_s(wed + 12 hours)), uint8(CLOSED), "siang libur");
        assertEq(uint8(_s(wed)), uint8(CLOSED), "00:00 hari libur");
        assertEq(uint8(_s(wed - 1)), uint8(CLOSED), "Selasa 23:59:59: malam sebelum libur tutup");
        assertEq(uint8(_s(wed - 4 hours)), uint8(CLOSED), "Selasa 20:00");
        assertEq(uint8(_s(wed - 4 hours - 1)), uint8(EXTENDED), "Selasa 19:59:59 masih extended");
        assertEq(uint8(_s(wed + 1 days)), uint8(CLOSED), "Kamis 00:00 (sisa overnight dari malam libur)");
        assertEq(uint8(_s(wed + 1 days + 4 hours)), uint8(EXTENDED), "Kamis 04:00 buka lagi");
        vm.prank(admin);
        ms.setHoliday(2026, 10, 7, false);
        assertFalse(ms.isHoliday(2026, 10, 7));
        assertEq(uint8(_s(wed + 12 hours)), uint8(REGULAR));
    }

    function test_holiday_mondayExtendsWeekend() public {
        // Senin 2026-10-05 libur: Minggu malam tidak buka; Senin tutup; buka Selasa 04:00 (extended).
        vm.prank(admin);
        ms.setHoliday(2026, 10, 5, true);
        assertEq(uint8(_s(MON_00_ET - 4 hours)), uint8(CLOSED), "Minggu 20:00 tidak buka");
        assertEq(uint8(_s(MON_00_ET + 12 hours)), uint8(CLOSED));
        assertEq(uint8(_s(MON_00_ET + 1 days + 3 hours)), uint8(CLOSED), "Selasa 03:00");
        assertEq(uint8(_s(MON_00_ET + 1 days + 4 hours)), uint8(EXTENDED), "Selasa 04:00");
        // Sejak Jumat 20:00 sampai Selasa 04:00.
        uint256 ts = MON_00_ET + 12 hours;
        assertEq(ms.lastOpenEnd(ts), FRI_00_ET + 20 hours);
    }

    function test_holiday_fridayHolidayClosesThursdayEvening() public {
        vm.prank(admin);
        ms.setHoliday(2026, 10, 2, true); // Jumat
        uint256 thu = FRI_00_ET - 1 days;
        assertEq(uint8(_s(thu + 19 hours)), uint8(EXTENDED));
        assertEq(uint8(_s(thu + 20 hours)), uint8(CLOSED), "Kamis 20:00 tutup (esok libur)");
        assertEq(ms.lastOpenEnd(MON_00_ET - 10 hours), thu + 20 hours);
    }

    // ----------------------------------------------------------- lastOpenEnd

    function test_lastOpenEnd_openReturnsTs() public view {
        uint256 ts = FRI_00_ET + 11 hours;
        assertEq(ms.lastOpenEnd(ts), ts);
    }

    function test_lastOpenEnd_weekend() public view {
        uint256 close = FRI_00_ET + 20 hours;
        assertEq(ms.lastOpenEnd(close), close, "persis saat tutup: Closed, awal periode = close");
        assertEq(ms.lastOpenEnd(close + 1), close);
        assertEq(ms.lastOpenEnd(FRI_00_ET + 1 days + 7 hours), close, "Sabtu");
        assertEq(ms.lastOpenEnd(MON_00_ET - 4 hours - 1), close, "Minggu 19:59:59");
        assertEq(ms.lastOpenEnd(MON_00_ET - 4 hours), MON_00_ET - 4 hours, "Minggu 20:00 buka");
    }

    function test_lastOpenEnd_closedAcrossDstChange() public view {
        // Akhir pekan pergantian DST akhir: Jumat 30 Okt 20:00 EDT -> Minggu 1 Nov 20:00 EST.
        uint256 fri = FRI_00_ET + 4 weeks; // 2026-10-30 00:00 EDT = 04:00 UTC
        assertEq((fri / 1 days + 4) % 7, 5, "Jumat");
        // Sabtu siang (EDT) dan Minggu siang (sudah EST) sama-sama kembali ke Jumat 20:00 EDT.
        assertEq(ms.lastOpenEnd(fri + 1 days + 12 hours), fri + 20 hours);
        assertEq(ms.lastOpenEnd(fri + 2 days + 13 hours), fri + 20 hours, "Minggu 12:00 EST");
        // Minggu 20:00 EST = Senin 01:00 UTC buka.
        uint256 sunOpen = fri + 2 days + 21 hours; // 01:00 UTC Senin
        assertEq(uint8(_s(sunOpen - 1)), uint8(CLOSED));
        assertEq(uint8(_s(sunOpen)), uint8(OVERNIGHT));
    }

    function test_lastOpenEnd_tooEarlyAndTooLongClosed() public {
        assertEq(ms.lastOpenEnd(0), 0);
        assertEq(uint8(_s(0)), uint8(CLOSED));
        assertEq(uint8(_s(ms.MIN_TIMESTAMP() - 1)), uint8(CLOSED));
        // Libur 20 hari berturut-turut (salah isi): lewat jendela pencarian -> 0 (tidak diketahui), tanpa revert.
        vm.startPrank(admin);
        for (uint8 d = 5; d <= 31; d++) {
            ms.setHoliday(2026, 10, d, true);
        }
        vm.stopPrank();
        assertEq(uint8(_s(MON_00_ET + 20 days + 12 hours)), uint8(CLOSED));
        assertEq(ms.lastOpenEnd(MON_00_ET + 20 days + 12 hours), 0);
    }

    // ------------------------------------------- vektor independen (Python zoneinfo)

    function test_matchesPythonZoneinfoVectors() public {
        string memory json = vm.readFile("test/data/session_vectors.json");
        uint256[] memory hol = vm.parseJsonUintArray(json, ".holYear");
        uint256[] memory holM = vm.parseJsonUintArray(json, ".holMonth");
        uint256[] memory holD = vm.parseJsonUintArray(json, ".holDay");
        vm.startPrank(admin);
        for (uint256 i; i < hol.length; i++) {
            // forge-lint: disable-next-line(unsafe-typecast)
            ms.setHoliday(uint16(hol[i]), uint8(holM[i]), uint8(holD[i]), true);
        }
        vm.stopPrank();

        uint256[] memory ts = vm.parseJsonUintArray(json, ".ts");
        uint256[] memory sess = vm.parseJsonUintArray(json, ".session");
        uint256[] memory dst = vm.parseJsonUintArray(json, ".dst");
        uint256[] memory loe = vm.parseJsonUintArray(json, ".lastOpenEnd");
        assertGt(ts.length, 2000, "vektor harus terbaca");
        uint256 closedCount;
        for (uint256 i; i < ts.length; i++) {
            assertEq(uint8(ms.sessionAt(ts[i])), uint8(sess[i]), string.concat("session ts=", vm.toString(ts[i])));
            assertEq(ms.isDst(ts[i]) ? 1 : 0, dst[i], string.concat("dst ts=", vm.toString(ts[i])));
            assertEq(ms.lastOpenEnd(ts[i]), loe[i], string.concat("lastOpenEnd ts=", vm.toString(ts[i])));
            if (sess[i] == 0) closedCount++;
        }
        assertGt(closedCount, 500, "vektor harus memuat banyak keadaan tutup");
    }

    // ------------------------------------------------------------------ fuzz

    /// Sifat: untuk ts Closed dengan hasil e != 0, e <= ts, sesi tepat sebelum e terbuka, e dan semua titik
    /// 30 menit sampai ts Closed (periode tutup bersambung); untuk ts terbuka hasilnya ts. Tidak pernah revert.
    function testFuzz_lastOpenEndProperties(uint256 ts) public {
        ts = bound(ts, 1_800_000_000, 2_400_000_000);
        // Beberapa libur acak di sekitar ts agar jalur libur ikut teruji.
        vm.startPrank(admin);
        ms.setHoliday(2028, 7, 4, true);
        ms.setHoliday(2030, 12, 25, true);
        ms.setHoliday(2033, 1, 3, true);
        vm.stopPrank();

        uint256 e = ms.lastOpenEnd(ts);
        if (ms.sessionAt(ts) != CLOSED) {
            assertEq(e, ts);
            return;
        }
        assertGt(e, 0, "dalam rentang uji periode tutup selalu terlacak");
        assertLe(e, ts);
        assertLe(ts - e, 6 days);
        assertTrue(ms.sessionAt(e - 1) != CLOSED, "sebelum e terbuka");
        assertEq(uint8(ms.sessionAt(e)), uint8(CLOSED), "e adalah awal tutup");
        for (uint256 t = e; t <= ts; t += 30 minutes) {
            assertEq(uint8(ms.sessionAt(t)), uint8(CLOSED), "periode tutup bersambung");
        }
    }

    function testFuzz_neverRevertsForAnyTimestamp(uint256 ts) public view {
        ms.sessionAt(ts);
        ms.lastOpenEnd(ts);
    }

    function test_outOfRangeTimestamps() public view {
        assertEq(uint8(_s(ms.MAX_TIMESTAMP())), uint8(CLOSED));
        assertEq(ms.lastOpenEnd(ms.MAX_TIMESTAMP()), 0);
        assertEq(uint8(_s(type(uint256).max)), uint8(CLOSED));
        assertEq(ms.lastOpenEnd(type(uint256).max), 0);
    }

    function testFuzz_fridayEveningAndSaturdayAlwaysClosed(uint256 weekIndex, uint256 offset) public view {
        weekIndex = bound(weekIndex, 0, 400);
        offset = bound(offset, 0, 28 hours - 1); // Jumat 20:00 sampai Sabtu 24:00 (pada hari lokal)
        // Awal minggu: Jumat 2026-10-02 00:00 EDT, digeser per minggu; DST berubah, jadi hitung jam lokal.
        uint256 fri = FRI_00_ET + weekIndex * 7 days;
        uint256 ts = fri + 20 hours + offset;
        // Konversi aman terhadap DST: titik uji dipilih >= 1 jam di dalam jendela tutup.
        if (ts > fri + 20 hours + 1 hours && ts < fri + 20 hours + 24 hours + 3 hours) {
            assertEq(uint8(ms.sessionAt(ts)), uint8(CLOSED));
        }
    }
}
