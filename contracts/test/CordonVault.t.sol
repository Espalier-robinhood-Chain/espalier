// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IAccessControl} from "@openzeppelin/contracts/access/IAccessControl.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {CordonVault} from "../src/CordonVault.sol";
import {OracleRouter} from "../src/OracleRouter.sol";
import {MarketSession} from "../src/MarketSession.sol";
import {IOracleRouter} from "../src/interfaces/IOracleRouter.sol";
import {MockAggregator} from "./mocks/MockAggregator.sol";
import {MockERC20} from "./mocks/MockERC20.sol";

contract CordonVaultBase is Test {
    uint256 internal constant FRI = 1_790_913_600; // Jumat 00:00 ET

    CordonVault internal vault;
    OracleRouter internal router;
    MarketSession internal market;
    MockAggregator internal seq;
    MockAggregator[3] internal feeds;
    MockERC20[3] internal tk; // AAA 18 desimal, BBB 18 desimal, CCC 6 desimal

    address internal admin = makeAddr("admin");
    address internal alice = makeAddr("alice");
    address internal bob = makeAddr("bob");

    function setUp() public virtual {
        vm.warp(FRI + 12 hours);
        market = new MarketSession(admin);
        seq = new MockAggregator(0);
        seq.setRaw(1, 0, FRI - 30 days, FRI - 30 days, 1);
        router = new OracleRouter(admin, address(seq), 1 hours, address(market));

        tk[0] = new MockERC20("AAA", "AAA", 18);
        tk[1] = new MockERC20("BBB", "BBB", 18);
        tk[2] = new MockERC20("CCC", "CCC", 6);
        uint256[3] memory px = [uint256(100e8), 50e8, 10e8]; // USD per token
        address[] memory comps = new address[](3);
        uint16[] memory w = new uint16[](3);
        w[0] = 5000;
        w[1] = 3000;
        w[2] = 2000;
        for (uint256 i; i < 3; i++) {
            feeds[i] = new MockAggregator(8);
            feeds[i].setRound(int256(px[i]));
            vm.prank(admin);
            router.setAsset(address(tk[i]), address(feeds[i]), 1 hours, false);
            comps[i] = address(tk[i]);
        }
        vault = new CordonVault(admin, address(router), "Cordon MAG7 test", "cT", comps, w);
    }

    function _amounts(uint256 a, uint256 b, uint256 c) internal pure returns (uint256[] memory x) {
        x = new uint256[](3);
        x[0] = a;
        x[1] = b;
        x[2] = c;
    }

    function _fund(address who, uint256 a, uint256 b, uint256 c) internal {
        tk[0].mint(who, a);
        tk[1].mint(who, b);
        tk[2].mint(who, c);
        vm.startPrank(who);
        for (uint256 i; i < 3; i++) {
            tk[i].approve(address(vault), type(uint256).max);
        }
        vm.stopPrank();
    }

    /// Seed: 100 share; 10 AAA, 20 BBB, 50 CCC (6 desimal).
    function _seed() internal {
        _fund(admin, 10e18, 20e18, 50e6);
        vm.prank(admin);
        vault.seed(100e18, admin, _amounts(10e18, 20e18, 50e6));
    }
}

