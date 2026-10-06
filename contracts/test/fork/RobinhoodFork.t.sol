// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Test, console2} from "forge-std/Test.sol";

/// Fork test Fase 2 item 8: Stock Token dan feed Chainlink ASLI di Robinhood Chain.
/// MANDIRI: tidak mengimpor kontrak Espalier (contracts/src tidak ada di zip yang saya terima),
/// jadi ini memeriksa ASUMSI yang dipakai OracleRouter/CordonVault terhadap chain nyata.
/// Belum pernah dijalankan (sandbox tanpa jaringan dan tanpa forge); belum dikompilasi.
///
/// Env wajib: FORK_RPC_URL, FORK_TOKENS (koma), FORK_FEEDS (koma, urutan sama dengan tokens).
/// Env opsional: FORK_BLOCK, FORK_SEQUENCER_FEED, FORK_HOLDER (pemegang token untuk uji transfer),
///               FORK_EXPECT_CHAIN_ID (default 4663).
interface IFeed {
    function decimals() external view returns (uint8);
    function description() external view returns (string memory);
    function latestRoundData() external view returns (uint80, int256, uint256, uint256, uint80);
    function getRoundData(uint80) external view returns (uint80, int256, uint256, uint256, uint80);
}

interface IStock {
    function symbol() external view returns (string memory);
    function decimals() external view returns (uint8);
    function balanceOf(address) external view returns (uint256);
    function transfer(address, uint256) external returns (bool);
    function approve(address, uint256) external returns (bool);
    function transferFrom(address, address, uint256) external returns (bool);
    function uiMultiplier() external view returns (uint256);
    function oraclePaused() external view returns (bool);
}

