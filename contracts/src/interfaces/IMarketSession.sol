// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// Sesi pasar Stock Token (feed 24/5, jam New York). Dibaca OracleRouter, SettlementOracle, dan nanti CordonVault/SpurVault.
interface IMarketSession {
    /// Closed = akhir pekan atau libur. Overnight/Extended/Regular = feed aktif (ketebalan likuiditas berbeda).
    enum Session {
        Closed,
        Overnight,
        Extended,
        Regular
    }

    /// Sesi pada waktu `ts` (detik UTC). Tidak pernah revert; `ts` di luar 2007-2099 dianggap Closed.
    function sessionAt(uint256 ts) external view returns (Session);

    /// Bila `ts` tidak Closed: `ts`. Bila Closed: waktu UTC saat sesi terakhir berakhir (awal periode tutup saat ini).
    /// 0 bila tidak ditemukan dalam jendela pencarian (periode tutup terlalu panjang atau `ts` terlalu awal).
    function lastOpenEnd(uint256 ts) external view returns (uint256);
}