contract CordonVaultTest is CordonVaultBase {
    // ------------------------------------------------------------ konstruktor

    function test_constructor_state() public view {
        assertEq(vault.componentCount(), 3);
        assertEq(vault.components()[2], address(tk[2]));
        assertEq(vault.targetWeightsBps()[0], 5000);
        assertEq(address(vault.ROUTER()), address(router));
        assertEq(vault.totalSupply(), 0);
    }

    function test_constructor_validation() public {
        address[] memory c = new address[](2);
        uint16[] memory w = new uint16[](2);
        c[0] = address(tk[0]);
        c[1] = address(tk[1]);
        w[0] = 6000;
        w[1] = 4000;

        vm.expectRevert(CordonVault.ZeroAddress.selector);
        new CordonVault(address(0), address(router), "n", "s", c, w);
        vm.expectRevert(CordonVault.ZeroAddress.selector);
        new CordonVault(admin, address(0), "n", "s", c, w);
        vm.expectRevert(CordonVault.InvalidComponents.selector);
        new CordonVault(admin, makeAddr("eoa"), "n", "s", c, w);

        address[] memory empty = new address[](0);
        uint16[] memory emptyW = new uint16[](0);
        vm.expectRevert(CordonVault.InvalidComponents.selector);
        new CordonVault(admin, address(router), "n", "s", empty, emptyW);

        uint16[] memory shortW = new uint16[](1);
        vm.expectRevert(CordonVault.LengthMismatch.selector);
        new CordonVault(admin, address(router), "n", "s", c, shortW);

        uint16[] memory badSum = new uint16[](2);
        badSum[0] = 6000;
        badSum[1] = 3999;
        vm.expectRevert(CordonVault.InvalidWeights.selector);
        new CordonVault(admin, address(router), "n", "s", c, badSum);
        uint16[] memory zeroW = new uint16[](2);
        zeroW[1] = 10_000;
        vm.expectRevert(CordonVault.InvalidWeights.selector);
        new CordonVault(admin, address(router), "n", "s", c, zeroW);

        address[] memory dup = new address[](2);
        dup[0] = address(tk[0]);
        dup[1] = address(tk[0]);
        vm.expectRevert(CordonVault.InvalidComponents.selector);
        new CordonVault(admin, address(router), "n", "s", dup, w);

        address[] memory noCode = new address[](2);
        noCode[0] = address(tk[0]);
        noCode[1] = makeAddr("eoa");
        vm.expectRevert(CordonVault.InvalidComponents.selector);
        new CordonVault(admin, address(router), "n", "s", noCode, w);

        address[] memory many = new address[](17);
        uint16[] memory manyW = new uint16[](17);
        vm.expectRevert(CordonVault.InvalidComponents.selector);
        new CordonVault(admin, address(router), "n", "s", many, manyW);

        MockERC20 big = new MockERC20("D", "D", 19);
        address[] memory bigC = new address[](1);
        bigC[0] = address(big);
        uint16[] memory oneW = new uint16[](1);
        oneW[0] = 10_000;
        vm.expectRevert(CordonVault.InvalidComponents.selector);
        new CordonVault(admin, address(router), "n", "s", bigC, oneW);
    }

    // ------------------------------------------------------------------- seed

    function test_seed_onlyAdminOnlyOnce() public {
        _fund(admin, 10e18, 20e18, 50e6);
        _fund(alice, 10e18, 20e18, 50e6);
        vm.expectRevert(
            abi.encodeWithSelector(
                IAccessControl.AccessControlUnauthorizedAccount.selector, alice, vault.DEFAULT_ADMIN_ROLE()
            )
        );
        vm.prank(alice);
        vault.seed(100e18, alice, _amounts(10e18, 20e18, 50e6));

        vm.expectEmit(true, true, false, true, address(vault));
        emit CordonVault.Seeded(admin, admin, 100e18, _amounts(10e18, 20e18, 50e6));
        vm.prank(admin);
        vault.seed(100e18, admin, _amounts(10e18, 20e18, 50e6));
        assertEq(vault.balanceOf(admin), 100e18);
        assertEq(tk[2].balanceOf(address(vault)), 50e6);

        _fund(admin, 1e18, 1e18, 1e6);
        vm.expectRevert(CordonVault.AlreadySeeded.selector);
        vm.prank(admin);
        vault.seed(100e18, admin, _amounts(1e18, 1e18, 1e6));
    }

    function test_seed_validation() public {
        _fund(admin, 10e18, 20e18, 50e6);
        vm.startPrank(admin);
        vm.expectRevert(CordonVault.SeedTooSmall.selector);
        vault.seed(1e18 - 1, admin, _amounts(1, 1, 1));
        vm.expectRevert(CordonVault.ZeroAddress.selector);
        vault.seed(1e18, address(0), _amounts(1, 1, 1));
        vm.expectRevert(CordonVault.LengthMismatch.selector);
        vault.seed(1e18, admin, new uint256[](2));
        vm.expectRevert(CordonVault.ZeroAmount.selector);
        vault.seed(1e18, admin, _amounts(1, 0, 1));
        vm.stopPrank();
    }

    function test_seed_donationBeforeSeedBelongsToSeeder() public {
        tk[0].mint(address(vault), 5e18); // donasi sebelum seed
        _seed();
        assertEq(tk[0].balanceOf(address(vault)), 15e18);
        assertEq(vault.balanceOf(admin), 100e18);
    }

    // ------------------------------------------------------------------- mint

    function test_mint_beforeSeedReverts() public {
        vm.expectRevert(CordonVault.NotSeeded.selector);
        vault.mint(1e18, alice, _amounts(1, 1, 1));
        vm.expectRevert(CordonVault.NotSeeded.selector);
        vault.previewMint(1e18);
    }

    function test_mint_proRataExact() public {
        _seed();
        _fund(alice, 100e18, 100e18, 100e6);
        uint256[] memory p = vault.previewMint(10e18); // 10% dari vault
        assertEq(p[0], 1e18);
        assertEq(p[1], 2e18);
        assertEq(p[2], 5e6);

        uint256[] memory max = _amounts(p[0], p[1], p[2]);
        vm.expectEmit(true, true, false, true, address(vault));
        emit CordonVault.Minted(alice, bob, 10e18, 0, p);
        vm.prank(alice);
        uint256[] memory paid = vault.mint(10e18, bob, max);
        assertEq(paid[1], 2e18);
        assertEq(vault.balanceOf(bob), 10e18);
        assertEq(tk[0].balanceOf(address(vault)), 11e18);
        assertEq(tk[2].balanceOf(address(vault)), 55e6);
        assertEq(tk[0].balanceOf(alice), 99e18);
    }

    function test_mint_roundsUpForVault() public {
        _seed();
        _fund(alice, 100e18, 100e18, 100e6);
        // 1 wei share: tiap komponen 10e18 * 1 / 100e18 = 0.1 -> naik ke 1 wei; CCC: 50e6 * 1 / 100e18 -> 1.
        uint256[] memory p = vault.previewMint(1);
        assertEq(p[0], 1);
        assertEq(p[1], 1);
        assertEq(p[2], 1);
    }

    function test_mint_slippageAndValidation() public {
        _seed();
        _fund(alice, 100e18, 100e18, 100e6);
        vm.startPrank(alice);
        vm.expectRevert(abi.encodeWithSelector(CordonVault.SlippageExceeded.selector, 1, 2e18, 2e18 - 1));
        vault.mint(10e18, alice, _amounts(1e18, 2e18 - 1, 5e6));
        vm.expectRevert(CordonVault.ZeroAmount.selector);
        vault.mint(0, alice, _amounts(1, 1, 1));
        vm.expectRevert(CordonVault.ZeroAddress.selector);
        vault.mint(1e18, address(0), _amounts(1e18, 1e18, 1e18));
        vm.expectRevert(CordonVault.LengthMismatch.selector);
        vault.mint(1e18, alice, new uint256[](2));
        vm.stopPrank();
    }

    function test_mint_rejectsFeeOnTransferComponent() public {
        _seed();
        _fund(alice, 100e18, 100e18, 100e6);
        tk[1].setFeeBps(100); // 1% hilang saat transfer
        vm.expectRevert(abi.encodeWithSelector(CordonVault.ShortReceipt.selector, 1, 1.98e18, 2e18));
        vm.prank(alice);
        vault.mint(10e18, alice, _amounts(1e18, 2e18, 5e6));
    }

    function test_mint_failsAtomicallyWhenAComponentTransferFails() public {
        _seed();
        _fund(alice, 100e18, 100e18, 100e6);
        tk[2].mint(alice, 0);
        vm.prank(alice);
        tk[2].approve(address(vault), 0); // allowance kurang pada komponen terakhir
        vm.expectRevert();
        vm.prank(alice);
        vault.mint(10e18, alice, _amounts(1e18, 2e18, 5e6));
        assertEq(vault.totalSupply(), 100e18);
        assertEq(tk[0].balanceOf(address(vault)), 10e18, "tidak ada setoran parsial");
    }

    function test_mint_reentrancyViaTokenHookReverts() public {
        _seed();
        _fund(alice, 100e18, 100e18, 100e6);
        // Saat token BBB ditransfer ke vault, token memanggil balik vault.mint.
        tk[1].setHook(address(vault), abi.encodeCall(CordonVault.mint, (1e18, alice, _amounts(1e18, 1e18, 1e18))));
        vm.expectRevert(ReentrancyGuard.ReentrancyGuardReentrantCall.selector);
        vm.prank(alice);
        vault.mint(10e18, alice, _amounts(1e18, 2e18, 5e6));
    }

    // ----------------------------------------------------------------- redeem

    function test_redeem_allComponents() public {
        _seed();
        uint256[] memory preview = vault.previewRedeem(25e18);
        assertEq(preview[0], 2.5e18);
        assertEq(preview[2], 12.5e6);
        vm.expectEmit(true, true, false, true, address(vault));
        emit CordonVault.Redeemed(admin, bob, 25e18, 0, 7, preview);
        vm.prank(admin);
        vault.redeem(25e18, bob, 7, _amounts(2.5e18, 5e18, 12.5e6));
        assertEq(tk[0].balanceOf(bob), 2.5e18);
        assertEq(tk[1].balanceOf(bob), 5e18);
        assertEq(tk[2].balanceOf(bob), 12.5e6);
        assertEq(vault.totalSupply(), 75e18);
        assertEq(vault.balanceOf(admin), 75e18);
    }

    function test_redeem_roundsDownForVault() public {
        _seed();
        // 1 wei share dari 100e18 supply: 10e18/100e18 = 0.1 wei -> 0. Pemegang tidak menerima apa pun, share terbakar.
        uint256[] memory p = vault.previewRedeem(1);
        assertEq(p[0], 0);
        assertEq(p[2], 0);
    }

    function test_redeem_slippageMaskAndValidation() public {
        _seed();
        vm.startPrank(admin);
        vm.expectRevert(abi.encodeWithSelector(CordonVault.SlippageExceeded.selector, 0, 2.5e18, 2.5e18 + 1));
        vault.redeem(25e18, admin, 7, _amounts(2.5e18 + 1, 0, 0));
        vm.expectRevert(CordonVault.InvalidMask.selector);
        vault.redeem(1e18, admin, 0, _amounts(0, 0, 0));
        vm.expectRevert(CordonVault.InvalidMask.selector);
        vault.redeem(1e18, admin, 8, _amounts(0, 0, 0)); // bit di luar jumlah komponen
        vm.expectRevert(CordonVault.ZeroAmount.selector);
        vault.redeem(0, admin, 7, _amounts(0, 0, 0));
        vm.expectRevert(CordonVault.ZeroAddress.selector);
        vault.redeem(1e18, address(0), 7, _amounts(0, 0, 0));
        vm.expectRevert(CordonVault.LengthMismatch.selector);
        vault.redeem(1e18, admin, 7, new uint256[](1));
        // min untuk komponen yang tidak dipilih harus 0.
        vm.expectRevert(abi.encodeWithSelector(CordonVault.SlippageExceeded.selector, 1, 0, 1));
        vault.redeem(1e18, admin, 5, _amounts(0, 1, 0));
        vm.stopPrank();
    }

    function test_redeem_cannotBurnMoreThanBalance() public {
        _seed();
        vm.expectRevert();
        vm.prank(alice);
        vault.redeem(1e18, alice, 7, _amounts(0, 0, 0));
    }

    function test_redeem_blockedComponentDoesNotFreezeTheOthers() public {
        _seed();
        tk[1].setBlocked(address(vault), true); // BBB tidak bisa keluar dari vault
        vm.prank(admin);
        vm.expectRevert(bytes("blocked"));
        vault.redeem(25e18, admin, 7, _amounts(0, 0, 0)); // semua komponen: gagal total, tanpa efek
        assertEq(vault.balanceOf(admin), 100e18);

        // Keluar hanya dari AAA dan CCC (bit 0 dan 2): BBB milik bagian ini dilepas ke pemegang lain.
        vm.prank(admin);
        vault.redeem(25e18, admin, 5, _amounts(2.5e18, 0, 12.5e6));
        assertEq(vault.totalSupply(), 75e18);
        assertEq(tk[1].balanceOf(address(vault)), 20e18, "BBB tetap seluruhnya di vault");
        // Nilai BBB per share naik bagi yang tersisa: 20e18 / 75e18 > 20e18 / 100e18.
        uint256[] memory p = vault.previewRedeem(75e18);
        assertEq(p[1], 20e18);
    }

    function test_mint_afterSelectiveRedeemKeepsRatiosConsistent() public {
        _seed();
        vm.prank(admin);
        vault.redeem(50e18, admin, 5, _amounts(0, 0, 0)); // lepas klaim BBB
        _fund(alice, 100e18, 100e18, 100e6);
        uint256[] memory p = vault.previewMint(10e18);
        // supply 50e18, saldo AAA 5e18, BBB 20e18, CCC 25e6
        assertEq(p[0], 1e18);
        assertEq(p[1], 4e18);
        assertEq(p[2], 5e6);
        vm.prank(alice);
        vault.mint(10e18, alice, p);
        assertEq(vault.balanceOf(alice), 10e18);
    }

    function test_redeemEverythingThenReseed() public {
        _seed();
        vm.prank(admin);
        vault.redeem(100e18, admin, 7, _amounts(10e18, 20e18, 50e6));
        assertEq(vault.totalSupply(), 0);
        assertEq(tk[0].balanceOf(address(vault)), 0);
        vm.expectRevert(CordonVault.NotSeeded.selector);
        vault.mint(1e18, alice, _amounts(1, 1, 1));
        // admin dapat seed ulang (supply 0).
        vm.prank(admin);
        vault.seed(100e18, admin, _amounts(10e18, 20e18, 50e6));
        assertEq(vault.totalSupply(), 100e18);
    }

    // -------------------------------------------------------------------- NAV

    function test_nav_valuesWithReferencePricesAndDecimals() public {
        _seed();
        // 10*100 + 20*50 + 50*10 = 1000 + 1000 + 500 = 2500 USD; 100 share -> 25 USD/share.
        (bool ok, uint256 total, uint256 navPs) = vault.tryNav();
        assertTrue(ok);
        assertEq(total, 2500e18);
        assertEq(navPs, 25e18);
        (uint256 t2, uint256 n2) = vault.nav();
        assertEq(t2, total);
        assertEq(n2, navPs);
    }

    function test_nav_worksWhenMarketClosedIfPricesFreshAtClose() public {
        _seed();
        vm.warp(FRI + 19 hours + 30 minutes);
        for (uint256 i; i < 3; i++) {
            feeds[i].setRound(i == 0 ? int256(100e8) : i == 1 ? int256(50e8) : int256(10e8));
        }
        vm.warp(FRI + 1 days + 12 hours); // Sabtu, Closed
        (bool ok,, uint256 navPs) = vault.tryNav();
        assertTrue(ok);
        assertEq(navPs, 25e18);
    }

    function test_nav_unavailableWhenAnyPriceStale() public {
        _seed();
        vm.warp(block.timestamp + 2 hours); // lewat jendela 1 jam, sesi masih terbuka
        (bool ok, uint256 total, uint256 navPs) = vault.tryNav();
        assertFalse(ok);
        assertEq(total, 0);
        assertEq(navPs, 0);
        vm.expectRevert(abi.encodeWithSelector(CordonVault.PriceUnavailable.selector, 0, IOracleRouter.Status.Stale));
        vault.nav();
    }

    function test_nav_beforeSeedIsZeroPerShare() public view {
        (bool ok, uint256 total, uint256 navPs) = vault.tryNav();
        assertTrue(ok);
        assertEq(total, 0);
        assertEq(navPs, 0);
    }

    function test_mintAndRedeemDoNotDependOnOracle() public {
        _seed();
        vm.warp(block.timestamp + 10 days); // semua harga basi
        _fund(alice, 100e18, 100e18, 100e6);
        uint256[] memory p = vault.previewMint(10e18);
        vm.prank(alice);
        vault.mint(10e18, alice, p);
        vm.prank(alice);
        vault.redeem(10e18, alice, 7, _amounts(0, 0, 0));
        assertEq(vault.balanceOf(alice), 0);
    }

    // ------------------------------------------------------------------- fuzz

    /// Mint lalu langsung redeem tidak pernah untung: tiap komponen keluar <= masuk, dan selisih (pembulatan)
    /// dibatasi 2 x saldo-per-share + 2 wei, termasuk setelah donasi besar yang mencoba menggeser rasio.
    function testFuzz_mintThenRedeemNeverProfits(uint256 shares, uint256 donateA, uint256 donateC) public {
        _seed();
        donateA = bound(donateA, 0, 1e30);
        donateC = bound(donateC, 0, 1e24);
        tk[0].mint(address(vault), donateA);
        tk[2].mint(address(vault), donateC);
        shares = bound(shares, 1, 1_000e18);

        uint256[] memory before = vault.balances();
        uint256 s = vault.totalSupply();
        uint256[] memory need = vault.previewMint(shares);
        _fund(alice, need[0], need[1], need[2]);
        uint256[3] memory held = [tk[0].balanceOf(alice), tk[1].balanceOf(alice), tk[2].balanceOf(alice)];

        vm.startPrank(alice);
        vault.mint(shares, alice, need);
        vault.redeem(shares, alice, 7, _amounts(0, 0, 0));
        vm.stopPrank();

        for (uint256 i; i < 3; i++) {
            uint256 back = tk[i].balanceOf(alice);
            assertLe(back, held[i], "tidak pernah untung");
            assertLe(held[i] - back, 2 * (before[i] / s + 1) + 2, "kerugian pembulatan terbatas");
        }
    }

    /// Setoran/penarikan acak dari beberapa akun tidak pernah menurunkan saldo-per-share vault.
    function testFuzz_balancePerShareNeverDecreases(uint256 seedA, uint8 steps) public {
        _seed();
        _fund(alice, 1e30, 1e30, 1e24);
        _fund(bob, 1e30, 1e30, 1e24);
        steps = uint8(bound(steps, 1, 20));
        for (uint256 k; k < steps; k++) {
            seedA = uint256(keccak256(abi.encode(seedA, k)));
            address who = seedA % 2 == 0 ? alice : bob;
            uint256[] memory bBefore = vault.balances();
            uint256 sBefore = vault.totalSupply();
            vm.startPrank(who);
            if ((seedA >> 8) % 2 == 0) {
                uint256 sh = bound(seedA >> 16, 1, 50e18);
                vault.mint(sh, who, _amounts(type(uint256).max, type(uint256).max, type(uint256).max));
            } else {
                uint256 bal = vault.balanceOf(who);
                if (bal > 0) {
                    uint256 sh = bound(seedA >> 16, 1, bal);
                    vault.redeem(sh, who, 7, _amounts(0, 0, 0));
                }
            }
            vm.stopPrank();
            uint256[] memory bAfter = vault.balances();
            uint256 sAfter = vault.totalSupply();
            for (uint256 i; i < 3; i++) {
                // bAfter/sAfter >= bBefore/sBefore  <=>  bAfter * sBefore >= bBefore * sAfter
                assertGe(bAfter[i] * sBefore, bBefore[i] * sAfter, "saldo per share turun");
            }
        }
    }
}

