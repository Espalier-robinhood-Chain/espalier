// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {IOracleRouter} from "../../src/interfaces/IOracleRouter.sol";
import {IExecutionVenue} from "../../src/interfaces/IExecutionVenue.sol";

interface IMintableToken {
    function mint(address to, uint256 amount) external;
}

/// Venue MOCK (testnet/uji): "menjual" komponen ke USDG pada harga LIVE oracle dikurangi spread, lalu MENCETAK USDG
/// ke penerima (USDG mock punya `mint` publik, jadi venue tidak perlu didanai). BUKAN likuiditas pasar sungguhan.
/// Harga memakai `getPrice` (live): saat pasar tutup atau harga basi, kuotasi dan jual revert.
contract MockExecutionVenue is IExecutionVenue, Ownable {
    using SafeERC20 for IERC20;

    uint256 public constant BPS = 10_000;
    uint256 public constant MAX_SPREAD_BPS = 500;

    error InvalidConfig();
    error LengthMismatch();
    error SpreadTooHigh();

    event SpreadSet(uint256 spreadBps);

    IOracleRouter public immutable ROUTER;
    address public immutable USDG;
    uint8 private immutable USDG_DECIMALS;
    uint256 public spreadBps;

    constructor(address router_, address usdg_, address owner_, uint256 spreadBps_) Ownable(owner_) {
        if (router_.code.length == 0 || usdg_.code.length == 0) revert InvalidConfig();
        uint8 d = IERC20Metadata(usdg_).decimals();
        if (d > 18) revert InvalidConfig();
        if (spreadBps_ > MAX_SPREAD_BPS) revert SpreadTooHigh();
        ROUTER = IOracleRouter(router_);
        USDG = usdg_;
        USDG_DECIMALS = d;
        spreadBps = spreadBps_;
        emit SpreadSet(spreadBps_);
    }

    function setSpreadBps(uint256 spreadBps_) external onlyOwner {
        if (spreadBps_ > MAX_SPREAD_BPS) revert SpreadTooHigh();
        spreadBps = spreadBps_;
        emit SpreadSet(spreadBps_);
    }

    function quoteSell(address[] calldata tokens, uint256[] calldata amounts) external view returns (uint256 usdgOut) {
        if (tokens.length != amounts.length) revert LengthMismatch();
        for (uint256 i; i < tokens.length; ++i) {
            usdgOut += _value(tokens[i], amounts[i]);
        }
    }

    function sell(address[] calldata tokens, uint256[] calldata amounts, address to) external returns (uint256 usdgOut) {
        if (tokens.length != amounts.length) revert LengthMismatch();
        for (uint256 i; i < tokens.length; ++i) {
            if (amounts[i] == 0) continue;
            usdgOut += _value(tokens[i], amounts[i]);
            IERC20(tokens[i]).safeTransferFrom(msg.sender, address(this), amounts[i]);
        }
        if (usdgOut != 0) IMintableToken(USDG).mint(to, usdgOut);
    }

    /// Nilai `amount` token dalam satuan USDG: amount x harga live (USD 18 desimal), dikurangi spread, dibulatkan ke bawah.
    function _value(address token, uint256 amount) internal view returns (uint256) {
        if (amount == 0) return 0;
        (uint256 priceE18,) = ROUTER.getPrice(token);
        uint256 dec = IERC20Metadata(token).decimals();
        uint256 gross = Math.mulDiv(amount, priceE18, 10 ** (dec + 18 - USDG_DECIMALS));
        return Math.mulDiv(gross, BPS - spreadBps, BPS);
    }
}
