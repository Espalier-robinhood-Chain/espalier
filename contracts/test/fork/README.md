# Fork test Robinhood Chain (Fase 2 item 8)

**Status: ditulis, BELUM dikompilasi dan BELUM dijalankan.** Sandbox tanpa jaringan dan tanpa `forge`.

## Temuan penting dari riset
- Feed stock **asli** hanya ada di **mainnet (4663)**. Menurut dokumentasi Arbitrum, di **testnet (46630)**
  Stock Token asli dari faucet dipasangkan dengan feed **mock**. Maka "Stock Token dan feed asli" berarti
  fork **mainnet**, bukan testnet. Checklist item 8 dan 6 menganggap testnet; perlu keputusan Anda.
- Alamat Stock Token tidak bisa dibaca dari halaman docs (tabel dimuat dinamis). Ambil dari
  https://docs.robinhood.com/chain/contracts di browser. Pakai hanya alamat kanonik (banyak token tiruan memakai simbol sama).
- Alamat feed proxy: halaman Chainlink Robinhood price feeds. Sequencer Uptime Feed: juga dari Chainlink.
- USDG (dari docs, perlu Anda verifikasi): `0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168`.
- RPC publik: `https://rpc.mainnet.chain.robinhood.com`, `https://rpc.testnet.chain.robinhood.com`.

## Menjalankan
```bash
export FORK_RPC_URL=https://rpc.mainnet.chain.robinhood.com
export FORK_TOKENS=0xTOKEN1,0xTOKEN2,...      # 7 Stock Token MAG7
export FORK_FEEDS=0xFEED1,0xFEED2,...          # urutan sama
export FORK_SEQUENCER_FEED=0x...               # opsional
export FORK_HOLDER=0x...                       # opsional: akun pemegang token, untuk uji transfer
forge test --match-path test/fork/RobinhoodFork.t.sol -vv
```
Ulangi dengan `FORK_BLOCK` pada sesi berbeda (regular, extended, overnight, akhir pekan) dan catat
keluaran `test_logFeedAgeAtBlock`; itu menjawab pertanyaan terbuka 2 (jendela staleness).

## Yang diuji
chain id; kode ada; feed sehat (decimals, answer > 0, updatedAt, answeredInRound); round sebelumnya bisa dibaca
(asumsi settlement); permukaan token (decimals <= 18, `uiMultiplier`, `oraclePaused`); transfer tanpa potongan
(asumsi `ShortReceipt`); Sequencer Uptime Feed.

## Belum dikerjakan (item 8 tetap ⬜/🟡)
- **Integrasi:** `OracleRouter`, `MarketSession`, `SettlementOracle`, `CordonVault` terhadap token dan feed asli
  (harga router vs feed, NAV, mint/redeem in-kind, settlement pada round nyata). Butuh `contracts/src` yang tidak ada di zip.
- Apakah token punya pembatasan transfer atau jeda yang membuat `mint` gagal.
- Semua yang membutuhkan jaringan.
