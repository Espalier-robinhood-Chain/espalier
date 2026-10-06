// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

library PriceMath {
    uint8 internal constant PRICE_DECIMALS = 18;
    uint8 internal constant MAX_FEED_DECIMALS = 36;

    /// Skala jawaban feed (`d` desimal) ke 18 desimal, dibulatkan ke bawah. false bila overflow atau hasil jadi nol.
    // slither-disable-next-line divide-before-multiply
    function toE18(uint256 answer, uint8 d) internal pure returns (bool, uint256) {
        uint256 p = answer;
        if (d < PRICE_DECIMALS) {
            uint256 f = 10 ** (PRICE_DECIMALS - d);
            if (p > type(uint256).max / f) return (false, 0);
            p *= f;
        } else if (d > PRICE_DECIMALS) {
            p /= 10 ** (d - PRICE_DECIMALS);
        }
        return (p != 0, p);
    }
}
