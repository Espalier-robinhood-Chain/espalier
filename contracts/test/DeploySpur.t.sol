// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {DeploySpur} from "../script/DeploySpur.s.sol";
import {OracleRouter} from "../src/OracleRouter.sol";
import {MarketSession} from "../src/MarketSession.sol";
import {SettlementOracle} from "../src/SettlementOracle.sol";
import {SpurVault} from "../src/SpurVault.sol";
import {HarvestAuction} from "../src/HarvestAuction.sol";
import {MockAggregator} from "./mocks/MockAggregator.sol";
import {MockERC20} from "./mocks/MockERC20.sol";

/// `DeploySpur`: vault pengganti di atas auction/oracle/USDG yang sudah ada. Garis waktu sama dengan SpurVault.t.sol
/// (ET, 2026): FRI = Jumat 10-02 00:00. Round 1: roll Senin 10-05 10:00, expiry Jumat 10-09 16:00.
contract DeploySpurTest is Test {
    uint256 internal constant FRI = 1_790_913_600;
    uint256 internal constant T1 = FRI + 3 days + 10 hours;
    uint64 internal constant E1 = uint64(FRI + 7 days + 16 hours);
    uint256 internal constant T2 = FRI + 10 days + 10 hours;
    uint64 internal constant E2 = uint64(FRI + 14 days + 16 hours);
    bytes32 internal constant KEEPER = keccak256("KEEPER_ROLE");
    bytes32 internal constant GUARDIAN = keccak256("GUARDIAN_ROLE");

    OracleRouter internal router;
    SettlementOracle internal so;
    MockAggregator internal feed;
    MockERC20 internal stock;
    MockERC20 internal usdg;
    HarvestAuction internal auction;
    SpurVault internal oldVault;
    DeploySpur internal script;

    address internal admin = makeAddr("admin");
    address internal keeper = makeAddr("keeper");
    address internal guardian = makeAddr("guardian");
    address internal alice = makeAddr("alice");
    address internal picker;
    uint256 internal pickerKey;

    function setUp() public {
        vm.chainId(46630);
        (picker, pickerKey) = makeAddrAndKey("picker");
        vm.warp(FRI);
        MarketSession market = new MarketSession(admin);
        MockAggregator seq = new MockAggregator(0);
        seq.setRaw(1, 0, FRI - 30 days, FRI - 30 days, 1);
        router = new OracleRouter(admin, address(seq), 1 hours, address(market));
        stock = new MockERC20("NVDA token", "NVDA", 18);
        usdg = new MockERC20("USDG", "USDG", 6);
        feed = new MockAggregator(8);
        vm.prank(admin);
        router.setAssetWindows(address(stock), address(feed), 30 minutes, 1 hours, 1 hours, false);
        so = new SettlementOracle(address(router), 2 hours);
        auction = new HarvestAuction(admin);
        oldVault = new SpurVault(
            admin,
            address(stock),
            address(usdg),
            address(router),
            address(so),
            address(auction),
            6 hours,
            1e12,
            type(uint256).max,
            1000,
            0
        );
        vm.startPrank(admin);
        oldVault.grantRole(KEEPER, keeper);
        auction.grantRole(KEEPER, keeper);
        auction.setPicker(picker, true);
        vm.stopPrank();
        stock.mint(alice, 1_000_000e18);
        usdg.mint(picker, 1_000_000_000e6);
        vm.prank(alice);
        stock.approve(address(oldVault), type(uint256).max);
        vm.prank(picker);
        usdg.approve(address(auction), type(uint256).max);
        script = new DeploySpur();
    }

    function _params() internal view returns (DeploySpur.Params memory p) {
        p.owner = admin;
        p.keeper = keeper;
        p.guardian = guardian;
        p.router = address(router);
        p.settlement = address(so);
        p.auction = address(auction);
        p.usdg = address(usdg);
        p.asset = address(stock);
        p.fillWindow = 6 hours;
        p.minDeposit = 1e12;
        p.depositCap = 0;
        p.otmBps = 1000;
        p.minPremiumBps = 0;
    }

    function _fill(SpurVault v, uint256 premium) internal {
        SpurVault.Round memory r = v.getRound(v.round());
        HarvestAuction.Quote memory q = HarvestAuction.Quote(
            address(v), picker, v.round(), r.strikeE18, r.expiry, r.notional, premium, uint64(block.timestamp + 1 hours)
        );
        (uint8 vv, bytes32 rr, bytes32 ss) = vm.sign(pickerKey, auction.hashQuote(q));
        vm.prank(keeper);
        auction.fill(q, abi.encodePacked(rr, ss, vv));
    }

    // ------------------------------------------------------------------ wiring

    function test_deploy_wiresExistingStackAndRoles() public {
        SpurVault v = script.deploy(_params());
        assertEq(address(v.ASSET()), address(stock));
        assertEq(address(v.PREMIUM()), address(usdg));
        assertEq(address(v.ROUTER()), address(router));
        assertEq(address(v.SETTLEMENT()), address(so));
        assertEq(v.AUCTION(), address(auction));
        assertEq(v.FILL_WINDOW(), 6 hours);
        assertEq(v.depositCap(), type(uint256).max);
        assertTrue(v.hasRole(0x00, admin), "owner ADMIN");
        assertTrue(v.hasRole(KEEPER, keeper));
        assertTrue(v.hasRole(GUARDIAN, guardian));
        assertEq(v.round(), 0);
        assertFalse(v.active());
        assertTrue(address(v) != address(oldVault));
    }

    function test_deploy_withoutGuardian_grantsNothing() public {
        DeploySpur.Params memory p = _params();
        p.guardian = address(0);
        SpurVault v = script.deploy(p);
        assertFalse(v.hasRole(GUARDIAN, guardian));
    }

    // ------------------------------------------------------------------ penolakan konfigurasi

    function test_rejects_mainnet() public {
        vm.chainId(4663);
        vm.expectRevert(bytes("skrip ini tidak untuk mainnet (4663): tanpa timelock"));
        script.deploy(_params());
    }

    function test_rejects_assetNotRegisteredInRouter() public {
        DeploySpur.Params memory p = _params();
        p.asset = address(new MockERC20("X", "X", 18));
        vm.expectRevert(bytes("config: ASSET belum terdaftar di router"));
        script.deploy(p);
    }

    function test_rejects_settlementOfOtherRouter() public {
        DeploySpur.Params memory p = _params();
        p.settlement = address(new SettlementOracle(address(new OracleRouterStub()), 2 hours));
        vm.expectRevert(bytes("config: SETTLEMENT bukan milik ROUTER ini"));
        script.deploy(p);
    }

    function test_rejects_addressesWithoutCode() public {
        DeploySpur.Params memory p = _params();
        p.auction = makeAddr("nocode");
        vm.expectRevert(bytes("config: AUCTION tanpa kode"));
        script.deploy(p);
    }

    function test_rejects_outOfRangeParams() public {
        DeploySpur.Params memory p = _params();
        p.otmBps = 99;
        vm.expectRevert(bytes("config: otmBps di luar 100..5000"));
        script.deploy(p);
        p = _params();
        p.fillWindow = 30 minutes;
        vm.expectRevert(bytes("config: fillWindow di luar 1 jam..2 hari"));
        script.deploy(p);
        p = _params();
        p.minPremiumBps = 2001;
        vm.expectRevert(bytes("config: minPremiumBps di atas 2000"));
        script.deploy(p);
    }

    // ------------------------------------------------------------------ skenario nyata

    /// Meniru kejadian di testnet: round terjual, print settlement datang terlambat (> maxPrintDelay) dan feed tidak
    /// segar saat expiry, sehingga vault lama macet permanen. Vault baru dari skrip tetap jalan di auction yang sama.
    function test_stuckOldVault_isReplacedByWorkingNewVault() public {
        // --- vault lama macet
        vm.warp(T1);
        vm.prank(alice);
        oldVault.deposit(2e18);
        feed.setRound(100e8);
        vm.prank(keeper);
        oldVault.rollRound(E1);
        _fill(oldVault, 1e6);

        feed.pushRound(100e8, E1 + 8 hours); // print pertama setelah expiry: 8 jam (jendela 2 jam)
        vm.warp(E1 + 9 hours);
        uint80 printId = feed.roundId();
        vm.expectRevert(SettlementOracle.PrintTooLate.selector);
        so.settle(address(stock), E1, printId);
        vm.expectRevert(SettlementOracle.StalePrice.selector); // round terakhir sebelum expiry berumur 4 hari
        so.settleFallback(address(stock), E1, printId - 1);

        vm.expectRevert(SpurVault.SettlementUnavailable.selector);
        oldVault.settleRound();
        vm.expectRevert(SpurVault.AlreadySold.selector);
        oldVault.closeUnsold();
        vm.prank(keeper);
        vm.expectRevert(SpurVault.NotIdle.selector);
        oldVault.rollRound(E2);
        assertTrue(oldVault.active(), "vault lama macet");

        // --- vault pengganti lewat skrip, pada auction/oracle yang sama
        SpurVault v = script.deploy(_params());
        vm.warp(T2);
        vm.prank(alice);
        stock.approve(address(v), type(uint256).max);
        vm.prank(alice);
        v.deposit(2e18);
        feed.setRound(100e8);
        vm.prank(keeper);
        v.rollRound(E2);
        _fill(v, 1e6); // auction lama menerima vault baru (hanya memeriksa AUCTION())
        assertEq(usdg.balanceOf(address(v)), 1e6);

        feed.pushRound(95e8, E2 + 5 minutes);
        vm.warp(E2 + 1 hours);
        so.settle(address(stock), E2, feed.roundId());
        v.settleRound();
        assertFalse(v.active());
        assertEq(uint8(v.getRound(1).outcome), uint8(SpurVault.Outcome.Settled));
        assertEq(v.getRound(1).settlePriceE18, 95e18);

        // premi dibagi ke pemegang, dan round berikutnya bisa dimulai
        vm.prank(alice);
        v.claimPremium();
        assertApproxEqAbs(usdg.balanceOf(alice), 1e6, 1); // akumulator premium membulatkan ke bawah
        vm.warp(E2 + 3 days + 10 hours); // Senin 10:00 ET berikutnya
        feed.setRound(100e8);
        vm.prank(keeper);
        v.rollRound(E2 + 7 days);
        assertTrue(v.active());
        assertEq(v.round(), 2);
        assertTrue(oldVault.active(), "vault lama tetap macet, tidak mempengaruhi yang baru");
    }
}

/// Router palsu minimal: hanya agar `SettlementOracle` bisa dibuat dengan router berbeda (alamat dengan kode).
contract OracleRouterStub {}
