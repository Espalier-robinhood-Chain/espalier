// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IAccessControl} from "@openzeppelin/contracts/access/IAccessControl.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {CordonVault} from "../src/CordonVault.sol";
import {OracleRouter} from "../src/OracleRouter.sol";
import {MockERC20} from "./mocks/MockERC20.sol";
import {CordonVaultBase} from "./CordonVault.t.sol";
import {Test} from "forge-std/Test.sol";

/// Fase 2 item 5: fee mint/redeem (bps) dan fee manajemen streaming di CordonVault.
contract CordonVaultFeesTest is CordonVaultBase {
    address internal treasury = makeAddr("treasury");

    function _enableFees(uint16 m, uint16 r, uint16 g) internal {
        vm.startPrank(admin);
        if (vault.feeRecipient() == address(0)) vault.setFeeRecipient(treasury);
        vault.setFees(m, r, g);
        vm.stopPrank();
    }

    function _unauthorized(address who) internal view returns (bytes memory) {
        return abi.encodeWithSelector(
            IAccessControl.AccessControlUnauthorizedAccount.selector, who, vault.DEFAULT_ADMIN_ROLE()
        );
    }

    // ------------------------------------------------------------- konfigurasi

    function test_defaults_noFeesAndNoRecipient() public view {
        assertEq(vault.mintFeeBps(), 0);
        assertEq(vault.redeemFeeBps(), 0);
        assertEq(vault.managementFeeBps(), 0);
        assertEq(vault.feeRecipient(), address(0));
        assertEq(vault.feeOnMint(1e18), 0);
        assertEq(vault.feeOnRedeem(1e18), 0);
    }

    function test_setFees_hardcodedCapsAndAuth() public {
        vm.prank(admin);
        vault.setFeeRecipient(treasury);

        // Konstanta dibaca dulu: argumen dievaluasi sebelum panggilan, jadi `expectRevert` akan memakan getter.
        uint16 maxMint = vault.MAX_MINT_FEE_BPS();
        uint16 maxRedeem = vault.MAX_REDEEM_FEE_BPS();
        uint16 maxMgmt = vault.MAX_MANAGEMENT_FEE_BPS();
        assertEq(maxMint, 100);
        assertEq(maxRedeem, 100);
        assertEq(maxMgmt, 200);

        vm.startPrank(admin);
        vm.expectRevert(CordonVault.FeeTooHigh.selector);
        vault.setFees(maxMint + 1, 0, 0);
        vm.expectRevert(CordonVault.FeeTooHigh.selector);
        vault.setFees(0, maxRedeem + 1, 0);
        vm.expectRevert(CordonVault.FeeTooHigh.selector);
        vault.setFees(0, 0, maxMgmt + 1);
        vm.expectRevert(CordonVault.FeeTooHigh.selector);
        vault.setFees(type(uint16).max, type(uint16).max, type(uint16).max);

        // Tepat di batas boleh.
        vm.expectEmit(false, false, false, true, address(vault));
        emit CordonVault.FeesSet(100, 100, 200);
        vault.setFees(maxMint, maxRedeem, maxMgmt);
        vm.stopPrank();
        assertEq(vault.mintFeeBps(), 100);
        assertEq(vault.redeemFeeBps(), 100);
        assertEq(vault.managementFeeBps(), 200);

        vm.expectRevert(_unauthorized(alice));
        vm.prank(alice);
        vault.setFees(1, 1, 1);
    }

    function test_setFees_requiresRecipientUnlessAllZero() public {
        vm.startPrank(admin);
        vault.setFees(0, 0, 0); // semua nol tanpa penerima: boleh
        vm.expectRevert(CordonVault.FeeRecipientRequired.selector);
        vault.setFees(1, 0, 0);
        vm.expectRevert(CordonVault.FeeRecipientRequired.selector);
        vault.setFees(0, 0, 1);
        vm.stopPrank();
    }

    function test_setFeeRecipient_validationAndAuth() public {
        vm.startPrank(admin);
        vm.expectRevert(CordonVault.InvalidFeeRecipient.selector);
        vault.setFeeRecipient(address(0));
        vm.expectRevert(CordonVault.InvalidFeeRecipient.selector);
        vault.setFeeRecipient(address(vault));
        vm.expectEmit(true, false, false, false, address(vault));
        emit CordonVault.FeeRecipientSet(treasury);
        vault.setFeeRecipient(treasury);
        vm.stopPrank();
        assertEq(vault.feeRecipient(), treasury);

        vm.expectRevert(_unauthorized(alice));
        vm.prank(alice);
        vault.setFeeRecipient(alice);
    }

    // --------------------------------------------------------------- fee mint

    function test_mintFee_buyerGetsExactSharesAndPaysForFee() public {
        _seed();
        _enableFees(100, 0, 0); // 1,00%
        uint256 shares = 10e18;
        uint256 fee = vault.feeOnMint(shares);
        assertEq(fee, 0.1e18);

        // Gross 10,1 share dari vault 100 share dengan 10 AAA, 20 BBB, 50 CCC (6 desimal).
        uint256[] memory p = vault.previewMint(shares);
        assertEq(p[0], 1.01e18);
        assertEq(p[1], 2.02e18);
        assertEq(p[2], 5.05e6);

        _fund(alice, p[0], p[1], p[2]);
        vm.expectEmit(true, true, false, true, address(vault));
        emit CordonVault.Minted(alice, bob, shares, fee, p);
        vm.prank(alice);
        uint256[] memory paid = vault.mint(shares, bob, p);

        assertEq(paid[0], p[0]);
        assertEq(vault.balanceOf(bob), shares, "penerima mendapat tepat shares");
        assertEq(vault.balanceOf(treasury), fee, "fee dicetak ke penerima fee");
        assertEq(vault.totalSupply(), 100e18 + shares + fee);
        assertEq(tk[0].balanceOf(alice), 0, "penyetor membayar persis preview");
        // Tidak ada pengenceran: saldo per share tidak turun.
        uint256[] memory b = vault.balances();
        assertEq(b[0], 11.01e18);
        assertGe(b[0] * 100e18, 10e18 * vault.totalSupply());
    }

    function test_mintFee_roundsUpOnOneWei() public {
        _seed();
        _enableFees(1, 0, 0); // 0,01%
        assertEq(vault.feeOnMint(1), 1, "pembulatan ke atas");
        assertEq(vault.feeOnMint(0), 0);
        assertEq(vault.feeOnMint(10_000), 1);
        assertEq(vault.feeOnMint(10_001), 2);
    }

    // ------------------------------------------------------------- fee redeem

    function test_redeemFee_movesFeeSharesAndBurnsOnlyNet() public {
        _seed(); // admin memegang 100 share
        _enableFees(0, 100, 0);
        uint256 shares = 50e18;
        uint256 fee = vault.feeOnRedeem(shares);
        assertEq(fee, 0.5e18);

        uint256[] memory preview = vault.previewRedeem(shares);
        assertEq(preview[0], 4.95e18); // 49,5 / 100 x 10
        assertEq(preview[1], 9.9e18);
        assertEq(preview[2], 24_750_000);

        vm.expectEmit(true, true, false, true, address(vault));
        emit CordonVault.Redeemed(admin, bob, shares, fee, 7, preview);
        vm.prank(admin);
        uint256[] memory out = vault.redeem(shares, bob, 7, _amounts(0, 0, 0));

        assertEq(out[0], preview[0]);
        assertEq(tk[0].balanceOf(bob), 4.95e18);
        assertEq(vault.balanceOf(admin), 50e18, "pemanggil menyerahkan tepat shares");
        assertEq(vault.balanceOf(treasury), fee);
        assertEq(vault.totalSupply(), 100e18 - 49.5e18, "hanya bagian bersih yang dibakar");
    }

    function test_redeemFee_oneWeiShareBecomesFeeAndYieldsNothing() public {
        _seed();
        _enableFees(0, 100, 0);
        vm.prank(admin);
        uint256[] memory out = vault.redeem(1, admin, 7, _amounts(0, 0, 0));
        assertEq(out[0] + out[1] + out[2], 0);
        assertEq(vault.balanceOf(treasury), 1);
        assertEq(vault.totalSupply(), 100e18);
    }

    function test_feeRecipientCanExitInKind() public {
        _seed();
        _enableFees(100, 0, 0);
        _fund(alice, 1e24, 1e24, 1e24);
        vm.prank(alice);
        vault.mint(10e18, alice, _amounts(type(uint256).max, type(uint256).max, type(uint256).max));
        uint256 got = vault.balanceOf(treasury);
        assertGt(got, 0);
        vm.prank(treasury);
        uint256[] memory out = vault.redeem(got, treasury, 7, _amounts(0, 0, 0));
        assertGt(out[0], 0);
        assertEq(vault.balanceOf(treasury), 0);
    }

    // ---------------------------------------------------------- fee manajemen

    function test_management_oneYearAtCapGivesTwoPercentOfSupply() public {
        _seed();
        _enableFees(0, 0, 200);
        vm.warp(block.timestamp + 365 days);

        uint256 expected = Math.mulDiv(100e18, 200, 9800); // s x f / (1 - f)
        assertEq(vault.pendingManagementFeeShares(), expected);
        vm.expectEmit(true, false, false, true, address(vault));
        emit CordonVault.ManagementFeeAccrued(treasury, expected);
        vault.accrueManagementFee();

        assertEq(vault.balanceOf(treasury), expected);
        assertEq(vault.pendingManagementFeeShares(), 0);
        // Penerima memegang 2% dari supply baru.
        assertApproxEqRel(vault.balanceOf(treasury) * 1e18 / vault.totalSupply(), 0.02e18, 1e9);
    }

    function test_management_noRetroactiveChargeAndNothingBeforeSeed() public {
        _enableFees(0, 0, 200);
        vm.warp(block.timestamp + 400 days); // sebelum seed: tidak ada supply, tidak ada fee
        _seed();
        vault.accrueManagementFee();
        assertEq(vault.balanceOf(treasury), 0);

        // Tarif 0 setahun lalu dinaikkan: tidak ada tagihan surut.
        vm.prank(admin);
        vault.setFees(0, 0, 0);
        vm.warp(block.timestamp + 365 days);
        vm.prank(admin);
        vault.setFees(0, 0, 200);
        assertEq(vault.balanceOf(treasury), 0, "tidak ada tagihan surut");
        vm.warp(block.timestamp + 365 days);
        assertEq(vault.pendingManagementFeeShares(), Math.mulDiv(100e18, 200, 9800), "hanya setahun terakhir");
    }

    function test_management_previewsMatchActualAfterTimePasses() public {
        _seed();
        _enableFees(50, 50, 200);
        vm.warp(block.timestamp + 123 days);

        // Mint: preview (termasuk fee manajemen terutang dan fee mint) == yang benar-benar ditarik.
        uint256[] memory p = vault.previewMint(7e18);
        _fund(alice, p[0], p[1], p[2]);
        vm.prank(alice);
        uint256[] memory paid = vault.mint(7e18, alice, p);
        for (uint256 i; i < 3; i++) {
            assertEq(paid[i], p[i]);
            assertEq(tk[i].balanceOf(alice), 0, "ditarik persis preview");
        }

        // Redeem: waktu sama, preview == hasil.
        vm.warp(block.timestamp + 40 days);
        uint256[] memory r = vault.previewRedeem(3e18);
        vm.prank(alice);
        uint256[] memory out = vault.redeem(3e18, alice, 7, _amounts(0, 0, 0));
        for (uint256 i; i < 3; i++) {
            assertEq(out[i], r[i]);
        }
    }

    function test_management_navReflectsDilution() public {
        _seed();
        _enableFees(0, 0, 200);
        vm.warp(block.timestamp + 28 days); // tetap Jumat tengah hari ET
        for (uint256 i; i < 3; i++) {
            feeds[i].setRound(int256(uint256(i == 0 ? 100e8 : i == 1 ? 50e8 : 10e8)));
        }
        (bool ok, uint256 value, uint256 navPerShare) = vault.tryNav();
        assertTrue(ok);
        assertEq(navPerShare, Math.mulDiv(value, 1e18, vault.effectiveSupply()));
        assertLt(navPerShare, Math.mulDiv(value, 1e18, vault.totalSupply()), "NAV per share sudah dikurangi fee");
    }

    function test_management_rateChangeAccruesAtOldRate() public {
        _seed();
        _enableFees(0, 0, 200);
        vm.warp(block.timestamp + 365 days);
        vm.prank(admin);
        vault.setFees(0, 0, 0);
        uint256 got = vault.balanceOf(treasury);
        assertEq(got, Math.mulDiv(100e18, 200, 9800), "tarif lama dipakai sampai saat perubahan");
        vm.warp(block.timestamp + 365 days);
        vault.accrueManagementFee();
        assertEq(vault.balanceOf(treasury), got, "tarif 0: tidak ada fee baru");
    }

    function test_management_recipientChangePaysOldRecipientFirst() public {
        _seed();
        _enableFees(0, 0, 200);
        vm.warp(block.timestamp + 100 days);
        address newTreasury = makeAddr("newTreasury");
        vm.prank(admin);
        vault.setFeeRecipient(newTreasury);
        assertGt(vault.balanceOf(treasury), 0, "yang terutang dibayar ke penerima lama");
        assertEq(vault.balanceOf(newTreasury), 0);
        vm.warp(block.timestamp + 100 days);
        vault.accrueManagementFee();
        assertGt(vault.balanceOf(newTreasury), 0);
    }

    /// Jam fee tidak maju bila hasil akru 0, jadi memanggil `accrue` tiap detik tidak bisa membuat fee dibulatkan ke 0
    /// terus-menerus. Sisa kerugian pembulatan: < 1 wei share per akru yang benar-benar mencetak.
    function test_management_dustRoundingCannotEvadeFee() public {
        _seed();
        vm.prank(admin);
        vault.redeem(100e18 - 1e9, admin, 7, _amounts(0, 0, 0)); // sisa supply 1e9 wei
        assertEq(vault.totalSupply(), 1e9);
        _enableFees(0, 0, 200);
        uint256 start = block.timestamp;
        assertEq(vault.lastAccrual(), start);

        // Satu detik: 1e9 x 200 / (1e4 x tahun) = 0,63 share -> 0; jam TIDAK maju.
        vm.warp(start + 1);
        vault.accrueManagementFee();
        assertEq(vault.balanceOf(treasury), 0);
        assertEq(vault.lastAccrual(), start, "jam tidak maju saat hasilnya 0");

        // Dipanggil tiap detik sampai 10 detik: fee tetap terkumpul (tidak hilang terus-menerus).
        for (uint256 k = 2; k <= 10; k++) {
            vm.warp(start + k);
            vault.accrueManagementFee();
        }
        uint256 exact = Math.mulDiv(1e9, 200 * 10, 10_000 * 365 days - 200 * 10); // satu akru 10 detik
        assertEq(exact, 6);
        uint256 got = vault.balanceOf(treasury);
        assertGt(got, 0, "fee tidak bisa dihindari dengan akru beruntun");
        assertLe(got, exact, "tidak pernah lebih dari tagihan sebenarnya");
        assertGe(got, exact - 1, "kerugian pembulatan terbatas");
    }

    function test_management_clockRestartsAfterSupplyReachesZero() public {
        _seed();
        _enableFees(0, 0, 200);
        vm.prank(admin);
        vault.redeem(100e18, admin, 7, _amounts(0, 0, 0));
        assertEq(vault.totalSupply(), 0);
        vm.warp(block.timestamp + 365 days); // vault kosong setahun
        _fund(admin, 10e18, 20e18, 50e6);
        vm.prank(admin);
        vault.seed(100e18, admin, _amounts(10e18, 20e18, 50e6));
        vault.accrueManagementFee();
        assertEq(vault.balanceOf(treasury), 0, "tidak ada fee untuk masa vault kosong");
    }

    // ------------------------------------------------------------------- fuzz

    /// Dengan fee mint dan redeem, mint lalu langsung redeem tidak pernah untung.
    function testFuzz_mintThenRedeemWithFeesNeverProfits(uint256 shares, uint16 mf, uint16 rf, uint16 gf, uint32 dt)
        public
    {
        _seed();
        _enableFees(uint16(bound(mf, 0, 100)), uint16(bound(rf, 0, 100)), uint16(bound(gf, 0, 200)));
        vm.warp(block.timestamp + bound(dt, 0, 400 days));
        shares = bound(shares, 1, 1_000e18);

        uint256[] memory need = vault.previewMint(shares);
        _fund(alice, need[0], need[1], need[2]);
        uint256[3] memory held = [tk[0].balanceOf(alice), tk[1].balanceOf(alice), tk[2].balanceOf(alice)];

        vm.startPrank(alice);
        vault.mint(shares, alice, need);
        vault.redeem(vault.balanceOf(alice), alice, 7, _amounts(0, 0, 0));
        vm.stopPrank();

        for (uint256 i; i < 3; i++) {
            assertLe(tk[i].balanceOf(alice), held[i], "tidak pernah untung");
        }
        assertEq(vault.balanceOf(alice), 0);
    }

    /// Fee manajemen yang dicetak tidak pernah melebihi batas hardcode: fee/(s+fee) <= 2% x dt/tahun.
    function testFuzz_managementNeverExceedsHardcodedRate(uint16 bps, uint32 dt, uint96 extraSupply) public {
        _seed();
        bps = uint16(bound(bps, 1, vault.MAX_MANAGEMENT_FEE_BPS()));
        _enableFees(0, 0, bps);
        uint256 s = vault.totalSupply();
        uint256 t = bound(dt, 1, 5 * 365 days);
        vm.warp(block.timestamp + t);
        extraSupply; // dipakai agar fuzzer juga memvariasikan nilai tak terpakai tanpa efek
        vault.accrueManagementFee();
        uint256 fee = vault.balanceOf(treasury);
        // fee x (BPS x YEAR) <= (bps x t) x (s + fee)  <=>  fraksi penerima <= bps x t / (BPS x YEAR)
        assertLe(fee * 10_000 * 365 days, uint256(bps) * t * (s + fee));
        // Dan batas mutlak: tidak pernah di atas tarif tertinggi.
        assertLe(fee * 10_000 * 365 days, uint256(200) * t * (s + fee));
    }
}

