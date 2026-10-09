# Cron Supabase: indexer, keeper (round dan pruning Cordon), dan penyegar feed mock

Alur: `pg_cron` (Supabase) memicu jadwal -> `pg_net` memanggil URL di Vercel -> route menjalankan SATU putaran -> hasil ditulis ke Supabase / chain.
Supabase hanya "membunyikan alarm"; kodenya berjalan di Vercel, jadi semua env di bawah diisi di **Vercel** (server, tanpa awalan `NEXT_PUBLIC_`).

| Jadwal | Route | Fungsi |
|---|---|---|
| tiap menit | `/api/cron/index?stream=cordon` | indexer cMAG7 (+ snapshot NAV tiap 5 menit) |
| tiap menit, +12 dtk | `...stream=cordon1` | indexer Cordon tambahan pertama dari `EXTRA_CORDONS` (cCHIP) |
| tiap menit, +24 dtk | `...stream=cordon2` | Cordon tambahan kedua (cVOLT) |
| tiap menit, +36 / +48 dtk | `...stream=spur`, `...stream=graft` | indexer Spur dan Graft |
| tiap 5 menit | `/api/cron/keeper?lane=spur` dan `...lane=graft` | satu siklus keeper round (LIVE bila `SPUR_MODE`/`GRAFT_MODE` = live) |
| tiap 10 menit (menit 2/4/6) | `/api/cron/keeper?lane=cordon`, `cordon1`, `cordon2` | satu siklus pruning Cordon cMAG7, cCHIP, cVOLT (LIVE bila `KEEPER_MODE=live`) |
| tiap 10 menit | `/api/cron/feeds` | `setRound` pada 13 feed mock (fungsi sama dengan `contracts/refresh-all-feeds.sh`, harga bawaan sama) |
| dipanggil keeper | `POST /api/rfq` | menandatangani quote Picker (bukan jadwal; keeper memanggilnya lewat `RFQ_URL`) |

Kursor indexer sudah tersimpan di Supabase (`indexer_state`), jadi cron melanjutkan dari titik terakhir indexer di komputer Anda.

## 1. File (semua baru; tidak ada file lama yang diubah)

| File | Tempat |
|---|---|
| `stream.ts`, `nav-due.ts`, `run-once.ts` | `indexer/src/` |
| `stream.test.ts`, `nav-due.test.ts` | `indexer/test/` |
| `outcome.ts`, `run-once.ts` | `keeper/src/` |
| `outcome.test.ts` | `keeper/test/` |
| `cron-auth.ts`, `feed-config.ts`, `rfq-sign.ts` dan tes-nya | `lib/api/` |
| `route.ts` x4 | `app/api/cron/index/`, `app/api/cron/keeper/`, `app/api/cron/feeds/`, `app/api/rfq/` |
| `espalier-cron.sql` | `supabase/cron/` |
| `cron-feed-env.sh` | `contracts/` |

Setelah menyalin: `node ./node_modules/typescript/bin/tsc --noEmit` (route mengimpor kode indexer dan keeper, jadi galat tipe antar-paket akan terlihat di sini), lalu
`node --test lib/api/cron-auth.test.ts lib/api/feed-config.test.ts indexer/test/nav-due.test.ts indexer/test/stream.test.ts keeper/test/outcome.test.ts lib/api/rfq-sign.test.ts`.

## 2. Env di Vercel

**Bersama (indexer + keeper + feed)**

| Variabel | Isi |
|---|---|
| `CRON_SECRET` | string acak panjang; sama dengan rahasia di Vault Supabase |
| `INDEXER_RPC_URL`, `INDEXER_CHAIN_ID` | RPC testnet (kunci Alchemy khusus server) dan `46630`. Keeper dan feed memakai ini juga bila `KEEPER_RPC_URL` / `FEED_RPC_URL` kosong |
| `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` | URL project dan kunci service role (rahasia) |
| `LOG_CHUNK` | `10` bila masih Alchemy gratis |

**Indexer**

| Variabel | Isi |
|---|---|
| `CORDON_VAULT_ADDRESS`, `START_BLOCK` | cMAG7, seperti `indexer/.env` |
| `EXTRA_CORDONS` | `0xCCHIP@blok,0xCVOLT@blok` (urutan menentukan `cordon1`, `cordon2`) |
| `SPUR_VAULT_ADDRESS`, `SPUR_START_BLOCK`, `GRAFT_VAULT_ADDRESS`, `GRAFT_START_BLOCK` | seperti `indexer/.env` |

**Keeper live (hanya testnet)**

| Variabel | Isi |
|---|---|
| `SPUR_MODE`, `GRAFT_MODE` | `live` (uji dulu dengan `dry-run`, lihat bagian 4) |
| `KEEPER_PRIVATE_KEY` | kunci dompet keeper. Dompet itu harus punya `KEEPER_ROLE` di SpurVault, GraftVault, dan HarvestAuction, serta saldo gas |
| `KEEPER_ADDRESS` | opsional; kalau diisi harus sama dengan alamat dari kunci itu |
| `RFQ_URL`, `RFQ_TOKEN` | `RFQ_URL=https://DOMAIN.vercel.app/api/rfq` dan token acak (`openssl rand -hex 32`). Kosongkan keduanya bila `fill` ingin dilewati |

