// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

interface ISettlementOracle {
    /// Print = round Chainlink pertama dengan updatedAt >= expiry (dalam batas `maxPrintDelay`).
    /// LastBeforeExpiry = round terakhir sebelum expiry, hanya bila tidak ada print dalam batas waktu.
    enum Kind {
        Print,
        LastBeforeExpiry
    }

    struct Settlement {
        uint256 priceE18; // per token, 18 desimal
        uint256 roundUpdatedAt; // updatedAt round yang dipakai
        uint80 roundId;
        uint64 settledAt; // block.timestamp saat dicatat
        Kind kind;
        bool exists;
    }

    event Settled(
        address indexed token,
        uint64 indexed expiry,
        uint80 roundId,
        uint256 priceE18,
        uint256 roundUpdatedAt,
        Kind kind
    );

    /// Harga settlement yang sudah dicatat untuk (token, expiry). `exists == false` bila belum.
    function settlement(address token, uint64 expiry) external view returns (Settlement memory);
}
