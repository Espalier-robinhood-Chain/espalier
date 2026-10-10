// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {IAccessControl} from "@openzeppelin/contracts/access/IAccessControl.sol";
import {TimelockController} from "@openzeppelin/contracts/governance/TimelockController.sol";
import {Deploy} from "../script/Deploy.s.sol";
import {DeployCordonMainnet} from "../script/DeployCordonMainnet.s.sol";
import {CordonVault} from "../src/CordonVault.sol";
import {OracleRouter} from "../src/OracleRouter.sol";
import {Roles} from "../src/libraries/Roles.sol";
import {MockERC20} from "./mocks/MockERC20.sol";
import {MockAggregator} from "./mocks/MockAggregator.sol";

/// Skrip `DeployCordonMainnet` (cCHIP/cVOLT di mainnet). Inti (router + timelock + aset) dibuat dengan `Deploy.s.sol`
/// pada chain id testnet (mode nyata, timelock 48 jam), lalu chain id diganti 4663 untuk menjalankan skrip Cordon.
/// Perilaku di Robinhood Chain sungguhan hanya bisa dibuktikan fork test dan simulasi `forge script` terhadap RPC mainnet.
contract DeployCordonMainnetTest is Test {
    Deploy internal main;
    DeployCordonMainnet internal cordon;
    OracleRouter internal router;
    address internal timelock;

    address internal safe = makeAddr("safe");
    address internal guardian = makeAddr("guardian");
    address internal keeper = makeAddr("keeper");
    address internal treasury = makeAddr("treasury");

    // [0],[1] = komponen cMAG7 di deploy utama (`assets`); [2],[3] = `routerAssets` (hanya terdaftar di router).
    address[4] internal tokens;
    address[4] internal feeds;

    function setUp() public {
        vm.chainId(46630);
        vm.warp(1_780_000_000);
        vm.setEnv("CONFIRM_MAINNET_DEPLOY", "true");
        main = new Deploy();
        cordon = new DeployCordonMainnet();
        for (uint256 i; i < 4; ++i) {
            tokens[i] = address(new MockERC20("T", "T", 18));
            MockAggregator f = new MockAggregator(8);
            f.setRound(int256(100e8 * (i + 1)));
            feeds[i] = address(f);
        }
        Deploy.Result memory core = main.deploy(_coreJson());
        router = core.router;
        timelock = core.timelock;
        assertTrue(timelock != address(0));
        vm.chainId(4663);
    }

    // ------------------------------------------------------------------- util

    function _a(address a) internal pure returns (string memory) {
        return vm.toString(a);
    }

    function _coreAsset(string memory sym, uint256 i, uint256 bps) internal view returns (string memory) {
        return string.concat(
            '{"symbol":"',
            sym,
            '","token":"',
            _a(tokens[i]),
            '","feed":"',
            _a(feeds[i]),
            '","stalenessRegularSeconds":900,"stalenessExtendedSeconds":1800,"stalenessOvernightSeconds":3600,',
            '"checkOraclePause":false,"targetBps":',
            vm.toString(bps),
            "}"
        );
    }

    function _routerAsset(string memory sym, uint256 i) internal view returns (string memory) {
        return string.concat(
            '{"symbol":"',
            sym,
            '","token":"',
            _a(tokens[i]),
            '","feed":"',
            _a(feeds[i]),
            '","stalenessRegularSeconds":900,"stalenessExtendedSeconds":1800,"stalenessOvernightSeconds":3600,',
            '"checkOraclePause":false}'
        );
    }

    /// Deploy utama: dua aset komponen + dua `routerAssets`, timelock 48 jam, guardian dan keeper terisi.
    function _coreJson() internal view returns (string memory) {
        string memory head = string.concat(
            '{"name":"core","chainId":46630,"mocks":false,"addressesVerified":true,',
            '"admin":{"owner":"',
            _a(safe),
            '","timelockDelaySeconds":172800,"guardian":"',
            _a(guardian),
            '","keeper":"',
            _a(keeper),
            '"},"sequencer":{"feed":"',
            _a(address(0)),
            '","gracePeriodSeconds":3600,"allowDisabled":true},',
            '"settlement":{"maxPrintDelaySeconds":7200},"cordon":{"name":"Core","symbol":"cCOR"},'
        );
        string memory mid = string.concat(
            '"fees":{"mintBps":0,"redeemBps":0,"managementBps":0,"recipient":"',
            _a(address(0)),
            '"},"seed":{"enabled":false,"to":"',
            _a(safe),
            '","shares":"0","amounts":[]},"holidays":[20261126,20261225],'
        );
        string memory tail = string.concat(
            '"assets":[',
            _coreAsset("AAA", 0, 5000),
            ",",
            _coreAsset("BBB", 1, 5000),
            '],"routerAssets":[',
            _routerAsset("XXX", 2),
            ",",
            _routerAsset("YYY", 3),
            "]}"
        );
        return string.concat(head, mid, tail);
    }

    struct Q {
        address router;
        address owner;
        address keeper;
        bool verified;
        uint256 mintBps;
        address feeRecipient;
        string seed; // isi objek `seed`, tanpa kurung kurawal
        string assets; // isi array `assets`
    }

    function _q() internal view returns (Q memory q) {
        q.router = address(router);
        q.owner = timelock;
        q.keeper = keeper;
        q.verified = true;
        q.mintBps = 10;
        q.feeRecipient = treasury;
        q.seed = '"enabled":false,"to":"0x0000000000000000000000000000000000000000","shares":"0","amounts":[]';
        q.assets = string.concat(_cordonAsset("AAA", 0, 2500), ",", _cordonAsset("XXX", 2, 2500), ",", _cordonAsset("YYY", 3, 5000));
    }

    function _cordonAsset(string memory sym, uint256 i, uint256 bps) internal view returns (string memory) {
        return string.concat(
            '{"symbol":"', sym, '","token":"', _a(tokens[i]), '","feed":"', _a(feeds[i]), '","targetBps":', vm.toString(bps), "}"
        );
    }

    function _cordonJson(Q memory q) internal view returns (string memory) {
        string memory head = string.concat(
            '{"name":"cchip-unit","chainId":4663,"addressesVerified":',
            vm.toString(q.verified),
            ',"router":"',
            _a(q.router),
            '","owner":"',
            _a(q.owner),
            '","keeper":"',
            _a(q.keeper),
            '","cordon":{"name":"Espalier Cordon Semiconductors","symbol":"cCHIP"},'
        );
        string memory tail = string.concat(
            '"fees":{"mintBps":',
            vm.toString(q.mintBps),
            ',"redeemBps":10,"managementBps":50,"recipient":"',
            _a(q.feeRecipient),
            '"},"seed":{',
            q.seed,
            '},"assets":[',
            q.assets,
            "]}"
        );
        return string.concat(head, tail);
    }

    function _expect(Q memory q, string memory err) internal {
        string memory j = _cordonJson(q);
        vm.expectRevert(bytes(err));
        cordon.deploy(j);
    }

    // ------------------------------------------------------------- jalur sukses

    function test_deploysCordonWithTimelockAsAdminAndKeeperRole() public {
        DeployCordonMainnet.Result memory r = cordon.deploy(_cordonJson(_q()));
        CordonVault v = r.vault;

        assertEq(v.symbol(), "cCHIP");
        assertEq(v.componentCount(), 3);
        address[] memory comps = v.components();
        assertEq(comps[0], tokens[0]);
        assertEq(comps[1], tokens[2]);
        assertEq(comps[2], tokens[3]);
        uint16[] memory w = v.targetWeightsBps();
        assertEq(uint256(w[0]) + w[1] + w[2], 10_000);

        // ADMIN hanya timelock (sama dengan Cordon utama); pengirim dan owner (Safe) tidak punya ADMIN langsung.
        assertTrue(IAccessControl(address(v)).hasRole(0x00, timelock));
        assertFalse(IAccessControl(address(v)).hasRole(0x00, r.deployer));
        assertFalse(IAccessControl(address(v)).hasRole(0x00, safe));
        // KEEPER untuk pruning, tanpa ADMIN.
        assertTrue(IAccessControl(address(v)).hasRole(Roles.KEEPER_ROLE, keeper));
        vm.prank(keeper);
        vm.expectRevert();
        v.setFeeRecipient(keeper);

        assertEq(v.mintFeeBps(), 10);
        assertEq(v.redeemFeeBps(), 10);
        assertEq(v.managementFeeBps(), 50);
        assertEq(v.feeRecipient(), treasury);
        assertEq(v.totalSupply(), 0);
        assertEq(address(v.ROUTER()), address(router));
    }

    function test_timelockCanOperateNewVaultAfterDelay() public {
        CordonVault v = cordon.deploy(_cordonJson(_q())).vault;
        TimelockController t = TimelockController(payable(timelock));
        address other = makeAddr("other");
        bytes memory data = abi.encodeCall(CordonVault.setFeeRecipient, (other));
        vm.prank(safe);
        t.schedule(address(v), 0, data, bytes32(0), bytes32("c"), 48 hours);
        vm.warp(block.timestamp + 48 hours);
        vm.prank(safe);
        t.execute(address(v), 0, data, bytes32(0), bytes32("c"));
        assertEq(v.feeRecipient(), other);
    }

    // ------------------------------------------------------------- penolakan

    function test_rejects_notMainnetChain() public {
        string memory j = _cordonJson(_q());
        vm.chainId(46630);
        vm.expectRevert(bytes("skrip ini khusus mainnet (4663); testnet pakai DeployCordon.s.sol"));
        cordon.deploy(j);
    }

    function test_rejects_unverifiedAddresses() public {
        Q memory q = _q();
        q.verified = false;
        _expect(q, "config: addressesVerified harus true (jalankan script/verify-addresses.sh dulu)");
    }

    function test_rejects_eoaOwner() public {
        Q memory q = _q();
        q.owner = safe; // EOA, bukan timelock
        _expect(q, "config: owner harus kontrak TimelockController, bukan EOA");
    }

    function test_rejects_ownerThatIsNotRouterAdmin() public {
        Q memory q = _q();
        q.owner = address(new MockERC20("S", "S", 18)); // punya kode, tetapi bukan ADMIN router
        _expect(q, "config: owner bukan ADMIN OracleRouter (harus timelock hasil deploy utama)");
    }

    function test_rejects_zeroOrOwnerKeeper() public {
        Q memory q = _q();
        q.keeper = address(0);
        _expect(q, "config: keeper wajib (pruning Cordon butuh KEEPER_ROLE)");
        q.keeper = timelock;
        _expect(q, "config: keeper tidak boleh sama dengan owner");
    }

    function test_rejects_routerWithoutCode() public {
        Q memory q = _q();
        q.router = makeAddr("nocode");
        _expect(q, "config: router kosong / tanpa kode di chain ini");
    }

    function test_rejects_assetNotRegisteredInRouter() public {
        address t = address(new MockERC20("Z", "Z", 18));
        MockAggregator f = new MockAggregator(8);
        f.setRound(1e8);
        Q memory q = _q();
        q.assets = string.concat(
            _cordonAsset("AAA", 0, 5000),
            ',{"symbol":"ZZZ","token":"',
            _a(t),
            '","feed":"',
            _a(address(f)),
            '","targetBps":5000}'
        );
        _expect(q, "config: ZZZ belum terdaftar di OracleRouter / feed berbeda dari router");
    }

    function test_rejects_feedDifferentFromRouter() public {
        MockAggregator other = new MockAggregator(8);
        other.setRound(1e8);
        Q memory q = _q();
        q.assets = string.concat(
            _cordonAsset("AAA", 0, 5000),
            ',{"symbol":"XXX","token":"',
            _a(tokens[2]),
            '","feed":"',
            _a(address(other)),
            '","targetBps":5000}'
        );
        _expect(q, "config: XXX belum terdaftar di OracleRouter / feed berbeda dari router");
    }

    function test_rejects_pausedAsset() public {
        vm.prank(guardian);
        router.pauseAsset(tokens[2]);
        _expect(_q(), "config: aset sedang di-pause di router: XXX");
    }

    function test_rejects_weightsNotSummingTo10000() public {
        Q memory q = _q();
        q.assets = string.concat(_cordonAsset("AAA", 0, 2500), ",", _cordonAsset("XXX", 2, 2500));
        _expect(q, "config: jumlah targetBps harus 10000");
    }

    function test_rejects_duplicateToken() public {
        Q memory q = _q();
        q.assets = string.concat(_cordonAsset("AAA", 0, 5000), ",", _cordonAsset("AAB", 0, 5000));
        _expect(q, "config: token aset ganda");
    }

    function test_rejects_feeWithoutRecipient() public {
        Q memory q = _q();
        q.feeRecipient = address(0);
        _expect(q, "config: fee > 0 butuh fees.recipient");
    }

    function test_rejects_seedAmountsLengthMismatch() public {
        Q memory q = _q();
        q.seed = string.concat('"enabled":true,"to":"', _a(safe), '","shares":"1000000000000000000","amounts":["1"]');
        _expect(q, "config: seed.amounts harus sebanyak aset");
    }
}
