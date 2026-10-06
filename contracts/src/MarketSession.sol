// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {IMarketSession} from "./interfaces/IMarketSession.sol";
import {Roles} from "./libraries/Roles.sol";

/// @title MarketSession
/// @notice Kalender sesi pasar 24/5 untuk Stock Token, dalam waktu New York (DST aturan AS sejak 2007).
/// @dev Fase 2 item 3. Jam sesi sama dengan aproksimasi di web (`lib/api/market.ts`):
///        Regular   09:30-16:00 ET, Senin-Jumat
///        Extended  04:00-09:30 dan 16:00-20:00 ET, Senin-Jumat
///        Overnight 20:00-04:00 ET, dari Minggu 20:00 sampai Jumat 04:00 dan Kamis 20:00 sampai Jumat 04:00
///        Closed    Jumat 20:00 sampai Minggu 20:00, dan hari libur.
///      Jam persis sesi feed Robinhood BELUM diverifikasi (Fase 0 item 6). Libur bursa tidak bisa dihitung onchain,
///      jadi diisi admin per tanggal. Libur = seluruh hari kalender ET Closed. Aturan konservatif: sesi Overnight
///      yang bersinggungan dengan hari libur (malam sebelum libur, dini hari setelah libur) juga Closed.
///      Jam tutup lebih awal (mis. 13:00) belum didukung. Salah mengisi libur selalu gagal ke arah aman
///      (operasi ditolak), karena OracleRouter tetap menjaga staleness.
///      Peran (item 5): KEEPER (kunci panas) hanya boleh MENAMBAH libur (arah aman). MENGHAPUS libur (membuka
///      kembali hari yang ditutup) hanya ADMIN (timelock). Risiko sisa: KEEPER yang bocor bisa menandai hari dagang
///      sebagai libur sehingga operasi live ditolak sampai ADMIN menghapusnya (jeda timelock).
contract MarketSession is IMarketSession, AccessControl {
    /// Aturan DST AS yang dipakai berlaku sejak 2007.
    uint256 public constant MIN_TIMESTAMP = 1_167_609_600; // 2007-01-01 UTC
    /// Batas atas agar aritmetika tanggal tidak overflow; di luar rentang dianggap Closed.
    uint256 public constant MAX_TIMESTAMP = 4_102_444_800; // 2100-01-01 UTC
    bytes32 public constant KEEPER_ROLE = Roles.KEEPER_ROLE;
    uint16 public constant MIN_YEAR = 2007;
    uint16 public constant MAX_YEAR = 2100;
    /// Batas pencarian mundur untuk `lastOpenEnd` (akhir pekan panjang paling lama ±5 hari).
    uint256 public constant MAX_CLOSED_SCAN_DAYS = 14;

    uint256 internal constant EST = 5 hours; // UTC-5
    uint256 internal constant EDT = 4 hours; // UTC-4
    uint256 internal constant EXTENDED_OPEN = 4 hours;
    uint256 internal constant REGULAR_OPEN = 9 hours + 30 minutes;
    uint256 internal constant REGULAR_CLOSE = 16 hours;
    uint256 internal constant EXTENDED_CLOSE = 20 hours;

    /// Hari lokal ET (hari sejak epoch) yang libur.
    mapping(uint256 localDay => bool) private _holiday;

    event HolidaySet(uint16 year, uint8 month, uint8 day, bool isHoliday);

    error ZeroAddress();
    error InvalidDate();

    constructor(address admin) {
        if (admin == address(0)) revert ZeroAddress();
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
    }

    // ---------------------------------------------------------------- admin

    function setHoliday(uint16 year, uint8 month, uint8 day, bool isHoliday_) external {
        if (isHoliday_) {
            if (!hasRole(KEEPER_ROLE, msg.sender) && !hasRole(DEFAULT_ADMIN_ROLE, msg.sender)) {
                revert AccessControlUnauthorizedAccount(msg.sender, KEEPER_ROLE);
            }
        } else {
            _checkRole(DEFAULT_ADMIN_ROLE);
        }
        _holiday[_dayOf(year, month, day)] = isHoliday_;
        emit HolidaySet(year, month, day, isHoliday_);
    }

    function isHoliday(uint16 year, uint8 month, uint8 day) external view returns (bool) {
        return _holiday[_dayOf(year, month, day)];
    }

    // ----------------------------------------------------------------- views

    /// @inheritdoc IMarketSession
    function sessionAt(uint256 ts) public view returns (Session) {
        if (ts < MIN_TIMESTAMP || ts >= MAX_TIMESTAMP) return Session.Closed;
        (uint256 day, uint256 sec) = _local(ts);
        return _sessionOf(day, sec);
    }

    /// @inheritdoc IMarketSession
    function lastOpenEnd(uint256 ts) external view returns (uint256) {
        if (ts < MIN_TIMESTAMP || ts >= MAX_TIMESTAMP) return 0;
        (uint256 day, uint256 sec) = _local(ts);
        if (_sessionOf(day, sec) != Session.Closed) return ts;

        for (uint256 k; k < MAX_CLOSED_SCAN_DAYS; ++k) {
            uint256 d = day - k;
            // Hari ini hanya segmen yang sudah berakhir sebelum `sec`; hari sebelumnya seluruh hari.
            uint256 end = _latestOpenEndInDay(d, k == 0 ? sec : 1 days);
            if (end != 0) return _toUtc(d * 1 days + end);
        }
        return 0;
    }

    /// Apakah `ts` jatuh pada waktu musim panas AS (EDT).
    function isDst(uint256 ts) public pure returns (bool) {
        (uint256 y,,) = _civil(ts / 1 days);
        uint256 mar1 = _daysFromCivil(y, 3, 1);
        // Minggu kedua Maret 02:00 EST = 07:00 UTC.
        uint256 start = (mar1 + (7 - _weekday(mar1)) % 7 + 7) * 1 days + 7 hours;
        uint256 nov1 = _daysFromCivil(y, 11, 1);
        // Minggu pertama November 02:00 EDT = 06:00 UTC.
        uint256 end = (nov1 + (7 - _weekday(nov1)) % 7) * 1 days + 6 hours;
        return ts >= start && ts < end;
    }

    // -------------------------------------------------------------- internal

    function _sessionOf(uint256 day, uint256 sec) internal view returns (Session) {
        if (_holiday[day]) return Session.Closed;
        uint256 wd = _weekday(day); // 0 = Minggu ... 6 = Sabtu
        if (sec >= EXTENDED_CLOSE) {
            // Overnight dimulai Minggu-Kamis 20:00, tidak boleh menyentuh hari libur berikutnya.
            return (wd <= 4 && !_holiday[day + 1]) ? Session.Overnight : Session.Closed;
        }
        if (sec < EXTENDED_OPEN) {
            // Sisa overnight dari malam sebelumnya; Senin-Jumat saja, hari sebelumnya bukan libur.
            return (wd >= 1 && wd <= 5 && !_holiday[day - 1]) ? Session.Overnight : Session.Closed;
        }
        if (wd == 0 || wd == 6) return Session.Closed;
        return (sec >= REGULAR_OPEN && sec < REGULAR_CLOSE) ? Session.Regular : Session.Extended;
    }

    /// Akhir (detik lokal dalam hari `d`) segmen terbuka paling akhir yang berakhir <= `limit`. 0 bila tidak ada.
    /// Tiap segmen (00:00-04:00, 04:00-20:00, 20:00-24:00) seragam: seluruhnya terbuka atau seluruhnya tutup.
    function _latestOpenEndInDay(uint256 d, uint256 limit) internal view returns (uint256) {
        if (limit >= 1 days && _sessionOf(d, EXTENDED_CLOSE) != Session.Closed) return 1 days;
        if (limit >= EXTENDED_CLOSE && _sessionOf(d, EXTENDED_OPEN) != Session.Closed) return EXTENDED_CLOSE;
        if (limit >= EXTENDED_OPEN && _sessionOf(d, 0) != Session.Closed) return EXTENDED_OPEN;
        return 0;
    }

    function _local(uint256 ts) internal pure returns (uint256 day, uint256 sec) {
        uint256 lt = ts - (isDst(ts) ? EDT : EST);
        day = lt / 1 days;
        sec = lt % 1 days;
    }

    /// Waktu lokal ET (detik sejak epoch, seolah UTC) ke UTC. Batas sesi (00:00, 04:00, 20:00) tidak pernah
    /// jatuh pada jam yang ambigu saat pergantian DST (02:00), jadi satu tebakan cukup.
    function _toUtc(uint256 lt) internal pure returns (uint256) {
        return isDst(lt + EDT) ? lt + EDT : lt + EST;
    }

    function _dayOf(uint16 year, uint8 month, uint8 day) internal pure returns (uint256 d) {
        if (year < MIN_YEAR || year > MAX_YEAR || month < 1 || month > 12 || day < 1) revert InvalidDate();
        d = _daysFromCivil(year, month, day);
        (uint256 y2, uint256 m2, uint256 d2) = _civil(d);
        if (y2 != year || m2 != month || d2 != day) revert InvalidDate(); // mis. 31 Februari
    }

    /// 0 = Minggu. 1970-01-01 adalah Kamis.
    function _weekday(uint256 daysSinceEpoch) internal pure returns (uint256) {
        return (daysSinceEpoch + 4) % 7;
    }

    // Howard Hinnant, "chrono-Compatible Low-Level Date Algorithms". Hanya untuk tanggal >= 1970.
    function _daysFromCivil(uint256 y, uint256 m, uint256 d) internal pure returns (uint256) {
        if (m <= 2) y -= 1;
        uint256 era = y / 400;
        uint256 yoe = y - era * 400;
        uint256 doy = (153 * (m > 2 ? m - 3 : m + 9) + 2) / 5 + d - 1;
        uint256 doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
        return era * 146097 + doe - 719468;
    }

    function _civil(uint256 z) internal pure returns (uint256 y, uint256 m, uint256 d) {
        z += 719468;
        uint256 era = z / 146097;
        uint256 doe = z - era * 146097;
        uint256 yoe = (doe - doe / 1460 + doe / 36524 - doe / 146096) / 365;
        y = yoe + era * 400;
        uint256 doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
        uint256 mp = (5 * doy + 2) / 153;
        d = doy - (153 * mp + 2) / 5 + 1;
        m = mp < 10 ? mp + 3 : mp - 9;
        if (m <= 2) y += 1;
    }
}
