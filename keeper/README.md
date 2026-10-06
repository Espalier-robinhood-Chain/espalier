# Keeper pruning (tahap 4, bagian off-chain)

Pruning = mengembalikan komposisi `CordonVault` ke bobot target, bulanan, hanya saat harga live. Folder ini berisi otak keeper; **jalur transaksi on-chain belum ada**, jadi satu-satunya mode saat ini adalah `dry-run`.

## Yang sudah ada (dites, `npm test`: 11 tes)
- `src/plan.ts` (murni, bigint): `maxDriftBps`, `planTrades` (jual yang berlebih, beli yang kurang, cocokkan terbesar dulu, lewati debu `MIN_TRADE_USD`, `minOut` = harga oracle - slippage, tidak pernah menjual melebihi saldo, desimal token berbeda), `decide` (harga live, interval `MIN_INTERVAL_DAYS` = 30, drift >= `DRIFT_THRESHOLD_BPS` = 100).
- `src/run.ts`: satu siklus terhadap antarmuka `KeeperChain` / `Executor` / `KeeperStore`.
- `src/adapters.ts`: pembaca chain (viem; harga live lewat `OracleRouter.tryGetPrice`, live bila semua komponen `Status.Ok`) dan penyimpan Supabase (`keeper_runs`, `prunings`).

## Aturan integritas data
- **Dry-run tidak menulis apa pun ke database** (tidak ke `prunings`, tidak ke `keeper_runs`), supaya riwayat publik tidak berisi pruning yang tidak pernah terjadi dan poll berkala tidak menumpuk baris.
- Baris `prunings` hanya ditulis setelah transaksi terkonfirmasi, dengan drift "sesudah" dibaca ulang dari chain. Bila harga tidak live setelah transaksi, run dicatat `failed` (dengan hash), bukan angka karangan.
- `KEEPER_MODE=live` ditolak saat start sampai jalur on-chain ada.

## Yang masih dibutuhkan untuk mode live (belum dikerjakan)
1. **Kontrak**: fungsi `prune(...)` di `CordonVault` dengan `KEEPER_ROLE` (sudah disiapkan di `Roles.sol`). Pertimbangan desain: adapter DEX yang di-allowlist ADMIN (DEX belum diputuskan; data likuiditas dari DexScreener), `minOut` dipaksa dari harga oracle `getPrice` + batas slippage di kontrak (jangan percaya `minOut` dari keeper), hanya saat harga live, drift sesudah <= sebelum, event `Pruned(driftBefore, driftAfter, trades)` supaya indexer bisa membangun ulang `prunings` dari event. Perlu forge dan tes fork; di lingkungan penulisan tidak ada `forge`/`solc`, jadi tidak ditulis.
2. `Executor` live di keeper yang memanggil fungsi itu (ABI akan ikut `gen-abis`), lalu ubah penolakan `KEEPER_MODE=live` di `config.ts`.
3. Saat event `Pruned` ada, pindahkan penulisan `prunings` ke indexer (sumber kebenaran = event) dan biarkan keeper hanya mengeksekusi.

## Menjalankan (dry-run)
```bash
cd keeper && npm install && npm test
cp .env.example .env     # isi; jalankan: node --env-file=.env --experimental-strip-types src/main.ts
```
Butuh baris `cordons` (indexer sudah jalan). Kunci service role hanya untuk server ini. Kode adapter belum dijalankan terhadap RPC/Supabase sungguhan.

## Round mingguan (tahap 5, perencana saja)
`src/rounds.ts`: `strikeFor` (persen tetap OTM, pembulatan menjauh dari harga), `canTransition` (status round), `nextRoundAction` (roll / settle / wait). Dites (16 tes total). Belum terhubung ke kontrak karena SpurVault/HarvestAuction belum ada; lihat `contracts/SPEC-tahap5.md`.

## Keeper Spur (tahap 7)
Opsional: aktif bila `SPUR_VAULT_ADDRESS` diisi. Kode: `spur-plan.ts` (murni), `spur-run.ts` (satu siklus), `spur-adapters.ts` (viem, RFQ HTTP, `keeper_runs`), `spur-abi.ts`. Jalur ini terpisah dari pruning Cordon: galat di satu tidak menghentikan yang lain, dan `KEEPER_MODE` Cordon tetap hanya `dry-run`.

