# Go-live mainnet: indexer, cron, keeper (semua lane)

> Belum dijalankan terhadap chain mana pun. `contracts/preflight-mainnet.sh` hanya membaca chain; pakai sebelum mengubah mode apa pun ke live.

## Syarat sebelum keeper bisa live
| Lane | Env | Syarat on-chain |
|---|---|---|
| `spur` | `SPUR_MODE` | KEEPER_ROLE di SpurVault dan HarvestAuction; Picker terdaftar (`pickers[]` saat deploy), punya USDG + ETH, approve USDG ke HarvestAuction |
| `graft` | `GRAFT_MODE` | sama dengan Spur, untuk GraftVault |
| `cordon`, `cordon1`, `cordon2` | `KEEPER_MODE` (**satu saklar untuk ketiganya**) | KEEPER_ROLE di tiap CordonVault **dan** `pruneVenue` + `pruneSlippageBps` diatur ADMIN (timelock 48 jam) di **cMAG7, cCHIP, dan cVOLT** |

Penting: `KEEPER_MODE` memegang semua lane Cordon sekaligus. Kalau satu Cordon belum punya venue, keeper live akan gagal di Cordon itu saat perlu pruning (tercatat di `keeper_runs`, dan `/api/cron/health` menjawab 503 selama 24 jam). Karena itu `KEEPER_MODE=live` baru dinyalakan setelah **ketiga** Cordon lolos preflight. Spur dan Graft tidak bergantung pada venue, jadi boleh live lebih dulu.

Venue pruning mainnet harus adapter DEX sungguhan (`MockPruneVenue` hanya testnet) dan belum ada di paket ini.

## Urutan
1. Deploy kontrak (`PANDUAN-MAINNET.md`, lalu `deploy-cordon-mainnet.sh cchip`, lalu `cvolt`). Catat alamat dan nomor blok.
2. Isi `vercel.mainnet.env`: bagian alamat, `START_BLOCK`, `EXTRA_CORDONS` (cCHIP dulu), `KEEPER_ADDRESS`. Semua `*_MODE=dry-run`. Import ke Vercel, redeploy.
3. Supabase mainnet: jalankan semua migrasi di `supabase/migrations`, lalu `supabase/cron/espalier-cron-mainnet.sql` (isi `<CRON_SECRET>` dan domain).
4. **Indexer:** cek `net._http_response`: tiap aliran `/api/cron/index?stream=...` harus 200 dan baris log "sinkron blok ...". Saat tertinggal log menulis "(mengejar)" sampai kursor mengejar. Tabel `cordons` terisi setelah putaran pertama.
5. **Keeper dry-run:** lane menjawab `DRY-RUN` atau `tunggu`; `/api/cron/health` 200.
6. Preflight:
   `cd contracts && bash preflight-mainnet.sh ../vercel.mainnet.env` (isi `PICKER_ADDRESS=0x...` di shell bila Spur/Graft aktif). Hanya lane bertanda SIAP LIVE yang boleh dinyalakan.
7. Nyalakan live bertahap, satu per satu, amati satu siklus tiap kali:
   a. Isi `KEEPER_PRIVATE_KEY` + `ALLOW_MAINNET_CRON_KEEPER=true` (Sensitive), redeploy.
   b. `SPUR_MODE=live`, lalu `GRAFT_MODE=live`. Isi `RFQ_URL` bila Picker siap membeli.
   c. `KEEPER_MODE=live` hanya bila preflight menyatakan ketiga Cordon siap.
8. Pasang `/api/cron/health` ke layanan uptime eksternal (header `Authorization: Bearer <CRON_SECRET>`).

## Tanda normal vs masalah
- Akhir pekan atau pasar tutup: NAV dilewati ("harga tidak valid"), keeper `tunggu`/`lewati`. Normal.
- Health 503 "indexer ... kursor terakhir N dtk lalu": cron indexer mati atau RPC bermasalah.
- Health 503 "keeper: transaksi gagal": lihat `keeper_runs.error` terakhir.
- `refused ... ALLOW_MAINNET_CRON_KEEPER`: env pengaman belum diisi.