/// Handler invariant dengan fee aktif, waktu berjalan, jeda aset, dan perubahan tarif.
contract CordonVaultFeeHandler is Test {
    CordonVault public vault;
    OracleRouter public router;
    MockERC20[3] public tk;
    address public admin;
    address public feeAddr;
    address[3] public actors;

    uint256 public stepViolations; // saldo per (effective) share turun karena mint/redeem
    uint256 public feeBoundViolations; // fee satu langkah melewati batas hardcode, atau tarif di atas batas diterima
    uint256 public redeemReverts; // redeem gagal tak terduga (keluar tidak boleh ditutup)
    uint256 public mintWhilePaused; // mint berhasil saat ada komponen dijeda

    constructor(CordonVault v, OracleRouter r, MockERC20[3] memory t, address admin_, address feeAddr_) {
        vault = v;
        router = r;
        tk = t;
        admin = admin_;
        feeAddr = feeAddr_;
        actors = [address(0xA1), address(0xA2), address(0xA3)];
        for (uint256 a; a < 3; a++) {
            for (uint256 i; i < 3; i++) {
                tk[i].mint(actors[a], 1e32);
                vm.prank(actors[a]);
                tk[i].approve(address(vault), type(uint256).max);
            }
        }
    }

    // Batas fee satu langkah: fee manajemen maksimum untuk selang waktu sejak akru terakhir + fee mint/redeem maksimum.
    function _mgmtCap(uint256 s, uint256 last) internal view returns (uint256) {
        if (s == 0) return 0;
        uint256 dt = block.timestamp - last;
        if (dt > vault.MAX_ACCRUAL_PERIOD()) dt = vault.MAX_ACCRUAL_PERIOD();
        uint256 num = uint256(vault.MAX_MANAGEMENT_FEE_BPS()) * dt;
        return Math.mulDiv(s, num, 10_000 * vault.YEAR() - num);
    }

    function _opCap(uint256 shares, uint256 maxBps) internal pure returns (uint256) {
        return Math.mulDiv(shares, maxBps, 10_000, Math.Rounding.Ceil);
    }

    function _balancePerShareCheck(uint256[] memory bB, uint256 effB) internal {
        uint256 sA = vault.totalSupply();
        if (sA == 0 || effB == 0) return;
        uint256[] memory bA = vault.balances();
        for (uint256 i; i < 3; i++) {
            if (bA[i] * effB < bB[i] * sA) stepViolations++;
        }
    }

    function warp(uint256 dt) external {
        vm.warp(block.timestamp + bound(dt, 0, 45 days));
    }

    function mint(uint256 who, uint256 shares) external {
        address a = actors[who % 3];
        if (vault.totalSupply() == 0) return;
        shares = bound(shares, 1, 1_000e18);
        uint256 fb = vault.balanceOf(feeAddr);
        uint256 sB = vault.totalSupply();
        uint256 last = vault.lastAccrual();
        uint256 effB = vault.effectiveSupply();
        uint256[] memory bB = vault.balances();
        bool paused = vault.mintPausedBy() != address(0);
        uint256[] memory need = vault.previewMint(shares);
        vm.prank(a);
        try vault.mint(shares, a, need) {
            if (paused) mintWhilePaused++;
            if (vault.balanceOf(feeAddr) - fb > _mgmtCap(sB, last) + _opCap(shares, vault.MAX_MINT_FEE_BPS())) {
                feeBoundViolations++;
            }
            _balancePerShareCheck(bB, effB);
        } catch {
            if (!paused) stepViolations++; // mint tak terjeda tidak boleh gagal
        }
    }

    function redeem(uint256 who, uint256 shares, uint256 mask) external {
        address a = actors[who % 3];
        uint256 bal = vault.balanceOf(a);
        if (bal == 0) return;
        shares = bound(shares, 1, bal);
        mask = bound(mask, 1, 7);
        uint256 fb = vault.balanceOf(feeAddr);
        uint256 sB = vault.totalSupply();
        uint256 last = vault.lastAccrual();
        uint256 effB = vault.effectiveSupply();
        uint256[] memory bB = vault.balances();
        vm.prank(a);
        try vault.redeem(shares, a, mask, new uint256[](3)) {
            if (vault.balanceOf(feeAddr) - fb > _mgmtCap(sB, last) + _opCap(shares, vault.MAX_REDEEM_FEE_BPS())) {
                feeBoundViolations++;
            }
            _balancePerShareCheck(bB, effB);
        } catch {
            redeemReverts++;
        }
    }

    function setFees(uint256 m, uint256 r, uint256 g) external {
        uint16 mf = uint16(bound(m, 0, 150)); // sebagian di atas batas
        uint16 rf = uint16(bound(r, 0, 150));
        uint16 gf = uint16(bound(g, 0, 300));
        bool within =
            mf <= vault.MAX_MINT_FEE_BPS() && rf <= vault.MAX_REDEEM_FEE_BPS() && gf <= vault.MAX_MANAGEMENT_FEE_BPS();
        uint256 fb = vault.balanceOf(feeAddr);
        uint256 sB = vault.totalSupply();
        uint256 last = vault.lastAccrual();
        vm.prank(admin);
        try vault.setFees(mf, rf, gf) {
            if (!within) feeBoundViolations++;
            if (vault.balanceOf(feeAddr) - fb > _mgmtCap(sB, last)) feeBoundViolations++;
        } catch {
            if (within) feeBoundViolations++; // penerima terisi, jadi tarif dalam batas tidak boleh ditolak
        }
    }

    function pause(uint256 idx) external {
        vm.prank(admin);
        router.pauseAsset(address(tk[idx % 3]));
    }

    function unpause(uint256 idx) external {
        vm.prank(admin);
        router.unpauseAsset(address(tk[idx % 3]));
    }

    function accrue() external {
        uint256 fb = vault.balanceOf(feeAddr);
        uint256 sB = vault.totalSupply();
        uint256 last = vault.lastAccrual();
        vault.accrueManagementFee();
        if (vault.balanceOf(feeAddr) - fb > _mgmtCap(sB, last)) feeBoundViolations++;
    }

    function donate(uint256 comp, uint256 amt) external {
        tk[comp % 3].mint(address(vault), bound(amt, 0, 1e27));
    }
}

