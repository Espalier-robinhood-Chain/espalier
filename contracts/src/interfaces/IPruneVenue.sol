// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// Tempat menukar satu komponen Cordon ke komponen lain saat pruning (`CordonVault.prune`).
/// Venue menarik `amountIn` dari pemanggil lewat `transferFrom` (pemanggil sudah approve tepat `amountIn`) dan
/// mengirim `tokenOut` langsung ke `to`. Venue dipasang ADMIN dan tidak dipercaya untuk harga: vault memeriksa
/// sendiri jumlah yang benar-benar masuk terhadap harga oracle live, apa pun yang dilaporkan venue.
interface IPruneVenue {
    /// Tukar tepat `amountIn` dari `tokenIn` ke `tokenOut`; revert bila hasil < `minAmountOut`.
    function swap(address tokenIn, address tokenOut, uint256 amountIn, uint256 minAmountOut, address to)
        external
        returns (uint256 amountOut);
}
