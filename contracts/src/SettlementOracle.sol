// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IAggregatorV3} from "./interfaces/IAggregatorV3.sol";
import {IOracleRouter} from "./interfaces/IOracleRouter.sol";
import {ISettlementOracle} from "./interfaces/ISettlementOracle.sol";
import {IStockToken} from "./interfaces/IStockToken.sol";
import {PriceMath} from "./libraries/PriceMath.sol";

/// @title SettlementOracle
/// @notice Mencatat harga settlement (token, expiry) sekali dan permanen, dari round Chainlink yang dibuktikan
///         onchain. Siapa pun boleh mengirim: kontrak memverifikasi sendiri, jadi pengirim (keeper) tidak bisa memilih harga.
/// @dev Fase 2 item 3 (+ item 5: jeda per aset). ATURAN INI ADALAH KEPUTUSAN SAYA UNTUK PERTANYAAN TERBUKA 9 dan belum disetujui:
///
///      1. Print: round dengan updatedAt >= expiry, dan round sebelumnya (roundId - 1) updatedAt < expiry, jadi
///         round itu unik (round pertama sejak expiry). Karena feed 24/5, itu harga sesi after-hours pertama
///         setelah expiry, BUKAN harga penutupan. Harus muncul dalam `maxPrintDelay` setelah expiry.
///      2. Fallback: bila print tidak muncul dalam `maxPrintDelay` (feed tanpa heartbeat bisa diam), setelah
///         jendela itu lewat harga round TERAKHIR sebelum expiry boleh dipakai, asalkan segar pada saat expiry
///         menurut jendela staleness sesi (OracleRouter.freshnessReference) dan tidak ada print di jendela.
///      3. Settlement ditolak selama `oraclePaused()` (corporate action); menunggu sampai oracle aktif lagi.
///      4. Batas fase Chainlink (round pertama sebuah fase, nomor 1) belum ditangani: print di round itu
///         ditolak (PhaseBoundary). Ini sangat jarang, tetapi bila terjadi tepat setelah expiry settlement macet
///         sampai ada jalur penyelesaian lain. Item 5 SENGAJA tidak menambah jalur admin yang bisa menetapkan
///         harga (itu mengubah model kepercayaan; perlu keputusan bersama pertanyaan terbuka 9).
///      5. Settlement ditunda selama aset dijeda GUARDIAN/ADMIN di OracleRouter (`isAssetPaused`). Jeda hanya
///         menunda: print dan round sebelum expiry dinilai dari waktu feed, bukan waktu pengiriman, jadi settlement
///         tetap bisa dicatat setelah jeda dibuka.
///      Tidak ada pemeriksaan sequencer di sini: keduanya memakai waktu feed (updatedAt), bukan waktu pengiriman.
contract SettlementOracle is ISettlementOracle {
    /// Batas atas hardcode `maxPrintDelay`.
    uint32 public constant MAX_PRINT_DELAY_LIMIT = 1 days;

    IOracleRouter public immutable ROUTER;
    uint32 public immutable MAX_PRINT_DELAY;

    mapping(address token => mapping(uint64 expiry => Settlement)) private _settlements;

    error InvalidConfig();
    error UnknownAsset();
    error NotExpired();
    error AlreadySettled();
    error OraclePaused();
    error AssetPaused();
    error RoundUnavailable();
    error InvalidAnswer();
    error InvalidRound();
    error RoundBeforeExpiry();
    error PrintTooLate();
    error PhaseBoundary();
    error NotFirstRoundAfterExpiry();
    error PrintWindowOpen();
    error RoundNotBeforeExpiry();
    error NotLastRoundBeforeExpiry();
    error PrintExists();
    error NextRoundUnavailable();
    error StalePrice();
    error FeedCallFailed();

    constructor(address router_, uint32 maxPrintDelay_) {
        if (router_ == address(0) || router_.code.length == 0) revert InvalidConfig();
        if (maxPrintDelay_ == 0 || maxPrintDelay_ > MAX_PRINT_DELAY_LIMIT) revert InvalidConfig();
        ROUTER = IOracleRouter(router_);
        MAX_PRINT_DELAY = maxPrintDelay_;
    }

    /// @inheritdoc ISettlementOracle
    function settlement(address token, uint64 expiry) external view returns (Settlement memory) {
        return _settlements[token][expiry];
    }

    /// Catat print: `roundId` harus round pertama dengan updatedAt >= `expiry`.
    // slither-disable-next-line timestamp
    function settle(address token, uint64 expiry, uint80 roundId) external {
        IAggregatorV3 feed = _begin(token, expiry);

        Round memory r = _round(feed, roundId);
        if (r.answer <= 0) revert InvalidAnswer();
        if (r.answeredInRound < roundId) revert InvalidRound();
        if (r.updatedAt < expiry) revert RoundBeforeExpiry();
        if (r.updatedAt - expiry > MAX_PRINT_DELAY) revert PrintTooLate();

        // Round sebelumnya ada di fase yang sama hanya bila nomor round (64 bit bawah) > 1.
        if (uint64(roundId) <= 1) revert PhaseBoundary();
        Round memory p = _round(feed, roundId - 1);
        if (p.updatedAt >= expiry) revert NotFirstRoundAfterExpiry();

        _record(token, expiry, feed, roundId, r, Kind.Print);
    }

    /// Catat harga round terakhir sebelum `expiry` bila tidak ada print dalam `MAX_PRINT_DELAY`.
    // slither-disable-next-line timestamp
    function settleFallback(address token, uint64 expiry, uint80 roundId) external {
        IAggregatorV3 feed = _begin(token, expiry);
        // Print dengan updatedAt == expiry + delay masih sah, jadi jendela baru tertutup setelah detik itu.
        if (block.timestamp <= uint256(expiry) + MAX_PRINT_DELAY) revert PrintWindowOpen();

        Round memory l = _round(feed, roundId);
        if (l.answer <= 0) revert InvalidAnswer();
        if (l.answeredInRound < roundId) revert InvalidRound();
        if (l.updatedAt >= expiry) revert RoundNotBeforeExpiry();

        // Round ini harus yang terakhir sebelum expiry, dan tidak boleh ada print di jendela.
        (bool okLatest, uint80 latestId) = _latestId(feed);
        if (!okLatest) revert FeedCallFailed();
        if (latestId != roundId) {
            Round memory n = _roundOrNextUnavailable(feed, roundId + 1);
            if (n.updatedAt < expiry) revert NotLastRoundBeforeExpiry();
            if (n.updatedAt <= uint256(expiry) + MAX_PRINT_DELAY) revert PrintExists();
        }

        // Harga ditahan harus segar pada saat expiry (sesi tepat sebelum expiry).
        (uint256 ref, uint32 window,) = ROUTER.freshnessReference(token, uint256(expiry) - 1);
        if (ref == 0 || (ref > l.updatedAt && ref - l.updatedAt > window)) revert StalePrice();

        _record(token, expiry, feed, roundId, l, Kind.LastBeforeExpiry);
    }

    // -------------------------------------------------------------- internal

    struct Round {
        int256 answer;
        uint256 updatedAt;
        uint80 answeredInRound;
    }

    /// Pemeriksaan bersama: expiry lewat, belum tercatat, aset terdaftar, oracle tidak di-pause.
    // slither-disable-next-line timestamp
    function _begin(address token, uint64 expiry) internal view returns (IAggregatorV3 feed) {
        if (expiry == 0 || block.timestamp < expiry) revert NotExpired();
        if (_settlements[token][expiry].exists) revert AlreadySettled();
        (address f, bool check) = ROUTER.feedOf(token);
        if (f == address(0)) revert UnknownAsset();
        if (ROUTER.isAssetPaused(token)) revert AssetPaused();
        if (check) {
            if (token.code.length == 0) revert OraclePaused();
            try IStockToken(token).oraclePaused() returns (bool paused) {
                if (paused) revert OraclePaused();
            } catch {
                revert OraclePaused(); // gagal membaca flag = fail-closed
            }
        }
        return IAggregatorV3(f);
    }

    function _record(address token, uint64 expiry, IAggregatorV3 feed, uint80 roundId, Round memory r, Kind kind)
        internal
    {
        uint8 d;
        try feed.decimals() returns (uint8 d_) {
            d = d_;
        } catch {
            revert FeedCallFailed();
        }
        if (d > PriceMath.MAX_FEED_DECIMALS) revert InvalidAnswer();
        // forge-lint: disable-next-line(unsafe-typecast)
        (bool scaled, uint256 priceE18) = PriceMath.toE18(uint256(r.answer), d); // answer > 0 sudah dipastikan pemanggil
        if (!scaled) revert InvalidAnswer();

        _settlements[token][expiry] = Settlement({
            priceE18: priceE18,
            roundUpdatedAt: r.updatedAt,
            roundId: roundId,
            // forge-lint: disable-next-line(unsafe-typecast)
            settledAt: uint64(block.timestamp),
            kind: kind,
            exists: true
        });
        emit Settled(token, expiry, roundId, priceE18, r.updatedAt, kind);
    }

    // slither-disable-next-line unused-return
    function _round(IAggregatorV3 feed, uint80 roundId) internal view returns (Round memory r) {
        try feed.getRoundData(roundId) returns (uint80, int256 answer, uint256, uint256 updatedAt, uint80 air) {
            if (updatedAt == 0) revert RoundUnavailable();
            r = Round(answer, updatedAt, air);
        } catch {
            revert RoundUnavailable();
        }
    }

    function _roundOrNextUnavailable(IAggregatorV3 feed, uint80 roundId) internal view returns (Round memory r) {
        try feed.getRoundData(roundId) returns (uint80, int256 answer, uint256, uint256 updatedAt, uint80 air) {
            if (updatedAt == 0) revert NextRoundUnavailable();
            r = Round(answer, updatedAt, air);
        } catch {
            revert NextRoundUnavailable();
        }
    }

    // slither-disable-next-line unused-return
    function _latestId(IAggregatorV3 feed) internal view returns (bool ok, uint80 id) {
        try feed.latestRoundData() returns (uint80 roundId, int256, uint256, uint256, uint80) {
            return (true, roundId);
        } catch {
            return (false, 0);
        }
    }
}
