// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// Bagian Stock Token Robinhood Chain yang dibaca router (dari dokumentasi, belum diuji di chain).
/// `uiMultiplier()` (ERC-8056) sengaja tidak dipakai: harga feed sudah per token (harga ekuitas x multiplier).
interface IStockToken {
    /// Advisory: true saat oracle di-pause selama corporate action besar. Tidak dipaksa onchain.
    function oraclePaused() external view returns (bool);
}