/// Invariant: handler melakukan seed (sekali), mint, redeem (penuh dan selektif), donasi, dan perubahan harga/waktu.
contract CordonVaultHandler is Test {
    CordonVault public vault;
    MockERC20[3] public tk;
    address[3] public actors;
    uint256 public violations; // dicatat handler bila kondisi per-langkah dilanggar
    uint256[3] public totalIn; // total komponen masuk lewat mint
    uint256[3] public totalOut; // total keluar lewat redeem

    constructor(CordonVault v, MockERC20[3] memory t) {
        vault = v;
        tk = t;
        actors = [address(0xA1), address(0xA2), address(0xA3)];
        for (uint256 a; a < 3; a++) {
            for (uint256 i; i < 3; i++) {
                tk[i].mint(actors[a], 1e32);
                vm.prank(actors[a]);
                tk[i].approve(address(vault), type(uint256).max);
            }
        }
    }

    function _check(uint256[] memory bB, uint256 sB) internal {
        uint256[] memory bA = vault.balances();
        uint256 sA = vault.totalSupply();
        if (sA == 0 || sB == 0) return;
        for (uint256 i; i < 3; i++) {
            if (bA[i] * sB < bB[i] * sA) violations++;
        }
    }

    function mint(uint256 who, uint256 shares) external {
        address a = actors[who % 3];
        if (vault.totalSupply() == 0) return;
        shares = bound(shares, 1, 1_000e18);
        uint256[] memory bB = vault.balances();
        uint256 sB = vault.totalSupply();
        uint256[] memory need = vault.previewMint(shares);
        vm.prank(a);
        vault.mint(shares, a, need);
        for (uint256 i; i < 3; i++) {
            totalIn[i] += need[i];
        }
        _check(bB, sB);
    }

    function redeem(uint256 who, uint256 shares, uint256 mask) external {
        address a = actors[who % 3];
        uint256 bal = vault.balanceOf(a);
        if (bal == 0) return;
        shares = bound(shares, 1, bal);
        mask = bound(mask, 1, 7);
        uint256[] memory bB = vault.balances();
        uint256 sB = vault.totalSupply();
        vm.prank(a);
        uint256[] memory out = vault.redeem(shares, a, mask, new uint256[](3));
        for (uint256 i; i < 3; i++) {
            totalOut[i] += out[i];
        }
        _check(bB, sB);
    }

    function donate(uint256 comp, uint256 amt) external {
        tk[comp % 3].mint(address(vault), bound(amt, 0, 1e27));
    }
}

