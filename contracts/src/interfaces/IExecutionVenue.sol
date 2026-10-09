// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// Tempat menjual komponen Cordon ke USDG. Dipakai `CordonVault.redeemToUsdg`.
/// Venue menarik token dari pemanggil lewat `transferFrom` (pemanggil sudah approve tepat `amounts[i]`)
/// dan membayar USDG langsung ke `to`. Harga yang dipakai venue harus harga LIVE (revert bila tidak tersedia).
interface IExecutionVenue {
    /// Token USDG yang dibayarkan venue.
    function USDG() external view returns (address);

    /// USDG yang akan diterima bila `amounts[i]` dari `tokens[i]` dijual sekarang. Revert bila harga live tidak tersedia.
    function quoteSell(address[] calldata tokens, uint256[] calldata amounts) external view returns (uint256 usdgOut);

    /// Jual `amounts[i]` dari `tokens[i]` (ditarik dari `msg.sender`), bayar USDG ke `to`. Entri bernilai 0 dilewati.
    function sell(address[] calldata tokens, uint256[] calldata amounts, address to) external returns (uint256 usdgOut);
}
