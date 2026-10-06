// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IStockToken} from "../../src/interfaces/IStockToken.sol";

contract MockStockToken is IStockToken {
    bool public paused;
    bool public failPausedCall;
    uint256 public uiMultiplier = 1e18;

    function setPaused(bool v) external {
        paused = v;
    }

    function setFailPausedCall(bool v) external {
        failPausedCall = v;
    }

    function setUiMultiplier(uint256 v) external {
        uiMultiplier = v;
    }

    function oraclePaused() external view returns (bool) {
        require(!failPausedCall, "no oraclePaused");
        return paused;
    }
}
