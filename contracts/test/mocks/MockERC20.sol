// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/// ERC-20 uji: bisa memblokir transfer keluar (mis. di-pause), menarik fee, atau memanggil balik saat transfer.
contract MockERC20 is ERC20 {
    uint8 private immutable DEC;
    bool public blockedOut; // transfer dari vault (apa pun dari `blockedFrom`) revert
    address public blockedFrom;
    uint256 public feeBps; // fee yang dibakar dari jumlah yang diterima
    address public hookTarget;
    bytes public hookData;

    constructor(string memory n, string memory s, uint8 d) ERC20(n, s) {
        DEC = d;
    }

    function decimals() public view override returns (uint8) {
        return DEC;
    }

    function mint(address to, uint256 amt) external {
        _mint(to, amt);
    }

    function setBlocked(address from, bool v) external {
        blockedFrom = from;
        blockedOut = v;
    }

    function setFeeBps(uint256 v) external {
        feeBps = v;
    }

    function setHook(address target, bytes calldata data) external {
        hookTarget = target;
        hookData = data;
    }

    function _update(address from, address to, uint256 value) internal override {
        if (blockedOut && from == blockedFrom && from != address(0)) revert("blocked");
        if (feeBps != 0 && from != address(0) && to != address(0)) {
            uint256 fee = value * feeBps / 10_000;
            super._update(from, address(0), fee);
            value -= fee;
        }
        super._update(from, to, value);
        if (hookTarget != address(0) && from != address(0)) {
            address t = hookTarget;
            hookTarget = address(0); // satu kali
            (bool ok, bytes memory ret) = t.call(hookData);
            if (!ok) {
                assembly {
                    revert(add(ret, 32), mload(ret))
                }
            }
        }
    }
}
