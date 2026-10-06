// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {IMarketSession} from "./IMarketSession.sol";

interface IOracleRouter {
    /// Hasil pemeriksaan harga. `Ok` adalah satu-satunya status yang membawa harga valid.
    /// Anggota baru hanya ditambahkan di akhir supaya nilai numeriknya stabil.
    enum Status {
        Ok,
        UnknownAsset,
        SequencerDown,
        SequencerGracePeriod,
        OraclePaused,
        FeedCallFailed,
        InvalidAnswer,
        InvalidRound,
        Stale,
        MarketClosed,
        AssetPaused
    }

    error PriceUnavailable(Status status);

    /// Harga LIVE per token dalam USD, 18 desimal. Hanya saat sesi tidak Closed dan harga segar menurut jendela
    /// staleness sesi saat ini. Untuk operasi yang butuh harga segar (mint/redeem USDG, Pruning).
    /// Revert `PriceUnavailable(status)` bila tidak valid.
    function getPrice(address token) external view returns (uint256 priceE18, uint256 updatedAt);

    /// Seperti `getPrice` tetapi tidak pernah revert karena kondisi oracle.
    function tryGetPrice(address token) external view returns (Status status, uint256 priceE18, uint256 updatedAt);

    /// Harga ACUAN: seperti `getPrice`, tetapi saat sesi Closed harga yang ditahan feed diterima bila masih segar
    /// pada saat pasar tutup. Untuk tampilan NAV dan redeem in-kind; bukan untuk operasi yang butuh harga live.
    function getReferencePrice(address token)
        external
        view
        returns (uint256 priceE18, uint256 updatedAt, IMarketSession.Session session);

    function tryGetReferencePrice(address token)
        external
        view
        returns (Status status, uint256 priceE18, uint256 updatedAt, IMarketSession.Session session);

    /// True bila aset dijeda GUARDIAN/ADMIN (jeda per aset, terpisah dari flag `oraclePaused()` milik token).
    /// Aset yang dijeda: harga tidak tersedia (`Status.AssetPaused`), mint Cordon yang memuatnya ditolak, dan
    /// settlement ditunda. Keluar in-kind dari vault tidak pernah ditutup oleh jeda ini.
    function isAssetPaused(address token) external view returns (bool);

    /// Feed dan flag pause yang terdaftar untuk `token` (feed = address(0) bila tidak terdaftar).
    function feedOf(address token) external view returns (address feed, bool checkOraclePause);

    /// Titik acuan kesegaran untuk `token` pada waktu `ts`: `refTime` = `ts` bila sesi terbuka, atau awal periode
    /// tutup bila Closed; `window` = jendela staleness sesi pada `refTime`. Harga dengan `updatedAt` segar bila
    /// `updatedAt >= refTime` atau `refTime - updatedAt <= window`. `refTime == 0` = tidak diketahui (anggap tidak segar).
    function freshnessReference(address token, uint256 ts)
        external
        view
        returns (uint256 refTime, uint32 window, IMarketSession.Session session);
}
