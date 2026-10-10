// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {MockERC20} from "./mocks/MockERC20.sol";
import {UniswapV3PruneVenue, ISwapRouter02} from "../src/venues/UniswapV3PruneVenue.sol";

/// Router palsu: membaca jalur v3, menarik amountIn dari pemanggil, dan mencetak tokenOut dengan rasio `rateBps`.
contract FakeSwapRouter02 {
    uint256 public rateBps = 10_000;
    bytes public lastPath;

    function setRate(uint256 v) external {
        rateBps = v;
    }

    function exactInput(ISwapRouter02.ExactInputParams calldata p) external payable returns (uint256 out) {
        lastPath = p.path;
        require(p.path.length == 20 + 3 + 20 + 3 + 20, "path");
        address tin = address(bytes20(p.path[0:20]));
        address tout = address(bytes20(p.path[46:66]));
        IERC20(tin).transferFrom(msg.sender, address(this), p.amountIn);
        out = (p.amountIn * rateBps) / 10_000;
        require(out >= p.amountOutMinimum, "Too little received");
        MockERC20(tout).mint(p.recipient, out);
    }
}

contract UniswapV3PruneVenueTest is Test {
    FakeSwapRouter02 internal router;
    MockERC20 internal usdg;
    MockERC20 internal a;
    MockERC20 internal b;
    UniswapV3PruneVenue internal venue;
    address internal owner = address(0xA11CE);
    address internal caller = address(0xBEEF);

    function setUp() public {
        router = new FakeSwapRouter02();
        usdg = new MockERC20("USDG", "USDG", 6);
        a = new MockERC20("A", "A", 18);
        b = new MockERC20("B", "B", 18);
        address[] memory toks = new address[](2);
        toks[0] = address(a);
        toks[1] = address(b);
        uint24[] memory fees = new uint24[](2);
        fees[0] = 500;
        fees[1] = 3000;
        venue = new UniswapV3PruneVenue(address(router), address(usdg), owner, toks, fees);
        a.mint(caller, 100e18);
    }

    function test_swapSendsOutputToRecipientAndBuildsPath() public {
        vm.startPrank(caller);
        a.approve(address(venue), 10e18);
        uint256 out = venue.swap(address(a), address(b), 10e18, 9e18, caller);
        vm.stopPrank();
        assertEq(out, 10e18);
        assertEq(b.balanceOf(caller), 10e18);
        assertEq(a.balanceOf(caller), 90e18);
        assertEq(a.balanceOf(address(venue)), 0);
        assertEq(a.allowance(address(venue), address(router)), 0);
        assertEq(router.lastPath(), abi.encodePacked(address(a), uint24(500), address(usdg), uint24(3000), address(b)));
    }

    function test_revertsWhenOutputBelowMin() public {
        router.setRate(9_000);
        vm.startPrank(caller);
        a.approve(address(venue), 10e18);
        vm.expectRevert(bytes("Too little received"));
        venue.swap(address(a), address(b), 10e18, 10e18, caller);
        vm.stopPrank();
    }

    function test_revertsForUnsupportedToken() public {
        MockERC20 c = new MockERC20("C", "C", 18);
        c.mint(caller, 1e18);
        vm.startPrank(caller);
        c.approve(address(venue), 1e18);
        vm.expectRevert(abi.encodeWithSelector(UniswapV3PruneVenue.RouteNotSet.selector, address(c)));
        venue.swap(address(c), address(a), 1e18, 0, caller);
        vm.stopPrank();
    }

    function test_onlyOwnerSetsFee() public {
        vm.prank(caller);
        vm.expectRevert(UniswapV3PruneVenue.NotOwner.selector);
        venue.setFee(address(a), 100);
        vm.prank(owner);
        venue.setFee(address(a), 100);
        assertEq(venue.feeToUsdg(address(a)), 100);
    }

    function test_rejectsBadFeeAndUsdgAsToken() public {
        vm.startPrank(owner);
        vm.expectRevert(abi.encodeWithSelector(UniswapV3PruneVenue.BadFee.selector, uint24(42)));
        venue.setFee(address(a), 42);
        vm.expectRevert(abi.encodeWithSelector(UniswapV3PruneVenue.BadToken.selector, address(usdg)));
        venue.setFee(address(usdg), 500);
        vm.stopPrank();
    }

    function test_twoStepOwnershipAndSweep() public {
        vm.prank(owner);
        venue.transferOwnership(caller);
        vm.expectRevert(UniswapV3PruneVenue.NotPendingOwner.selector);
        venue.acceptOwnership();
        vm.prank(caller);
        venue.acceptOwnership();
        assertEq(venue.owner(), caller);

        a.mint(address(venue), 5e18);
        vm.prank(caller);
        venue.sweep(address(a), caller);
        assertEq(a.balanceOf(address(venue)), 0);
    }
}
