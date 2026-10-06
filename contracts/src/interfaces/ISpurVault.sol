// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/// Bagian SpurVault yang dibaca dan dipanggil `HarvestAuction`.
interface ISpurVault {
    /// Satu-satunya alamat yang boleh mencatat penjualan opsi (`recordSale`).
    function AUCTION() external view returns (address);

    /// Token premium (USDG). Auction memindahkannya dari Picker ke vault sebelum `recordSale`.
    function PREMIUM() external view returns (IERC20);

    /// Mencatat penjualan opsi round aktif. Revert bila parameter tidak sama dengan round, sudah terjual, atau
    /// premium (yang sudah dipindahkan ke vault) kurang dari lantai premium round.
    function recordSale(
        address picker,
        uint64 round,
        uint256 strikeE18,
        uint64 expiry,
        uint256 notional,
        uint256 premium
    ) external;
}
