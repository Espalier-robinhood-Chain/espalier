// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {IAccessControl} from "@openzeppelin/contracts/access/IAccessControl.sol";
import {TimelockController} from "@openzeppelin/contracts/governance/TimelockController.sol";
import {Deploy} from "../script/Deploy.s.sol";
import {CordonVault} from "../src/CordonVault.sol";
import {SpurVault} from "../src/SpurVault.sol";
import {GraftVault} from "../src/GraftVault.sol";
import {HarvestAuction} from "../src/HarvestAuction.sol";
import {SettlementOracle} from "../src/SettlementOracle.sol";
import {OracleRouter} from "../src/OracleRouter.sol";
import {IOracleRouter} from "../src/interfaces/IOracleRouter.sol";
import {Roles} from "../src/libraries/Roles.sol";
import {MockERC20} from "./mocks/MockERC20.sol";
import {MockAggregator} from "./mocks/MockAggregator.sol";

/// Fase 2 item 6: skrip deploy dan file konfigurasi testnet. Semua terhadap mock dan EVM lokal; perilaku di Robinhood
/// Chain sungguhan hanya bisa dibuktikan oleh `script/smoke.sh` setelah deploy.
contract DeployTest is Test {
    Deploy internal script;

    address internal owner = makeAddr("owner");
    address internal guardian = makeAddr("guardian");
    address internal keeper = makeAddr("keeper");
    address internal treasury = makeAddr("treasury");
    address internal stranger = makeAddr("stranger");

    // Aset "nyata" untuk uji mode nyata (di sini tetap mock, tetapi diberikan lewat alamat seperti di testnet).
    address[3] internal tokens;
    address[3] internal feeds;
    address internal seqFeed;

    struct P {
        uint256 chainId;
        bool mocks;
        bool verified;
        address owner;
        uint256 timelockDelay;
        address guardian;
        address keeper;
        address seqFeed;
        bool allowDisabled;
        uint256 mintBps;
        uint256 redeemBps;
        uint256 mgmtBps;
        address feeRecipient;
        bool seedEnabled;
        string seedShares;
        string seedAmounts; // isi array JSON, mis. '"1","2","3"'
        uint256[3] weights;
        bool useRealAddresses;
        string holidays; // isi array JSON
    }

    function setUp() public {
        vm.chainId(46630);
        vm.warp(1_780_000_000); // 2026-05-28, jauh dari batas kalender
        script = new Deploy();
        for (uint256 i; i < 3; ++i) {
            tokens[i] = address(new MockERC20("T", "T", 18));
            MockAggregator f = new MockAggregator(8);
            f.setRound(int256(100e8 * (i + 1)));
            feeds[i] = address(f);
        }
        MockAggregator s = new MockAggregator(0);
        s.setRaw(1, 0, block.timestamp - 2 days, block.timestamp - 2 days, 1);
        seqFeed = address(s);
    }

    // ------------------------------------------------------------------- util

    function _base() internal view returns (P memory p) {
        p.chainId = 46630;
        p.mocks = false;
        p.verified = true;
        p.owner = owner;
        p.timelockDelay = 0;
        p.seqFeed = seqFeed;
        p.weights = [uint256(3334), 3333, 3333];
        p.useRealAddresses = true;
        p.seedShares = "0";
        p.holidays = "20261126,20261225";
    }

    function _addr(address a) internal pure returns (string memory) {
        return vm.toString(a);
    }

    function _asset(P memory p, uint256 i, string memory sym) internal view returns (string memory) {
        return string.concat(
            '{"symbol":"',
            sym,
            '","token":"',
            p.useRealAddresses ? _addr(tokens[i]) : _addr(address(0)),
            '","feed":"',
            p.useRealAddresses ? _addr(feeds[i]) : _addr(address(0)),
            '","stalenessRegularSeconds":900,"stalenessExtendedSeconds":1800,"stalenessOvernightSeconds":3600,',
            '"checkOraclePause":false,"targetBps":',
            vm.toString(p.weights[i]),
            ',"mockPriceE8":',
            vm.toString(100e8 * (i + 1)),
            "}"
        );
    }

    function _json(P memory p) internal view returns (string memory) {
        string memory head = string.concat(
            '{"name":"unit","chainId":',
            vm.toString(p.chainId),
            ',"mocks":',
            vm.toString(p.mocks),
            ',"addressesVerified":',
            vm.toString(p.verified),
            ',"admin":{"owner":"',
            _addr(p.owner),
            '","timelockDelaySeconds":',
            vm.toString(p.timelockDelay),
            ',"guardian":"',
            _addr(p.guardian),
            '","keeper":"',
            _addr(p.keeper),
            '"},"sequencer":{"feed":"',
            _addr(p.seqFeed),
            '","gracePeriodSeconds":3600,"allowDisabled":',
            vm.toString(p.allowDisabled),
            '},"settlement":{"maxPrintDelaySeconds":7200},"cordon":{"name":"Cordon","symbol":"cTST"},'
        );
        string memory mid = string.concat(
            '"fees":{"mintBps":',
            vm.toString(p.mintBps),
            ',"redeemBps":',
            vm.toString(p.redeemBps),
            ',"managementBps":',
            vm.toString(p.mgmtBps),
            ',"recipient":"',
            _addr(p.feeRecipient),
            '"},"seed":{"enabled":',
            vm.toString(p.seedEnabled),
            ',"to":"',
            _addr(owner),
            '","shares":"',
            p.seedShares,
            '","amounts":[',
            p.seedAmounts,
            ']},"holidays":[',
            p.holidays,
            "],"
        );
        string memory tail =
            string.concat('"assets":[', _asset(p, 0, "AAA"), ",", _asset(p, 1, "BBB"), ",", _asset(p, 2, "CCC"), "]}");
        return string.concat(head, mid, tail);
    }

    function _deploy(P memory p) internal returns (Deploy.Result memory) {
        return script.deploy(_json(p));
    }

    function _expectConfigError(P memory p, string memory err) internal {
        string memory j = _json(p);
        vm.expectRevert(bytes(err));
        script.deploy(j);
    }

    function _isAdmin(address target, address who) internal view returns (bool) {
        return IAccessControl(target).hasRole(0x00, who);
    }

    // --------------------------------------------------- file konfigurasi asli

    function test_shippedMockConfig_deploysAndPassesAllChecks() public {
        Deploy.Result memory r = script.deploy(vm.readFile("script/config/robinhood-testnet-mock.json"));

        assertEq(r.vault.componentCount(), 7);
        assertEq(r.vault.symbol(), "cMAG7");
        assertTrue(r.timelock != address(0));
        assertEq(r.finalAdmin, r.timelock);
        assertEq(TimelockController(payable(r.timelock)).getMinDelay(), 3600);

        // Seed: 1000 share ke owner, 10 token per komponen; NAV = 21,9 USD per share dari harga mock.
        address seedTo = 0x70997970C51812dc3A010C7d01b50e0d17dc79C8;
        assertEq(r.vault.balanceOf(seedTo), 1000e18);
        (bool ok,, uint256 navPerShare) = r.vault.tryNav();
        assertTrue(ok);
        assertEq(navPerShare, 21.9e18);

        // Fee dari konfigurasi mock aktif.
        assertEq(r.vault.mintFeeBps(), 10);
        assertEq(r.vault.redeemFeeBps(), 10);
        assertEq(r.vault.managementFeeBps(), 50);
    }

    function test_shippedRealTemplate_isRejectedUntilFilled() public {
        string memory j = vm.readFile("script/config/robinhood-testnet.json");
        vm.expectRevert(bytes("config: admin.owner kosong"));
        script.deploy(j);
    }

    function test_shippedConfigs_weightsSumTo10000() public view {
        string[2] memory files = ["script/config/robinhood-testnet.json", "script/config/robinhood-testnet-mock.json"];
        for (uint256 f; f < files.length; ++f) {
            uint256[] memory bps = abi.decode(vm.parseJson(vm.readFile(files[f]), ".assets[*].targetBps"), (uint256[]));
            uint256 sum;
            for (uint256 i; i < bps.length; ++i) {
                sum += bps[i];
            }
            assertEq(sum, 10_000);
            assertEq(bps.length, 7);
        }
    }

    // ------------------------------------------------------------ mode nyata

    function test_realMode_usesGivenAddressesAndSetsEverything() public {
        P memory p = _base();
        p.guardian = guardian;
        p.keeper = keeper;
        Deploy.Result memory r = _deploy(p);

        address[] memory comps = r.vault.components();
        for (uint256 i; i < 3; ++i) {
            assertEq(comps[i], tokens[i]);
            assertEq(r.tokens[i], tokens[i]);
            assertEq(address(r.router.assetConfig(tokens[i]).feed), feeds[i]);
        }
        assertEq(r.sequencerFeed, seqFeed);
        assertTrue(r.router.sequencerCheckEnabled());
        assertEq(r.settlement.MAX_PRINT_DELAY(), 7200);
        assertTrue(r.session.isHoliday(2026, 11, 26));
        assertTrue(r.session.isHoliday(2026, 12, 25));
        assertFalse(r.session.isHoliday(2026, 12, 24));
        assertEq(r.vault.totalSupply(), 0);

        // Harga terbaca lewat router yang baru dibuat (feed mock diisi di setUp).
        (IOracleRouter.Status s,,,) = r.router.tryGetReferencePrice(tokens[0]);
        assertEq(uint256(s), uint256(IOracleRouter.Status.Ok));
    }

    function test_noTimelock_ownerBecomesAdminAndDeployerLetsGo() public {
        Deploy.Result memory r = _deploy(_base());
        assertEq(r.timelock, address(0));
        assertEq(r.finalAdmin, owner);
        address[3] memory targets = [address(r.session), address(r.router), address(r.vault)];
        for (uint256 i; i < 3; ++i) {
            assertTrue(_isAdmin(targets[i], owner));
            assertFalse(_isAdmin(targets[i], r.deployer));
        }
        // Deployer tidak bisa mengubah apa pun lagi; owner bisa.
        vm.prank(r.deployer);
        vm.expectRevert();
        r.vault.setFeeRecipient(treasury);
        vm.prank(owner);
        r.vault.setFeeRecipient(treasury);
        assertEq(r.vault.feeRecipient(), treasury);
    }

    function test_timelock_isTheOnlyAdminAndOwnerOperatesItAfterDelay() public {
        P memory p = _base();
        p.timelockDelay = 48 hours;
        Deploy.Result memory r = _deploy(p);
        TimelockController t = TimelockController(payable(r.timelock));

        assertEq(r.finalAdmin, r.timelock);
        assertEq(t.getMinDelay(), 48 hours);
        assertFalse(_isAdmin(address(r.vault), owner)); // owner BUKAN admin langsung
        assertFalse(_isAdmin(address(r.vault), r.deployer));

        // Owner tidak bisa mengubah fee langsung, tetapi bisa lewat timelock setelah 48 jam.
        vm.prank(owner);
        vm.expectRevert();
        r.vault.setFeeRecipient(treasury);

        bytes memory data = abi.encodeCall(CordonVault.setFeeRecipient, (treasury));
        vm.prank(owner);
        t.schedule(address(r.vault), 0, data, bytes32(0), bytes32("1"), 48 hours);
        vm.warp(block.timestamp + 48 hours - 1);
        vm.prank(owner);
        vm.expectRevert();
        t.execute(address(r.vault), 0, data, bytes32(0), bytes32("1"));
        vm.warp(block.timestamp + 1);
        vm.prank(owner);
        t.execute(address(r.vault), 0, data, bytes32(0), bytes32("1"));
        assertEq(r.vault.feeRecipient(), treasury);

        // Peran timelock: deployer tidak punya wewenang di timelock.
        assertFalse(t.hasRole(t.PROPOSER_ROLE(), r.deployer));
        assertFalse(t.hasRole(t.DEFAULT_ADMIN_ROLE(), r.deployer));
        // Owner hanya proposer/executor; hanya timelock sendiri yang admin timelock (perubahan peran = ikut jeda).
        assertFalse(t.hasRole(t.DEFAULT_ADMIN_ROLE(), owner));
        assertTrue(t.hasRole(t.DEFAULT_ADMIN_ROLE(), address(t)));
        assertTrue(t.hasRole(t.PROPOSER_ROLE(), owner));
        assertTrue(t.hasRole(t.EXECUTOR_ROLE(), owner));
    }

    function test_guardianAndKeeperRolesAreNarrow() public {
        P memory p = _base();
        p.guardian = guardian;
        p.keeper = keeper;
        Deploy.Result memory r = _deploy(p);

        // GUARDIAN boleh menjeda aset, tidak boleh membukanya.
        vm.prank(guardian);
        r.router.pauseAsset(tokens[0]);
        assertTrue(r.router.isAssetPaused(tokens[0]));
        vm.prank(guardian);
        vm.expectRevert();
        r.router.unpauseAsset(tokens[0]);
        vm.prank(owner);
        r.router.unpauseAsset(tokens[0]);

        // KEEPER boleh menambah libur, tidak boleh menghapusnya.
        vm.prank(keeper);
        r.session.setHoliday(2026, 12, 24, true);
        vm.prank(keeper);
        vm.expectRevert();
        r.session.setHoliday(2026, 12, 24, false);

        // Orang lain tidak boleh keduanya.
        vm.prank(stranger);
        vm.expectRevert();
        r.router.pauseAsset(tokens[1]);
    }

    function test_keeperGetsPruneRoleOnCordon_butCannotConfigurePruning() public {
        P memory p = _base();
        p.keeper = keeper;
        Deploy.Result memory r = _deploy(p);
        assertTrue(r.vault.hasRole(Roles.KEEPER_ROLE, keeper));
        // Pruning mati sampai ADMIN (timelock) memasang venue dan slippage; KEEPER tidak bisa mengaturnya sendiri.
        assertEq(address(r.vault.pruneVenue()), address(0));
        assertEq(r.vault.pruneSlippageBps(), 0);
        vm.prank(keeper);
        vm.expectRevert();
        r.vault.setPruneVenue(address(r.router));
        vm.prank(keeper);
        vm.expectRevert();
        r.vault.setPruneSlippageBps(50);
    }

    function test_unsetGuardianAndKeeper_grantNothing() public {
        Deploy.Result memory r = _deploy(_base());
        assertFalse(r.router.hasRole(Roles.GUARDIAN_ROLE, address(0)));
        assertFalse(r.session.hasRole(Roles.KEEPER_ROLE, address(0)));
        assertFalse(r.vault.hasRole(Roles.KEEPER_ROLE, address(0)));
    }

    function test_feesAreAppliedWhenConfigured() public {
        P memory p = _base();
        p.mintBps = 25;
        p.redeemBps = 30;
        p.mgmtBps = 100;
        p.feeRecipient = treasury;
        Deploy.Result memory r = _deploy(p);
        assertEq(r.vault.mintFeeBps(), 25);
        assertEq(r.vault.redeemFeeBps(), 30);
        assertEq(r.vault.managementFeeBps(), 100);
        assertEq(r.vault.feeRecipient(), treasury);
    }

    function test_recipientWithoutFees_isSetAndFeesStayZero() public {
        P memory p = _base();
        p.feeRecipient = treasury;
        Deploy.Result memory r = _deploy(p);
        assertEq(r.vault.feeRecipient(), treasury);
        assertEq(r.vault.mintFeeBps(), 0);
    }

    function test_seed_realTokens_pullsFromDeployerBeforeHandover() public {
        P memory p = _base();
        p.seedEnabled = true;
        p.seedShares = "1000000000000000000000";
        p.seedAmounts = '"5000000000000000000","6000000000000000000","7000000000000000000"';
        string memory j = _json(p);

        // Deployer tanpa token: seed gagal dan seluruh deploy dibatalkan (fail-closed, tidak ada tx terkirim).
        vm.expectRevert();
        script.deploy(j);
        vm.stopBroadcast(); // revert setelah startBroadcast tidak membatalkan state cheatcode; di `forge script` skrip berhenti

        // Di konteks test, skrip memakai pengirim bawaan Foundry sebagai deployer.
        for (uint256 i; i < 3; ++i) {
            MockERC20(tokens[i]).mint(DEFAULT_SENDER, 100e18);
        }
        Deploy.Result memory r = script.deploy(j);
        assertEq(r.deployer, DEFAULT_SENDER);
        assertEq(r.vault.totalSupply(), 1000e18);
        assertEq(r.vault.balanceOf(owner), 1000e18);
        assertEq(MockERC20(tokens[0]).balanceOf(address(r.vault)), 5e18);
        assertEq(MockERC20(tokens[2]).balanceOf(address(r.vault)), 7e18);
        // Allowance sisa nol: vault hanya menarik jumlah seed.
        assertEq(MockERC20(tokens[1]).allowance(DEFAULT_SENDER, address(r.vault)), 0);
        // Sisa saldo deployer kembali ke dirinya (100 - 6).
        assertEq(MockERC20(tokens[1]).balanceOf(DEFAULT_SENDER), 94e18);
    }

    // --------------------------------------------------------------- penolakan

    function test_rejects_mainnet() public {
        vm.chainId(4663);
        P memory p = _base();
        p.chainId = 4663;
        _expectConfigError(p, "skrip ini tidak untuk mainnet (4663)");
    }

    function test_rejects_chainMismatch() public {
        P memory p = _base();
        p.chainId = 31337;
        _expectConfigError(p, "chainId RPC tidak sama dengan chainId di konfigurasi");
    }

    function test_rejects_unverifiedAddresses() public {
        P memory p = _base();
        p.verified = false;
        _expectConfigError(p, "config: addressesVerified=false (Fase 0 item 7 belum selesai)");
    }

    function test_rejects_tokenWithoutCode() public {
        P memory p = _base();
        tokens[1] = makeAddr("eoa");
        _expectConfigError(p, "config: token aset kosong / tanpa kode");
    }

    function test_rejects_feedWithoutCode() public {
        P memory p = _base();
        feeds[2] = address(0);
        _expectConfigError(p, "config: feed aset kosong / tanpa kode");
    }

    function test_rejects_emptySequencerUnlessAllowed() public {
        P memory p = _base();
        p.seqFeed = address(0);
        _expectConfigError(p, "config: sequencer.feed kosong tanpa allowDisabled");

        p.allowDisabled = true;
        Deploy.Result memory r = _deploy(p);
        assertFalse(r.router.sequencerCheckEnabled());
    }

    function test_rejects_sequencerWithoutCode() public {
        P memory p = _base();
        p.seqFeed = makeAddr("eoa-seq");
        _expectConfigError(p, "config: sequencer.feed tanpa kode");
    }

    function test_rejects_weightsNotSummingTo10000() public {
        P memory p = _base();
        p.weights = [uint256(3333), 3333, 3333];
        _expectConfigError(p, "config: jumlah targetBps harus 10000");
    }

    function test_rejects_zeroWeight() public {
        P memory p = _base();
        p.weights = [uint256(5000), 5000, 0];
        _expectConfigError(p, "config: targetBps 0");
    }

    function test_rejects_zeroOwner() public {
        P memory p = _base();
        p.owner = address(0);
        _expectConfigError(p, "config: admin.owner kosong");
    }

    function test_rejects_feeWithoutRecipient() public {
        P memory p = _base();
        p.mgmtBps = 10;
        _expectConfigError(p, "config: fee > 0 butuh fees.recipient");
    }

    function test_rejects_feeAboveContractCap() public {
        P memory p = _base();
        p.mintBps = 101; // batas hardcode kontrak 100: ditolak oleh CordonVault.setFees, simulasi gagal
        p.feeRecipient = treasury;
        string memory j = _json(p);
        vm.expectRevert(CordonVault.FeeTooHigh.selector);
        script.deploy(j);
    }

    function test_rejects_seedAmountsLengthMismatch() public {
        P memory p = _base();
        p.seedEnabled = true;
        p.seedShares = "1000000000000000000";
        p.seedAmounts = '"1","2"';
        _expectConfigError(p, "config: seed.amounts harus sebanyak aset");
    }

    function test_rejects_badHolidayDate() public {
        P memory p = _base();
        p.holidays = "20261326"; // bulan 13
        _expectConfigError(p, "config: tanggal libur");
    }

    function test_rejects_staleOrDownSequencerIsNotBlockedButReported() public {
        // Sequencer down saat deploy tidak menggagalkan deploy (status hanya dilaporkan); router tetap fail-closed.
        P memory p = _base();
        MockAggregator(seqFeed).setRaw(2, 1, block.timestamp - 2 days, block.timestamp, 2);
        Deploy.Result memory r = _deploy(p);
        (IOracleRouter.Status s,,,) = r.router.tryGetReferencePrice(tokens[0]);
        assertEq(uint256(s), uint256(IOracleRouter.Status.SequencerDown));
    }

    // --------------------------------------------------------------- mode mock

    function test_mockMode_ignoresAddressesAndCreatesItsOwn() public {
        P memory p = _base();
        p.mocks = true;
        p.verified = false; // mode mock tidak butuh verifikasi alamat
        p.useRealAddresses = false;
        p.seqFeed = address(0);
        Deploy.Result memory r = _deploy(p);

        for (uint256 i; i < 3; ++i) {
            assertTrue(r.tokens[i] != address(0) && r.tokens[i] != tokens[i]);
            assertTrue(r.feeds[i] != feeds[i]);
        }
        assertTrue(r.sequencerFeed != address(0));
        assertTrue(r.router.sequencerCheckEnabled());
        (IOracleRouter.Status s, uint256 price,,) = r.router.tryGetReferencePrice(r.tokens[1]);
        assertEq(uint256(s), uint256(IOracleRouter.Status.Ok));
        assertEq(price, 200e18);
    }

    function test_mockMode_stillRefusesMainnet() public {
        vm.chainId(4663);
        P memory p = _base();
        p.mocks = true;
        p.chainId = 4663;
        p.useRealAddresses = false;
        _expectConfigError(p, "skrip ini tidak untuk mainnet (4663)");
    }

    // ------------------------------------------------------------------ Spur Vault di skrip deploy (M4)

    function _spurJson(
        string memory sym,
        address premium,
        uint256 fill,
        string memory minDep,
        uint256 otm,
        string memory pickers
    ) internal pure returns (string memory) {
        return string.concat(
            '{"enabled":true,"assetSymbol":"',
            sym,
            '","premiumToken":"',
            vm.toString(premium),
            '","fillWindowSeconds":',
            vm.toString(fill),
            ',"minDeposit":"',
            minDep,
            '","depositCap":"0","otmBps":',
            vm.toString(otm),
            ',"minPremiumBps":0,"pickers":[',
            pickers,
            "]}"
        );
    }

    /// Menambahkan bagian `spur` ke JSON konfigurasi (membuang kurung kurawal penutup, lalu menutup lagi).
    function _withSpur(string memory j, string memory spur) internal pure returns (string memory) {
        bytes memory b = bytes(j);
        bytes memory head = new bytes(b.length - 1);
        for (uint256 i; i < head.length; ++i) {
            head[i] = b[i];
        }
        return string.concat(string(head), ',"spur":', spur, "}");
    }

    function _okSpur(address premium, address picker_) internal pure returns (string memory) {
        return _spurJson("AAA", premium, 6 hours, "1000000000000", 1000, string.concat('"', vm.toString(picker_), '"'));
    }

    function _spurBase() internal view returns (P memory p) {
        p = _base();
        p.keeper = keeper;
        p.guardian = guardian;
    }

    function test_spur_absentOrDisabled_deploysNothingExtra() public {
        Deploy.Result memory r = _deploy(_base());
        assertEq(address(r.spurVault), address(0));
        assertEq(address(r.auction), address(0));
        assertEq(r.premiumToken, address(0));
    }

    function test_spur_shippedMockConfig_deploysWiredAndFunded() public {
        Deploy.Result memory r = script.deploy(vm.readFile("script/config/robinhood-testnet-mock.json"));
        SpurVault v = r.spurVault;
        assertTrue(address(v) != address(0));
        assertEq(MockERC20(address(v.ASSET())).symbol(), "NVDA");
        assertEq(MockERC20(address(v.PREMIUM())).symbol(), "USDG");
        assertEq(MockERC20(address(v.PREMIUM())).decimals(), 6);
        assertEq(v.otmBps(), 1000);
        assertEq(v.round(), 0);

        address picker_ = 0x9965507D1a55bcC2695C58ba16FB37d819B0A4dc;
        assertTrue(r.auction.isPicker(picker_));
        assertEq(MockERC20(address(v.PREMIUM())).balanceOf(picker_), 1_000_000e6, "USDG mock untuk rehearsal");

        // Timelock memegang ADMIN di spur vault dan auction; deployer sudah melepas.
        assertTrue(_isAdmin(address(v), r.timelock));
        assertTrue(_isAdmin(address(r.auction), r.timelock));
        assertFalse(_isAdmin(address(v), r.deployer));
        assertFalse(_isAdmin(address(r.auction), r.deployer));
        address mockKeeper = 0x90F79bf6EB2c4f870365E785982E1f101E93b906;
        assertTrue(v.hasRole(Roles.KEEPER_ROLE, mockKeeper));
        assertTrue(r.auction.hasRole(Roles.KEEPER_ROLE, mockKeeper));
    }

    function test_spur_realMode_rolesAndTimelockHandover() public {
        MockERC20 usdg = new MockERC20("USDG", "USDG", 6);
        P memory p = _spurBase();
        p.timelockDelay = 1 days;
        Deploy.Result memory r = script.deploy(_withSpur(_json(p), _okSpur(address(usdg), makeAddr("pk"))));
        SpurVault v = r.spurVault;
        assertEq(address(v.ASSET()), tokens[0]);
        assertEq(address(v.PREMIUM()), address(usdg));
        assertEq(v.AUCTION(), address(r.auction));
        assertTrue(v.hasRole(Roles.KEEPER_ROLE, keeper));
        assertTrue(v.hasRole(Roles.GUARDIAN_ROLE, guardian));
        assertFalse(v.hasRole(Roles.KEEPER_ROLE, stranger));
        assertTrue(_isAdmin(address(v), r.timelock) && _isAdmin(address(r.auction), r.timelock));
        assertFalse(_isAdmin(address(v), owner), "owner hanya lewat timelock");
        // Mode nyata tidak mencetak USDG ke siapa pun.
        assertEq(usdg.totalSupply(), 0);
    }

    struct Cycle {
        Deploy.Result r;
        MockERC20 usdg;
        address picker;
        uint256 pickerKey;
        address gardener;
        uint64 expiry;
    }

    /// Seluruh siklus mingguan di atas kontrak yang di-deploy SKRIP (bukan dirakit tangan): deposit, roll, quote,
    /// fill, settle print, settleRound, klaim premium dan payout.
    function test_spur_realMode_fullWeeklyCycleOnScriptDeployment() public {
        Cycle memory c;
        (c.picker, c.pickerKey) = makeAddrAndKey("picker");
        c.usdg = new MockERC20("USDG", "USDG", 6);
        c.usdg.mint(c.picker, 1_000_000e6);
        c.r = script.deploy(_withSpur(_json(_spurBase()), _okSpur(address(c.usdg), c.picker)));
        c.gardener = makeAddr("gardener");

        _cycleDeposit(c);
        _cycleRollAndFill(c);
        _cycleSettleAndClaim(c);
    }

    function _cycleDeposit(Cycle memory c) internal {
        MockERC20 stock = MockERC20(tokens[0]);
        stock.mint(c.gardener, 100e18);
        vm.startPrank(c.gardener);
        stock.approve(address(c.r.spurVault), type(uint256).max);
        c.r.spurVault.deposit(100e18);
        vm.stopPrank();
    }

    function _cycleRollAndFill(Cycle memory c) internal {
        SpurVault v = c.r.spurVault;
        MockAggregator(feeds[0]).setRound(100e8);
        c.expiry = uint64(block.timestamp + 2 days);
        vm.prank(keeper);
        v.rollRound(c.expiry);
        SpurVault.Round memory rd = v.getRound(1);
        assertEq(rd.strikeE18, 110e18);
        assertEq(rd.notional, 100e18);

        HarvestAuction.Quote memory q = HarvestAuction.Quote(
            address(v), c.picker, 1, rd.strikeE18, c.expiry, rd.notional, 200e6, uint64(block.timestamp + 1 hours)
        );
        (uint8 sv, bytes32 sr, bytes32 ss) = vm.sign(c.pickerKey, c.r.auction.hashQuote(q));
        vm.prank(c.picker);
        c.usdg.approve(address(c.r.auction), type(uint256).max);
        vm.prank(keeper);
        c.r.auction.fill(q, abi.encodePacked(sr, ss, sv));
    }

    function _cycleSettleAndClaim(Cycle memory c) internal {
        SpurVault v = c.r.spurVault;
        MockAggregator feed = MockAggregator(feeds[0]);
        // Expiry: harga print 121 (di atas strike 110).
        feed.pushRound(121e8, c.expiry + 5 minutes);
        vm.warp(c.expiry + 1 hours);
        SettlementOracle(address(c.r.settlement)).settle(tokens[0], c.expiry, feed.roundId());
        v.settleRound();

        uint256 payout = uint256(100e18) * 11e18 / 121e18;
        assertEq(v.getRound(1).payout, payout);
        vm.prank(c.picker);
        v.claimPickerPayout();
        assertEq(MockERC20(tokens[0]).balanceOf(c.picker), payout);
        vm.prank(c.gardener);
        v.claimPremium();
        assertApproxEqAbs(c.usdg.balanceOf(c.gardener), 200e6, 1);
        assertEq(v.managedAssets(), 100e18 - payout);
    }

    function test_spur_rejects_unknownAssetSymbol() public {
        P memory p = _spurBase();
        string memory spur = _spurJson("ZZZ", address(1), 6 hours, "1", 1000, "");
        _expectJson(_withSpur(_json(p), spur), "config: spur.assetSymbol tidak ada di assets");
    }

    function test_spur_rejects_withoutKeeper() public {
        P memory p = _base(); // keeper kosong
        MockERC20 usdg = new MockERC20("USDG", "USDG", 6);
        _expectJson(_withSpur(_json(p), _okSpur(address(usdg), makeAddr("pk"))), "config: spur butuh admin.keeper");
    }

    function test_spur_rejects_outOfRangeParameters() public {
        P memory p = _spurBase();
        MockERC20 usdg = new MockERC20("USDG", "USDG", 6);
        string memory j = _json(p);
        _expectJson(
            _withSpur(j, _spurJson("AAA", address(usdg), 6 hours, "1", 99, "")), "config: spur.otmBps di luar 100-5000"
        );
        _expectJson(
            _withSpur(j, _spurJson("AAA", address(usdg), 6 hours, "1", 5001, "")),
            "config: spur.otmBps di luar 100-5000"
        );
        _expectJson(
            _withSpur(j, _spurJson("AAA", address(usdg), 30 minutes, "1", 1000, "")),
            "config: spur.fillWindowSeconds di luar 3600-172800"
        );
        _expectJson(
            _withSpur(j, _spurJson("AAA", address(usdg), 3 days, "1", 1000, "")),
            "config: spur.fillWindowSeconds di luar 3600-172800"
        );
        _expectJson(_withSpur(j, _spurJson("AAA", address(usdg), 6 hours, "0", 1000, "")), "config: spur.minDeposit 0");
    }

    function test_spur_rejects_zeroPicker() public {
        P memory p = _spurBase();
        MockERC20 usdg = new MockERC20("USDG", "USDG", 6);
        string memory spur =
            _spurJson("AAA", address(usdg), 6 hours, "1", 1000, string.concat('"', vm.toString(address(0)), '"'));
        _expectJson(_withSpur(_json(p), spur), "config: spur.pickers berisi alamat 0");
    }

    function test_spur_rejects_premiumTokenWithoutCode_realModeOnly() public {
        P memory p = _spurBase();
        string memory spur = _okSpur(makeAddr("eoa"), makeAddr("pk"));
        _expectJson(_withSpur(_json(p), spur), "config: spur.premiumToken kosong / tanpa kode");

        // Mode mock mengabaikan alamat itu dan membuat USDG sendiri.
        P memory m = _spurBase();
        m.mocks = true;
        m.useRealAddresses = false;
        m.verified = false;
        m.seqFeed = address(0);
        Deploy.Result memory r = script.deploy(_withSpur(_json(m), _okSpur(address(0), makeAddr("pk"))));
        assertTrue(r.premiumToken != address(0) && r.premiumToken.code.length != 0);
    }

    function _expectJson(string memory j, string memory err) internal {
        vm.expectRevert(bytes(err));
        script.deploy(j);
    }

    // ------------------------------------------------------------------ Graft Vault di skrip deploy

    /// Menambahkan bagian `graft` ke JSON konfigurasi (bentuk sama dengan `spur`; `premiumToken` = USDG = collateral).
    function _withGraft(string memory j, string memory graft) internal pure returns (string memory) {
        bytes memory b = bytes(j);
        bytes memory head = new bytes(b.length - 1);
        for (uint256 i; i < head.length; ++i) {
            head[i] = b[i];
        }
        return string.concat(string(head), ',"graft":', graft, "}");
    }

    function test_graft_absent_deploysNoGraft_spurOnlyStillHasAuction() public {
        MockERC20 usdg = new MockERC20("USDG", "USDG", 6);
        Deploy.Result memory r = script.deploy(_withSpur(_json(_spurBase()), _okSpur(address(usdg), makeAddr("pk"))));
        assertEq(address(r.graftVault), address(0));
        assertTrue(address(r.spurVault) != address(0));
        assertTrue(address(r.auction) != address(0));
    }

    function test_graft_only_deploysAuctionAndVault_wiredAndTimelocked() public {
        MockERC20 usdg = new MockERC20("USDG", "USDG", 6);
        P memory p = _spurBase();
        p.timelockDelay = 1 days;
        Deploy.Result memory r = script.deploy(_withGraft(_json(p), _okSpur(address(usdg), makeAddr("pk"))));
        GraftVault v = r.graftVault;
        assertEq(address(r.spurVault), address(0));
        assertEq(address(v.ASSET()), address(usdg), "collateral = USDG");
        assertEq(address(v.PREMIUM()), address(usdg), "premium = USDG");
        assertEq(address(v.UNDERLYING()), tokens[0], "acuan harga = aset AAA");
        assertEq(v.AUCTION(), address(r.auction));
        assertEq(v.otmBps(), 1000);
        assertTrue(v.hasRole(Roles.KEEPER_ROLE, keeper));
        assertTrue(v.hasRole(Roles.GUARDIAN_ROLE, guardian));
        assertTrue(r.auction.hasRole(Roles.KEEPER_ROLE, keeper));
        assertTrue(r.auction.isPicker(makeAddr("pk")));
        assertTrue(_isAdmin(address(v), r.timelock) && _isAdmin(address(r.auction), r.timelock));
        assertFalse(_isAdmin(address(v), owner), "owner hanya lewat timelock");
        assertFalse(_isAdmin(address(v), r.deployer));
        assertEq(usdg.totalSupply(), 0, "mode nyata tidak mencetak USDG");
    }

    function test_graft_withSpur_shareOneAuctionAndOneUsdg() public {
        MockERC20 usdg = new MockERC20("USDG", "USDG", 6);
        string memory j = _withSpur(_json(_spurBase()), _okSpur(address(usdg), makeAddr("pk")));
        Deploy.Result memory r = script.deploy(_withGraft(j, _okSpur(address(usdg), makeAddr("pk2"))));
        assertEq(r.spurVault.AUCTION(), address(r.auction));
        assertEq(r.graftVault.AUCTION(), address(r.auction));
        assertEq(address(r.spurVault.PREMIUM()), address(r.graftVault.ASSET()));
        assertTrue(r.auction.isPicker(makeAddr("pk")) && r.auction.isPicker(makeAddr("pk2")));
        assertTrue(_isAdmin(address(r.graftVault), r.finalAdmin) && _isAdmin(address(r.spurVault), r.finalAdmin));
    }

    function test_graft_realMode_requiresSameUsdgAsSpur() public {
        MockERC20 usdg = new MockERC20("USDG", "USDG", 6);
        MockERC20 other = new MockERC20("USDG2", "USDG2", 6);
        string memory j = _withSpur(_json(_spurBase()), _okSpur(address(usdg), makeAddr("pk")));
        _expectJson(
            _withGraft(j, _okSpur(address(other), makeAddr("pk2"))),
            "config: graft.premiumToken harus sama dengan spur.premiumToken"
        );
    }

    function test_graft_shippedMockConfig_deploysWiredAndFunded() public {
        Deploy.Result memory r = script.deploy(vm.readFile("script/config/robinhood-testnet-mock.json"));
        GraftVault v = r.graftVault;
        assertTrue(address(v) != address(0));
        assertEq(MockERC20(address(v.UNDERLYING())).symbol(), "NVDA");
        assertEq(MockERC20(address(v.ASSET())).symbol(), "USDG");
        assertEq(MockERC20(address(v.ASSET())).decimals(), 6);
        assertEq(address(v.ASSET()), address(r.spurVault.PREMIUM()), "satu USDG mock untuk Spur dan Graft");
        assertEq(v.AUCTION(), address(r.auction));
        assertEq(v.round(), 0);
        address graftPicker = 0x14dC79964da2C08b23698B3D3cc7Ca32193d9955;
        assertTrue(r.auction.isPicker(graftPicker));
        assertEq(MockERC20(address(v.ASSET())).balanceOf(graftPicker), 1_000_000e6);
        assertTrue(_isAdmin(address(v), r.timelock));
        assertFalse(_isAdmin(address(v), r.deployer));
    }

    function test_graft_rejects_badConfig() public {
        P memory p = _spurBase();
        MockERC20 usdg = new MockERC20("USDG", "USDG", 6);
        string memory j = _json(p);
        _expectJson(
            _withGraft(j, _spurJson("ZZZ", address(usdg), 6 hours, "1", 1000, "")),
            "config: graft.assetSymbol tidak ada di assets"
        );
        _expectJson(
            _withGraft(j, _spurJson("AAA", address(usdg), 6 hours, "1", 99, "")), "config: graft.otmBps di luar 100-5000"
        );
        _expectJson(
            _withGraft(j, _spurJson("AAA", address(usdg), 30 minutes, "1", 1000, "")),
            "config: graft.fillWindowSeconds di luar 3600-172800"
        );
        _expectJson(_withGraft(j, _spurJson("AAA", address(usdg), 6 hours, "0", 1000, "")), "config: graft.minDeposit 0");
        _expectJson(
            _withGraft(_json(_base()), _okSpur(address(usdg), makeAddr("pk"))), "config: graft butuh admin.keeper"
        );
        _expectJson(
            _withGraft(j, _okSpur(address(0xdead), makeAddr("pk"))), "config: graft.premiumToken kosong / tanpa kode"
        );
    }

    /// Siklus mingguan Graft di atas kontrak yang di-deploy SKRIP: deposit USDG, roll, quote, fill, settle print
    /// di bawah strike, settleRound, klaim payout (USDG) dan premium.
    function test_graft_realMode_fullWeeklyCycleOnScriptDeployment() public {
        Cycle memory c;
        (c.picker, c.pickerKey) = makeAddrAndKey("picker");
        c.usdg = new MockERC20("USDG", "USDG", 6);
        c.usdg.mint(c.picker, 1_000_000e6);
        c.gardener = makeAddr("gardener");
        c.usdg.mint(c.gardener, 10_000e6);
        string memory graftCfg =
            _spurJson("AAA", address(c.usdg), 6 hours, "10000000", 1000, string.concat('"', vm.toString(c.picker), '"')); // minimum $10
        c.r = script.deploy(_withGraft(_json(_spurBase()), graftCfg));

        GraftVault v = c.r.graftVault;
        vm.startPrank(c.gardener);
        c.usdg.approve(address(v), type(uint256).max);
        v.deposit(10_000e6);
        vm.stopPrank();

        MockAggregator(feeds[0]).setRound(100e8);
        c.expiry = uint64(block.timestamp + 2 days);
        vm.prank(keeper);
        v.rollRound(c.expiry);
        GraftVault.Round memory rd = v.getRound(1);
        assertEq(rd.strikeE18, 90e18);
        assertEq(rd.notional, uint256(10_000e6) * 1e30 / 90e18);

        HarvestAuction.Quote memory q = HarvestAuction.Quote(
            address(v), c.picker, 1, rd.strikeE18, c.expiry, rd.notional, 200e6, uint64(block.timestamp + 1 hours)
        );
        (uint8 sv, bytes32 sr, bytes32 ss) = vm.sign(c.pickerKey, c.r.auction.hashQuote(q));
        vm.prank(c.picker);
        c.usdg.approve(address(c.r.auction), type(uint256).max);
        vm.prank(keeper);
        c.r.auction.fill(q, abi.encodePacked(sr, ss, sv));

        MockAggregator feed = MockAggregator(feeds[0]);
        feed.pushRound(72e8, c.expiry + 5 minutes); // di bawah strike 90
        vm.warp(c.expiry + 1 hours);
        uint80 rid = feed.roundId();
        SettlementOracle(address(c.r.settlement)).settle(tokens[0], c.expiry, rid);
        v.settleRound();

        uint256 payout = rd.notional * 18e18 / 1e30;
        assertEq(v.getRound(1).payout, payout);
        vm.prank(c.picker);
        v.claimPickerPayout();
        assertEq(c.usdg.balanceOf(c.picker), 1_000_000e6 - 200e6 + payout);
        vm.prank(c.gardener);
        v.claimPremium();
        assertApproxEqAbs(c.usdg.balanceOf(c.gardener), 200e6, 1);
        assertEq(v.managedAssets(), 10_000e6 - payout);
    }
}
