// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// Subset AggregatorV3Interface Chainlink yang dipakai router.
/// Juga dipakai untuk L2 Sequencer Uptime Feed (answer 0 = up, 1 = down; startedAt = waktu status terakhir berubah).
interface IAggregatorV3 {
    function decimals() external view returns (uint8);

    /// Revert (atau updatedAt == 0) bila round tidak ada.
    function getRoundData(uint80 roundId_)
        external
        view
        returns (uint80 roundId, int256 answer, uint256 startedAt, uint256 updatedAt, uint80 answeredInRound);

    function latestRoundData()
        external
        view
        returns (uint80 roundId, int256 answer, uint256 startedAt, uint256 updatedAt, uint80 answeredInRound);
}
