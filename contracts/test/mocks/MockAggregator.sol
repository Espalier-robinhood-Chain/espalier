// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IAggregatorV3} from "../../src/interfaces/IAggregatorV3.sol";

/// Mock feed Chainlink dengan riwayat round; juga dipakai sebagai mock Sequencer Uptime Feed.
contract MockAggregator is IAggregatorV3 {
    struct RoundData {
        int256 answer;
        uint256 startedAt;
        uint256 updatedAt;
        uint80 answeredInRound;
    }

    uint8 private _decimals;
    uint80 public roundId;
    int256 public answer;
    uint256 public startedAt;
    uint256 public updatedAt;
    uint80 public answeredInRound;
    bool public failLatest;
    bool public failDecimals;
    mapping(uint80 => RoundData) public rounds;

    constructor(uint8 decimals_) {
        _decimals = decimals_;
    }

    /// Round baru yang sehat: roundId naik, updatedAt = sekarang.
    function setRound(int256 answer_) external {
        pushRound(answer_, block.timestamp);
    }

    /// Round baru dengan updatedAt tertentu (riwayat untuk uji settlement). roundId = roundId + 1.
    function pushRound(int256 answer_, uint256 updatedAt_) public {
        _store(roundId + 1, answer_, updatedAt_, updatedAt_, roundId + 1);
    }

    /// Round dengan roundId bebas (mis. batas fase Chainlink: (fase << 64) | nomor). Menjadi round terbaru.
    function setRaw(uint80 roundId_, int256 answer_, uint256 startedAt_, uint256 updatedAt_, uint80 answeredInRound_)
        external
    {
        _store(roundId_, answer_, startedAt_, updatedAt_, answeredInRound_);
    }

    function _store(uint80 roundId_, int256 answer_, uint256 startedAt_, uint256 updatedAt_, uint80 air_) internal {
        roundId = roundId_;
        answer = answer_;
        startedAt = startedAt_;
        updatedAt = updatedAt_;
        answeredInRound = air_;
        rounds[roundId_] = RoundData(answer_, startedAt_, updatedAt_, air_);
    }

    function setFailLatest(bool v) external {
        failLatest = v;
    }

    function setFailDecimals(bool v) external {
        failDecimals = v;
    }

    function getRoundData(uint80 roundId_) external view returns (uint80, int256, uint256, uint256, uint80) {
        RoundData memory d = rounds[roundId_];
        require(d.updatedAt != 0, "No data present");
        return (roundId_, d.answer, d.startedAt, d.updatedAt, d.answeredInRound);
    }

    function latestRoundData() external view returns (uint80, int256, uint256, uint256, uint80) {
        require(!failLatest, "feed down");
        return (roundId, answer, startedAt, updatedAt, answeredInRound);
    }

    function decimals() external view returns (uint8) {
        require(!failDecimals, "decimals down");
        return _decimals;
    }
}