contract RobinhoodForkTest is Test {
    address[] internal tokens;
    address[] internal feeds;
    address internal sequencerFeed;
    address internal holder;

    function setUp() public {
        string memory rpc = vm.envString("FORK_RPC_URL");
        uint256 blk = vm.envOr("FORK_BLOCK", uint256(0));
        if (blk == 0) vm.createSelectFork(rpc);
        else vm.createSelectFork(rpc, blk);

        tokens = vm.envAddress("FORK_TOKENS", ",");
        feeds = vm.envAddress("FORK_FEEDS", ",");
        require(tokens.length > 0 && tokens.length == feeds.length, "FORK_TOKENS/FORK_FEEDS kosong atau beda panjang");
        sequencerFeed = vm.envOr("FORK_SEQUENCER_FEED", address(0));
        holder = vm.envOr("FORK_HOLDER", address(0));
    }

    function test_chainId() public view {
        assertEq(block.chainid, vm.envOr("FORK_EXPECT_CHAIN_ID", uint256(4663)));
    }

    function test_tokensAndFeedsHaveCode() public view {
        for (uint256 i; i < tokens.length; i++) {
            assertGt(tokens[i].code.length, 0, "token tanpa kode");
            assertGt(feeds[i].code.length, 0, "feed tanpa kode");
        }
    }

    /// Asumsi router: feed memenuhi AggregatorV3, answer > 0, updatedAt wajar, decimals <= 18.
    function test_feedsLookSane() public view {
        for (uint256 i; i < feeds.length; i++) {
            IFeed f = IFeed(feeds[i]);
            uint8 dec = f.decimals();
            assertGt(dec, 0);
            assertLe(dec, 18);
            (uint80 rid, int256 ans, uint256 startedAt, uint256 updatedAt, uint80 air) = f.latestRoundData();
            assertGt(ans, 0, "answer <= 0");
            assertGt(updatedAt, 0);
            assertLe(updatedAt, block.timestamp, "updatedAt di masa depan");
            assertGe(air, rid, "answeredInRound < roundId");
            console2.log(IStock(tokens[i]).symbol(), f.description());
            console2.log("  decimals / age(s) / startedAt:", dec, block.timestamp - updatedAt, startedAt);
        }
    }

    /// Menjawab pertanyaan terbuka 2: umur harga per feed pada saat fork (bandingkan dengan jendela staleness).
    /// Jalankan pada beberapa FORK_BLOCK (sesi regular, extended, overnight, akhir pekan) dan catat hasilnya.
    function test_logFeedAgeAtBlock() public view {
        console2.log("block.timestamp", block.timestamp);
        for (uint256 i; i < feeds.length; i++) {
            (,,, uint256 updatedAt,) = IFeed(feeds[i]).latestRoundData();
            console2.log("age(s):", block.timestamp - updatedAt);
        }
    }

    /// Asumsi settlement: getRoundData(roundId-1) bisa dibaca; catat bila revert, nol, atau batas fase.
    function test_previousRoundReadable() public {
        for (uint256 i; i < feeds.length; i++) {
            (uint80 rid,,,,) = IFeed(feeds[i]).latestRoundData();
            uint64 inPhase = uint64(rid); // 64 bit rendah = nomor round dalam fase
            if (inPhase <= 1) {
                console2.log("batas fase pada feed index", i);
                continue;
            }
            try IFeed(feeds[i]).getRoundData(rid - 1) returns (uint80, int256 a, uint256, uint256 u, uint80) {
                assertGt(a, 0, "round sebelumnya answer <= 0");
                assertGt(u, 0, "round sebelumnya updatedAt 0");
            } catch {
                console2.log("getRoundData(roundId-1) REVERT pada feed index", i);
                fail();
            }
        }
    }

    /// Asumsi NAV/router: token membaca decimals, uiMultiplier (ERC-8056), oraclePaused.
    function test_stockTokenSurface() public view {
        for (uint256 i; i < tokens.length; i++) {
            IStock t = IStock(tokens[i]);
            assertLe(t.decimals(), 18, "decimals > 18 ditolak CordonVault");
            assertGt(t.uiMultiplier(), 0, "uiMultiplier 0");
            console2.log(t.symbol(), "uiMultiplier", t.uiMultiplier());
            console2.log("  oraclePaused", t.oraclePaused());
        }
    }

    /// Asumsi CordonVault.mint: transfer/transferFrom tidak memotong (tanpa fee-on-transfer, ditolak ShortReceipt).
    /// Butuh FORK_HOLDER yang memegang token; tidak ada deal() untuk token asli.
    function test_transferIsLossless() public {
        if (holder == address(0)) {
            console2.log("FORK_HOLDER tidak diisi: uji transfer dilewati");
            vm.skip(true);
        }
        address sink = makeAddr("sink");
        address spender = makeAddr("spender");
        for (uint256 i; i < tokens.length; i++) {
            IStock t = IStock(tokens[i]);
            uint256 bal = t.balanceOf(holder);
            if (bal == 0) {
                console2.log("holder tanpa saldo pada token index", i);
                continue;
            }
            uint256 amt = bal / 2 == 0 ? bal : bal / 2;

            uint256 before_ = t.balanceOf(sink);
            vm.prank(holder);
            t.transfer(sink, amt);
            assertEq(t.balanceOf(sink) - before_, amt, "transfer memotong");

            vm.prank(holder);
            t.approve(spender, 1);
            before_ = t.balanceOf(sink);
            vm.prank(spender);
            t.transferFrom(holder, sink, 1);
            assertEq(t.balanceOf(sink) - before_, 1, "transferFrom memotong");
        }
    }

    /// Asumsi router: Sequencer Uptime Feed answer 0 = up (1 = down) dan startedAt > 0.
    function test_sequencerFeed() public {
        if (sequencerFeed == address(0)) {
            console2.log("FORK_SEQUENCER_FEED tidak diisi: dilewati");
            vm.skip(true);
        }
        (, int256 ans, uint256 startedAt,,) = IFeed(sequencerFeed).latestRoundData();
        assertTrue(ans == 0 || ans == 1, "answer bukan 0/1");
        assertGt(startedAt, 0);
        console2.log("sequencer answer (0=up):", uint256(ans));
    }
}