contract CordonVaultInvariantTest is CordonVaultBase {
    CordonVaultHandler internal handler;

    function setUp() public override {
        super.setUp();
        _seed(); // admin memegang 100 share seed
        handler = new CordonVaultHandler(vault, tk);
        targetContract(address(handler));
    }

    /// Saldo per share tidak pernah turun lewat mint/redeem (donasi hanya menaikkannya).
    function invariant_balancePerShareNeverDecreasesInHandlerSteps() public view {
        assertEq(handler.violations(), 0);
    }

    /// Klaim seluruh pemegang (floor) tidak pernah melebihi saldo vault, per komponen.
    function invariant_claimsNeverExceedAssets() public view {
        uint256 s = vault.totalSupply();
        if (s == 0) return;
        uint256[] memory b = vault.balances();
        address[4] memory holders = [admin, address(0xA1), address(0xA2), address(0xA3)];
        uint256[] memory sum = new uint256[](3);
        for (uint256 h; h < 4; h++) {
            uint256[] memory c = vault.previewRedeem(vault.balanceOf(holders[h]));
            for (uint256 i; i < 3; i++) {
                sum[i] += c[i];
            }
        }
        for (uint256 i; i < 3; i++) {
            assertLe(sum[i], b[i]);
        }
    }

    /// Supply = penjumlahan saldo pemegang yang diketahui (tanpa cetak liar).
    function invariant_supplyEqualsKnownHolders() public view {
        uint256 total = vault.balanceOf(admin) + vault.balanceOf(address(0xA1)) + vault.balanceOf(address(0xA2))
            + vault.balanceOf(address(0xA3));
        assertEq(vault.totalSupply(), total);
    }
}