**RFQ Picker (route `/api/rfq`, testnet saja)**

| Variabel | Isi |
|---|---|
| `RFQ_PICKER_PRIVATE_KEY` | kunci akun Picker (dompet khusus testnet; harus terdaftar `setPicker` di HarvestAuction, punya USDG dan `allowance` ke HarvestAuction) |
| `RFQ_AUCTION_ADDRESS` | alamat HarvestAuction; quote hanya diberikan untuk auction ini |
| `RFQ_PREMIUM_RAW` | premi tetap, 6 desimal (bawaan `5000000` = 5 USDG); bila `minPremium` lebih tinggi, itu yang dipakai |
| `RFQ_MAX_PREMIUM_RAW` | batas atas (bawaan `20000000`); `minPremium` di atasnya dijawab quote kosong |

Vault yang boleh diberi quote diambil dari `SPUR_VAULT_ADDRESS` dan `GRAFT_VAULT_ADDRESS`. `RFQ_TOKEN` yang sama dibaca keeper (header) dan route (pemeriksaan). Route menolak mainnet (4663).

Mengambil kunci dari keystore `espalier-keeper2` (jalankan di terminal Anda; kunci tercetak di layar, jangan ditempel ke chat, tempel langsung ke dashboard Vercel):

```bash
cast wallet decrypt-keystore espalier-keeper2
```

**Penyegar feed**

| Variabel | Isi |
|---|---|
| `FEED_ADDRESSES` | `alamat=dolar,alamat=dolar,...` untuk 13 feed. Cetak dengan `bash cron-feed-env.sh` dari `contracts/` |
| `FEED_BOT_PRIVATE_KEY` | dompet KHUSUS yang hanya berisi ETH testnet (`cast wallet new`, kirim sekitar 0,02 ETH). Kebutuhan sekitar 0,003 ETH per hari |
| `FEED_DEFAULT_USD` | opsional, harga bagi entri tanpa `=dolar` (default 250) |

Setelah mengisi env, **redeploy** di Vercel.

## 3. Uji manual sebelum menjadwalkan

```bash
H="Authorization: Bearer $CRON_SECRET"; U=https://DOMAIN.vercel.app
curl -s -H "$H" "$U/api/cron/index?stream=cordon1"
curl -s -H "$H" "$U/api/cron/index?stream=graft"
curl -s -H "$H" "$U/api/cron/feeds"
curl -s -H "$H" "$U/api/cron/keeper?lane=spur"

# RFQ: header memakai RFQ_TOKEN (bukan CRON_SECRET). Round 5 dan nilai lain hanya contoh; server hanya menandatangani.
curl -s -X POST "$U/api/rfq" -H "Authorization: Bearer $RFQ_TOKEN" -H "content-type: application/json" \
  -d '{"chainId":46630,"auction":"<AUCTION>","vault":"<SPUR>","round":5,"strikeE18":"1","expiry":"9999999999","notional":"1","minPremium":"0"}'
```

Balasan RFQ yang benar berisi `quotes` dengan `picker`, `premium`, `deadline`, `signature`. `{"quotes":[],"note":"..."}` berarti kebijakan menolak (vault/auction tidak dikenal, atau round sudah lewat expiry).

Hasil yang benar: JSON `"ok":true` dengan baris log dan `"ms"`. Tanpa header: `401`. URL RPC pada pesan galat otomatis disensor.

## 4. Keeper: dry-run dulu, lalu live

1. Isi `SPUR_MODE=dry-run` dan `GRAFT_MODE=dry-run` dengan `KEEPER_ADDRESS` (tanpa kunci), redeploy, panggil route keeper dengan `curl`. Baca `line`: ia menyebut langkah yang akan dikerjakan (`DRY-RUN spur:roll ...`, `tunggu: ...`, atau `DITAHAN ...: alasan`).
2. Bila rencananya masuk akal, ganti ke `live`, tambahkan `KEEPER_PRIVATE_KEY`, redeploy.
3. Kembali ke manual kapan saja: ubah mode ke `dry-run` dan redeploy, atau `cron.unschedule` jadwal keeper.

Apa yang dikerjakan keeper live, satu langkah per siklus (dari chain, tidak dari database), selalu lolos simulasi dulu:

| Keadaan | Langkah |
|---|---|
| tidak ada round aktif | `rollRound` ke Jumat 16:00 ET berikutnya |
| aktif, belum terjual, jendela fill terbuka | minta quote RFQ (`/api/rfq`) lalu `fill` (dilewati tanpa RFQ) |
| aktif, belum terjual, jendela habis | `closeUnsold` |
| lewat expiry, settlement belum dicatat | `settle` atau `settleFallback` |
| settlement tercatat | `settleRound` |