contract CordonVaultFeeInvariantTest is CordonVaultBase {
    address internal constant FEE = address(0xFEE);
    CordonVaultFeeHandler internal handler;

    function setUp() public override {
        super.setUp();
        _seed();
        vm.startPrank(admin);
        vault.setFeeRecipient(FEE);
        vault.setFees(50, 50, 100);
        vm.stopPrank();
        handler = new CordonVaultFeeHandler(vault, router, tk, admin, FEE);
        targetContract(address(handler));
    }

    /// Mint/redeem dengan fee tidak pernah menurunkan saldo per (effective) share; mint tak terjeda tidak gagal.
    function invariant_noStepLowersBalancePerShare() public view {
        assertEq(handler.stepViolations(), 0);
    }

    /// Fee tidak pernah melampaui batas hardcode (per langkah) dan konfigurasi tidak pernah di atas batas.
    function invariant_feeNeverExceedsHardcodedLimits() public view {
        assertEq(handler.feeBoundViolations(), 0);
        assertLe(vault.mintFeeBps(), vault.MAX_MINT_FEE_BPS());
        assertLe(vault.redeemFeeBps(), vault.MAX_REDEEM_FEE_BPS());
        assertLe(vault.managementFeeBps(), vault.MAX_MANAGEMENT_FEE_BPS());
    }

    /// Keluar in-kind tidak pernah ditutup (juga saat aset dijeda).
    function invariant_exitNeverBlocked() public view {
        assertEq(handler.redeemReverts(), 0);
    }

    function invariant_mintNeverSucceedsWhilePaused() public view {
        assertEq(handler.mintWhilePaused(), 0);
    }

    /// Klaim seluruh pemegang (termasuk penerima fee, dengan effective supply) tidak pernah melebihi saldo vault.
    function invariant_claimsNeverExceedAssets() public view {
        uint256 s = vault.totalSupply();
        if (s == 0) return;
        uint256[] memory b = vault.balances();
        address[5] memory holders = [admin, address(0xA1), address(0xA2), address(0xA3), FEE];
        uint256[] memory sum = new uint256[](3);
        for (uint256 h; h < 5; h++) {
            uint256 sh = vault.balanceOf(holders[h]);
            // previewRedeem memotong fee redeem; untuk klaim kasar pakai preview dari share tanpa fee: batas atas.
            uint256[] memory c = vault.previewRedeem(sh);
            for (uint256 i; i < 3; i++) {
                sum[i] += c[i];
            }
        }
        for (uint256 i; i < 3; i++) {
            assertLe(sum[i], b[i]);
        }
    }

    function invariant_supplyEqualsKnownHolders() public view {
        uint256 total = vault.balanceOf(admin) + vault.balanceOf(address(0xA1)) + vault.balanceOf(address(0xA2))
            + vault.balanceOf(address(0xA3)) + vault.balanceOf(FEE);
        assertEq(vault.totalSupply(), total);
    }
}