**Keadaan dibaca dari chain, bukan database.** Satu siklus memilih tepat satu langkah:

| Keadaan onchain | Langkah |
|---|---|
| tidak ada round aktif | `rollRound(expiry)`: Jumat 16:00 ET berikutnya yang masuk batas kontrak (1..14 hari, dengan cadangan 15 menit; Kamis malam loncat ke Jumat sesudahnya) |
| aktif, belum terjual, `now <= start + FILL_WINDOW` | minta quote RFQ, pilih premium tertinggi yang **lolos simulasi**, `HarvestAuction.fill` |
| aktif, belum terjual, jendela fill habis | `closeUnsold` |
| aktif, terjual, belum expiry | tunggu |
| lewat expiry, settlement belum tercatat | cari round Chainlink lalu `SettlementOracle.settle` (print) atau `settleFallback` |
| lewat expiry, settlement tercatat | `settleRound` |

Keputusan harga tidak ada di keeper: strike dihitung kontrak dari oracle, harga settlement dibuktikan kontrak, premium ditentukan quote bertanda tangan Picker.

**Pengaman**
- Tidak ada transaksi tanpa lolos simulasi (`eth_call` sebagai akun keeper). Simulasi gagal = `DITAHAN` di log dengan nama error kontrak; tidak menulis `keeper_runs` dan dicoba lagi di siklus berikut.
- `keeper_runs` hanya untuk transaksi yang benar-benar dikirim (`running` -> `ok`/`failed`, dengan hash). Dry-run tidak menulis apa pun ke database.
- Saat start, keeper memeriksa `KEEPER_ROLE` di `SpurVault` dan `HarvestAuction`; tanpa peran, keeper menolak jalan.
- Mode default `SPUR_MODE=dry-run`. `live` harus diminta eksplisit dan butuh `KEEPER_PRIVATE_KEY` (kunci panas khusus keeper dengan wewenang sempit; jangan dipakai untuk hal lain).
- Round settlement dicari dengan pencarian biner di fase Chainlink terbaru. Kasus yang tidak bisa diselesaikan aman (round pertama sebuah fase / lubang data) dilaporkan `DITAHAN`, tidak ditebak; kontrak memang tidak punya jalur admin untuk itu.

**RFQ v0** (`RFQ_URL`): keeper `POST` JSON `{chainId, auction, vault, round, strikeE18, expiry, notional, minPremium}` (angka sebagai string desimal; header `Authorization: Bearer $RFQ_TOKEN` bila diisi). Balasan: `{"quotes":[{"picker","premium","deadline","signature"}]}`, maksimum 32 quote. Keeper menyusun sendiri sisa isi quote dari state round onchain, jadi layanan RFQ tidak bisa mengubah strike, expiry, atau notional; tanda tangan EIP-712 mengikat semua field dan kontrak memverifikasinya. Tanpa `RFQ_URL`, round tetap menunggu Picker dan berakhir lewat `closeUnsold`. **Layanan RFQ itu sendiri belum ada** (siapa yang menandatangani, batas harga, dan nonce adalah keputusan produk); `e2e/spur-anvil.ts` memakai penanda tangan lokal hanya untuk uji.

**Uji ujung-ke-ujung (lokal saja)**: `e2e/spur-anvil.ts` menjalankan keeper live dan indexer Spur terhadap kontrak hasil `Deploy.s.sol` di anvil: roll, fill, tunggu, print setelah expiry (ITM), catat settlement, `settleRound`, roll berikutnya, `closeUnsold`, lalu indexer (rounds, harvests, positions cocok dengan `sharesOf`) dan klaim premium (`claimed_at` terisi, jumlah = USDG yang benar-benar diterima). Perintah ada di header file. Ia memajukan jam chain dan memakai kunci anvil yang publik: jangan diarahkan ke chain lain.

**Belum**
- Layanan RFQ dan kebijakan harga Picker.
- Dua jalur yang belum diuji ujung-ke-ujung: `settleFallback` (hanya dites dengan tiruan) dan roll saat pasar tutup (kontrak yang menolak; keeper hanya melaporkan).
- Tidak ada peringatan/alert selain log; `DITAHAN` yang berulang berhari-hari perlu dipantau manusia.
- Cordon pruning masih dry-run (kontrak belum punya fungsi pruning).