Dengan RFQ aktif, round yang dibuka dijual otomatis dalam jendela 6 jam ke Picker yang menandatangani quote. Tanpa `RFQ_URL`, `fill` dilewati: round **ditutup tanpa terjual** setelah jendela habis, kecuali Anda menjualnya manual (`bash picker.sh fill ...`). Round yang sudah terjual tetap di-settle otomatis setelah expiry, selama ada print feed dalam 2 jam (penyegar feed 10 menit memastikannya).

## 4b. Pruning Cordon live (`KEEPER_MODE=live`)

`CordonVault` yang baru punya `prune(...)` (hanya `KEEPER_ROLE`), jadi lane `cordon`, `cordon1`, dan `cordon2` boleh live. Urutan lane mengikuti `[CORDON_VAULT_ADDRESS, ...EXTRA_CORDONS]` (cMAG7, cCHIP, cVOLT). Satu kunci keeper dipakai semua lane.

Syarat di chain, **untuk setiap dari tiga vault** (kalau salah satu belum, lane itu menjawab galat dan lane lain tetap jalan):

1. Akun keeper punya `KEEPER_ROLE` di vault itu. Dicek tiap panggilan; pesannya "tidak punya KEEPER_ROLE di CordonVault".
2. ADMIN sudah memanggil `setPruneVenue(<adapter DEX>)` dan `setPruneSlippageBps(<=300)`. Selama salah satunya kosong, `prune` ditolak dengan pesan "pruning belum dikonfigurasi".

```bash
R=$RH_RPC_TESTNET; K=0x55d40D0a601AD5303dCe300877Af7aE36FD15149; KR=$(cast keccak "KEEPER_ROLE")
for v in <CORDON_VAULT_ADDRESS> <cCHIP> <cVOLT>; do
  echo "$v hasRole=$(cast call $v 'hasRole(bytes32,address)(bool)' $KR $K --rpc-url $R) venue=$(cast call $v 'pruneVenue()(address)' --rpc-url $R) slip=$(cast call $v 'pruneSlippageBps()(uint256)' --rpc-url $R)"
done
```

Harapannya `hasRole=true`, `venue` bukan alamat nol, dan `slip` lebih dari 0.

Perilaku lane Cordon: pruning hanya terjadi bila harga semua komponen live, drift melewati `DRIFT_THRESHOLD_BPS` (100), dan jarak dari pruning terakhir lebih dari `MIN_INTERVAL_DAYS` (30). Selebihnya jawabannya `lewati: ...`. Dalam mode live, tiap pruning disimulasikan dulu, baru dikirim, dan riwayatnya (`prunings`, `keeper_runs`) ditulis setelah transaksi terkonfirmasi. Mode dry-run tidak menulis apa pun ke database.

Uji manual: `curl -s -H "$H" "$U/api/cron/keeper?lane=cordon"` (lalu `cordon1`, `cordon2`). Mulai dengan `KEEPER_MODE=dry-run` bila ragu.

## 5. Jadwalkan

Buka `espalier-cron.sql`, ganti `<CRON_SECRET>` dan `DOMAIN`, lalu jalankan bagian demi bagian di SQL Editor. Periksa dengan query di akhir file. Hapus baris `cordon1`/`cordon2` bila `EXTRA_CORDONS` belum berisi Cordon itu.

Setelah terbukti jalan, **matikan indexer di komputer** (Ctrl+C): dua indexer memboroskan laju RPC.

## 6. Batas dan risiko

1. **Durasi fungsi Vercel.** Route meminta `maxDuration = 60`; angka yang berlaku tergantung paket Anda. Dengan `LOG_CHUNK=10`, satu aliran menyisir sekitar 360 blok per menit (36 permintaan), sekitar 7 detik. Kalau fungsi dipotong sebelum selesai, kursor aliran itu tidak maju (kursor ditulis di akhir putaran) dan putaran berikutnya makin berat. Gejalanya `status_code` 504 atau `timed_out` pada `net._http_response`.
2. **Lima aliran indexer memakai satu kunci RPC gratis.** Jeda 12 detik membantu, tapi laju gratis tetap batasnya; bila sering 429/timeout, tambah jeda atau pecah kunci per aliran.
3. **Kunci keeper dan kunci bot feed ada di env Vercel.** Hanya untuk testnet dengan dompet khusus. Route keeper menolak mode live di mainnet (4663) dan route feed menolak mainnet sama sekali. Mainnet butuh worker + KMS (kerjaan #15).
4. **Siklus yang tumpang tindih.** Keeper menyimulasikan lagi tepat sebelum mengirim, jadi duplikat jarang lolos, tapi tidak ada kunci antar-panggilan. Jadwal 5 menit dan durasi beberapa detik membuat tumpang tindih tidak terjadi dalam keadaan normal.
5. **Penyisiran awal yang panjang tidak boleh lewat cron.** Itu sudah selesai dari komputer. Kalau `START_BLOCK` diganti atau kursor dihapus, lakukan penyisiran ulang secara lokal.
6. **Cordon tambahan baru** (mis. cVOLT): tambahkan ke `EXTRA_CORDONS` (urutan = nama aliran), tambahkan feed barunya ke `FEED_ADDRESSES`, redeploy.
