// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {IOracleRouter} from "../../src/interfaces/IOracleRouter.sol";
import {IPruneVenue} from "../../src/interfaces/IPruneVenue.sol";

interface IMintable {
    function mint(address to, uint256 amount) external;
}

/// Venue pruning MOCK (testnet/uji): menukar pada harga LIVE oracle dikurangi `spreadBps`, lalu MENCETAK tokenOut
/// (token mock punya `mint` publik, jadi venue tidak perlu didanai). `pullBps` < 10000 mensimulasikan venue yang
/// menarik lebih sedikit dari `amountIn`; `ignoreMin` mensimulasikan venue yang mengabaikan `minAmountOut`
/// (vault harus tetap menolak lewat pemeriksaan saldonya sendiri). BUKAN likuiditas pasar sungguhan.
contract MockPruneVenue is IPruneVenue {
    using SafeERC20 for IERC20;

    uint256 public constant BPS = 10_000;

    IOracleRouter public immutable ROUTER;
    uint256 public spreadBps;
    uint256 public pullBps = BPS;
    bool public ignoreMin;

    constructor(address router_, uint256 spreadBps_) {
        ROUTER = IOracleRouter(router_);
        spreadBps = spreadBps_;
    }

    function setSpreadBps(uint256 v) external {
        spreadBps = v;
    }

    function setIgnoreMin(bool v) external {
        ignoreMin = v;
    }

    function setPullBps(uint256 v) external {
        pullBps = v;
    }

    function quote(address tokenIn, address tokenOut, uint256 amountIn) public view returns (uint256) {
        (uint256 pIn,) = ROUTER.getPrice(tokenIn);
        (uint256 pOut,) = ROUTER.getPrice(tokenOut);
        uint256 dIn = IERC20Metadata(tokenIn).decimals();
        uint256 dOut = IERC20Metadata(tokenOut).decimals();
        uint256 gross = Math.mulDiv(amountIn * pIn, 10 ** dOut, pOut * 10 ** dIn);
        return Math.mulDiv(gross, BPS - spreadBps, BPS);
    }

    function swap(address tokenIn, address tokenOut, uint256 amountIn, uint256 minAmountOut, address to)
        external
        returns (uint256 amountOut)
    {
        amountOut = quote(tokenIn, tokenOut, amountIn);
        require(ignoreMin || amountOut >= minAmountOut, "MockPruneVenue: min out");
        IERC20(tokenIn).safeTransferFrom(msg.sender, address(this), Math.mulDiv(amountIn, pullBps, BPS));
        IMintable(tokenOut).mint(to, amountOut);
    }
}
