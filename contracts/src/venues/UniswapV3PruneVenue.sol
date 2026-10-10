// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {IPruneVenue} from "../interfaces/IPruneVenue.sol";

/// SwapRouter02 (Uniswap v3), hanya fungsi yang dipakai. Tanpa `deadline` (beda dari SwapRouter v1).
interface ISwapRouter02 {
    struct ExactInputParams {
        bytes path;
        address recipient;
        uint256 amountIn;
        uint256 amountOutMinimum;
    }

    function exactInput(ExactInputParams calldata params) external payable returns (uint256 amountOut);
}

/// Venue pruning untuk CordonVault di mainnet: menukar komponen A -> USDG -> komponen B lewat Uniswap v3 (SwapRouter02).
/// Rute tetap dua lompatan lewat USDG, karena pool Stock Token berpasangan dengan USDG (bukan saling berpasangan).
///
/// Keamanan (lihat CordonVault.prune): venue TIDAK dipercaya untuk harga. Vault memeriksa sendiri (a) jumlah yang masuk
/// >= nilai oracle - pruneSlippageBps, (b) tepat `amountIn` yang keluar, (c) drift berkurang. Kontrak ini tidak menyimpan
/// dana: tiap swap menarik `amountIn`, menukarnya, dan mengirim hasilnya langsung ke `to`. Siapa pun boleh memanggil `swap`
/// dengan token miliknya sendiri; itu tidak berbahaya.
/// Pemilik (Safe) hanya mengatur tingkat fee pool tiap token, dan bisa `sweep` bila ada token nyasar.
/// BELUM DIAUDIT dan BELUM DIKOMPILASI di lingkungan pembuatan.
contract UniswapV3PruneVenue is IPruneVenue {
    using SafeERC20 for IERC20;

    ISwapRouter02 public immutable ROUTER;
    address public immutable USDG;

    address public owner;
    address public pendingOwner;
    /// Fee pool v3 (100, 500, 3000, 10000) antara token dan USDG. 0 = token tidak didukung.
    mapping(address => uint24) public feeToUsdg;

    event FeeSet(address indexed token, uint24 fee);
    event OwnershipTransferStarted(address indexed owner, address indexed pendingOwner);
    event OwnershipTransferred(address indexed oldOwner, address indexed newOwner);

    error NotOwner();
    error NotPendingOwner();
    error ZeroAddress();
    error BadFee(uint24 fee);
    error BadToken(address token);
    error RouteNotSet(address token);
    error LengthMismatch();

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    constructor(address router_, address usdg_, address owner_, address[] memory tokens, uint24[] memory fees) {
        if (router_ == address(0) || usdg_ == address(0) || owner_ == address(0)) revert ZeroAddress();
        if (router_.code.length == 0) revert BadToken(router_);
        if (usdg_.code.length == 0) revert BadToken(usdg_);
        if (tokens.length != fees.length) revert LengthMismatch();
        ROUTER = ISwapRouter02(router_);
        USDG = usdg_;
        owner = owner_;
        emit OwnershipTransferred(address(0), owner_);
        for (uint256 i; i < tokens.length; ++i) {
            _setFee(tokens[i], fees[i]);
        }
    }

    // ------------------------------------------------------------------ pemilik

    function setFee(address token, uint24 fee) external onlyOwner {
        _setFee(token, fee);
    }

    function _setFee(address token, uint24 fee) internal {
        if (token == address(0) || token == USDG || token.code.length == 0) revert BadToken(token);
        if (fee != 0 && fee != 100 && fee != 500 && fee != 3000 && fee != 10000) revert BadFee(fee);
        feeToUsdg[token] = fee;
        emit FeeSet(token, fee);
    }

    function transferOwnership(address newOwner) external onlyOwner {
        if (newOwner == address(0)) revert ZeroAddress();
        pendingOwner = newOwner;
        emit OwnershipTransferStarted(owner, newOwner);
    }

    function acceptOwnership() external {
        if (msg.sender != pendingOwner) revert NotPendingOwner();
        emit OwnershipTransferred(owner, msg.sender);
        owner = msg.sender;
        pendingOwner = address(0);
    }

    /// Ambil token yang nyasar ke kontrak ini (venue tidak seharusnya menyimpan saldo).
    function sweep(address token, address to) external onlyOwner {
        if (to == address(0)) revert ZeroAddress();
        IERC20(token).safeTransfer(to, IERC20(token).balanceOf(address(this)));
    }

    // -------------------------------------------------------------------- swap

    /// @inheritdoc IPruneVenue
    function swap(address tokenIn, address tokenOut, uint256 amountIn, uint256 minAmountOut, address to)
        external
        returns (uint256 amountOut)
    {
        if (to == address(0)) revert ZeroAddress();
        uint24 feeIn = feeToUsdg[tokenIn];
        uint24 feeOut = feeToUsdg[tokenOut];
        if (feeIn == 0) revert RouteNotSet(tokenIn);
        if (feeOut == 0) revert RouteNotSet(tokenOut);

        IERC20(tokenIn).safeTransferFrom(msg.sender, address(this), amountIn);
        IERC20(tokenIn).forceApprove(address(ROUTER), amountIn);
        // Jalur v3: token(20) fee(3) token(20) fee(3) token(20). uint24 dikemas 3 byte.
        bytes memory path = abi.encodePacked(tokenIn, feeIn, USDG, feeOut, tokenOut);
        amountOut = ROUTER.exactInput(
            ISwapRouter02.ExactInputParams({path: path, recipient: to, amountIn: amountIn, amountOutMinimum: minAmountOut})
        );
        IERC20(tokenIn).forceApprove(address(ROUTER), 0);
    }
}
