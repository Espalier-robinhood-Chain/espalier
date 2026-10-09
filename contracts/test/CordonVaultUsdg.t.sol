// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IAccessControl} from "@openzeppelin/contracts/access/IAccessControl.sol";
import {CordonVault} from "../src/CordonVault.sol";
import {MockERC20} from "./mocks/MockERC20.sol";
import {MockExecutionVenue} from "./mocks/MockExecutionVenue.sol";
import {CordonVaultBase} from "./CordonVault.t.sol";

/// `redeemToUsdg` + `setExecutionVenue` (redeem ke USDG lewat venue). Harga uji: AAA $100, BBB $50, CCC $10.
/// Seed `_seed()`: 100 share = 10 AAA + 20 BBB + 50 CCC = $2.500, jadi NAV $25 per share.
contract CordonVaultUsdgTest is CordonVaultBase {
    MockERC20 internal usdg;
    MockExecutionVenue internal venue;
    address internal treasury = makeAddr("treasury");

    function setUp() public override {
        super.setUp();
        usdg = new MockERC20("USDG", "USDG", 6);
        venue = new MockExecutionVenue(address(router), address(usdg), admin, 0);
    }

    function _enableVenue() internal {
        vm.prank(admin);
        vault.setExecutionVenue(address(venue));
    }

    function _unauthorized(address who) internal view returns (bytes memory) {
        return abi.encodeWithSelector(
            IAccessControl.AccessControlUnauthorizedAccount.selector, who, vault.DEFAULT_ADMIN_ROLE()
        );
    }

    // ------------------------------------------------------------ konfigurasi

    function test_disabledByDefault() public {
        _seed();
        assertEq(address(vault.executionVenue()), address(0));
        assertEq(address(vault.usdgToken()), address(0));
        vm.expectRevert(CordonVault.VenueNotSet.selector);
        vault.previewRedeemToUsdg(1e18);
        vm.expectRevert(CordonVault.VenueNotSet.selector);
        vm.prank(admin);
        vault.redeemToUsdg(1e18, bob, 0);
    }

    function test_setExecutionVenue_authAndState() public {
        vm.expectRevert(_unauthorized(alice));
        vm.prank(alice);
        vault.setExecutionVenue(address(venue));

        vm.expectEmit(true, true, false, false, address(vault));
        emit CordonVault.ExecutionVenueSet(address(venue), address(usdg));
        _enableVenue();
        assertEq(address(vault.executionVenue()), address(venue));
        assertEq(address(vault.usdgToken()), address(usdg));

        vm.prank(admin);
        vault.setExecutionVenue(address(0)); // mematikan
        assertEq(address(vault.executionVenue()), address(0));
        assertEq(address(vault.usdgToken()), address(0));
    }

    function test_setExecutionVenue_rejectsInvalid() public {
        vm.startPrank(admin);
        vm.expectRevert(CordonVault.InvalidVenue.selector);
        vault.setExecutionVenue(address(vault)); // vault sendiri
        vm.expectRevert(CordonVault.InvalidVenue.selector);
        vault.setExecutionVenue(makeAddr("eoa")); // tanpa kode
        // USDG venue = salah satu komponen vault: ditolak
        MockExecutionVenue bad = new MockExecutionVenue(address(router), address(tk[0]), admin, 0);
        vm.expectRevert(CordonVault.InvalidVenue.selector);
        vault.setExecutionVenue(address(bad));
        vm.stopPrank();
    }

    // ----------------------------------------------------------------- redeem

    function test_redeemToUsdg_paysOracleValueAndBurnsShares() public {
        _seed();
        _enableVenue();
        // 10 share = 10% => 1 AAA ($100) + 2 BBB ($100) + 5 CCC ($50) = $250
        assertEq(vault.previewRedeemToUsdg(10e18), 250e6);

        vm.prank(admin);
        (uint256 out, uint256[] memory amts) = vault.redeemToUsdg(10e18, bob, 250e6);
        assertEq(out, 250e6);
        assertEq(amts[0], 1e18);
        assertEq(amts[1], 2e18);
        assertEq(amts[2], 5e6);
        assertEq(usdg.balanceOf(bob), 250e6);
        assertEq(usdg.balanceOf(address(vault)), 0); // vault tidak menahan USDG
        assertEq(vault.totalSupply(), 90e18);
        assertEq(vault.balanceOf(admin), 90e18);
        // komponen berpindah ke venue; vault menyusut proporsional
        assertEq(tk[0].balanceOf(address(venue)), 1e18);
        assertEq(tk[0].balanceOf(address(vault)), 9e18);
        assertEq(tk[1].balanceOf(address(venue)), 2e18);
        assertEq(tk[2].balanceOf(address(venue)), 5e6);
        // allowance ke venue dibersihkan
        assertEq(tk[0].allowance(address(vault), address(venue)), 0);
        // NAV per share tidak berubah oleh redeem proporsional
        (, uint256 navPerShare) = vault.nav();
        assertEq(navPerShare, 25e18);
    }

    function test_redeemToUsdg_venueSpreadLowersPayout() public {
        _seed();
        _enableVenue();
        vm.prank(admin);
        venue.setSpreadBps(100); // 1%
        assertEq(vault.previewRedeemToUsdg(10e18), 247_500_000 - 0); // 250e6 dikurangi 1% per komponen
        vm.prank(admin);
        (uint256 out,) = vault.redeemToUsdg(10e18, bob, 0);
        assertEq(out, 247_500_000);
        assertEq(usdg.balanceOf(bob), 247_500_000);
    }

    function test_redeemToUsdg_chargesRedeemFeeInShares() public {
        _seed();
        _enableVenue();
        vm.startPrank(admin);
        vault.setFeeRecipient(treasury);
        vault.setFees(0, 100, 0); // fee redeem 1%
        vm.stopPrank();

        uint256 fee = vault.feeOnRedeem(10e18); // 0,1 share
        assertEq(fee, 0.1e18);
        uint256 quote = vault.previewRedeemToUsdg(10e18); // dari 9,9 share bersih
        assertEq(quote, 247_500_000);

        vm.prank(admin);
        (uint256 out,) = vault.redeemToUsdg(10e18, bob, quote);
        assertEq(out, quote);
        assertEq(vault.balanceOf(treasury), fee); // fee dibayar dalam share
        assertEq(vault.balanceOf(admin), 90e18);
        assertEq(vault.totalSupply(), 90e18 + fee);
    }

    function test_redeemToUsdg_slippageProtection() public {
        _seed();
        _enableVenue();
        uint256 quote = vault.previewRedeemToUsdg(10e18);
        vm.expectRevert(abi.encodeWithSelector(CordonVault.UsdgSlippage.selector, quote, quote + 1));
        vm.prank(admin);
        vault.redeemToUsdg(10e18, bob, quote + 1);
        assertEq(vault.balanceOf(admin), 100e18); // semuanya dibatalkan
    }

    function test_redeemToUsdg_revertsWhenMarketClosed() public {
        _seed();
        _enableVenue();
        vm.warp(FRI + 1 days + 12 hours); // Sabtu, Closed: harga live tidak tersedia
        vm.expectRevert();
        vault.previewRedeemToUsdg(10e18);
        vm.expectRevert();
        vm.prank(admin);
        vault.redeemToUsdg(10e18, bob, 0);
        // keluar in-kind tetap tersedia
        vm.prank(admin);
        vault.redeem(10e18, bob, 7, _amounts(0, 0, 0));
        assertEq(tk[0].balanceOf(bob), 1e18);
    }

    function test_redeemToUsdg_inputValidation() public {
        _seed();
        _enableVenue();
        vm.startPrank(admin);
        vm.expectRevert(CordonVault.ZeroAmount.selector);
        vault.redeemToUsdg(0, bob, 0);
        vm.expectRevert(CordonVault.ZeroAddress.selector);
        vault.redeemToUsdg(1e18, address(0), 0);
        vm.stopPrank();
        // pemanggil tanpa share
        vm.expectRevert();
        vm.prank(alice);
        vault.redeemToUsdg(1e18, alice, 0);
    }

    function test_redeemToUsdg_holderOtherThanSeeder() public {
        _seed();
        _enableVenue();
        vm.prank(admin);
        vault.transfer(alice, 20e18);
        uint256 quote = vault.previewRedeemToUsdg(20e18); // 20% = $500
        assertEq(quote, 500e6);
        vm.prank(alice);
        (uint256 out,) = vault.redeemToUsdg(20e18, alice, quote);
        assertEq(out, 500e6);
        assertEq(usdg.balanceOf(alice), 500e6);
        assertEq(vault.balanceOf(alice), 0);
    }
}
