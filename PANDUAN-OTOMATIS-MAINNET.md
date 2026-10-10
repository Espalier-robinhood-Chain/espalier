# Mainnet otomatis: keeper, Picker, indexer, cron

> Belum diaudit dan **belum dijalankan terhadap chain mana pun**. Mulai dengan cap kecil, dan Picker hanya dengan USDG yang siap hilang.

## Alur
pg_cron (Supabase) -> pg_net -> route Vercel -> chain / Supabase. Semua env di **Vercel**, bukan Supabase.

| Job | Route | Isi |
|---|---|---|
| tiap menit | `/api/cron/index?stream=cordon\|cordon1\|cordon2\|spur\|graft` | indexer |
| tiap 5 menit | `/api/cron/keeper?lane=spur\|graft` | rollRound, fill (via `/api/rfq`), closeUnsold, settle |
| tiap 10 menit | `/api/cron/keeper?lane=cordon\|cordon1\|cordon2` | pruning Cordon |
| tiap 15 menit | `/api/cron/picker-claim` | Picker menarik payout bila `pickerOwed > 0` |
| tiap 5 menit | `/api/cron/health` | pemantau (200 sehat, 503 masalah) |
| dipanggil keeper | `POST /api/rfq` | Picker menandatangani quote |

## Yang berubah di paket ini
| File | Perubahan |
|---|---|
| `keeper/src/outcome.ts`, `keeper/src/run-once.ts` | Keeper live di 4663 dari cron boleh jalan **hanya** bila `ALLOW_MAINNET_CRON_KEEPER=true` (sebelumnya selalu ditolak). Tes di `keeper/test/outcome.test.ts`. |
| `lib/api/rfq-sign.ts` (+ tes) | RFQ boleh di 4663 hanya dengan `RFQ_ALLOW_MAINNET=true`, `RFQ_PREMIUM_RAW`, `RFQ_MAX_PREMIUM_RAW`, `RFQ_MAX_NOTIONAL_RAW` diisi eksplisit. Notional di atas batas ditolak. Testnet tidak berubah. |
| `app/api/rfq/route.ts` | Di mainnet quote ditolak bila saldo USDG atau allowance Picker kurang dari premi. |
| `app/api/cron/picker-claim/route.ts` | Baru. `claimPickerPayout()` hanya bisa dipanggil Picker sendiri, jadi perlu route ini. |
| `app/api/cron/health/route.ts` | Baru. Cek kursor indexer, transaksi keeper gagal 24 jam, saldo ETH keeper/Picker, saldo USDG Picker. |
| `supabase/cron/espalier-cron-mainnet.sql` | Baru. Tanpa job feed; ditambah picker-claim dan health. |
| `vercel.mainnet.env.example` | Diperbarui: blok keeper live dan Picker. |

## Perbaikan indexer: mengejar blok yang tertinggal
Sebelumnya satu putaran indexer memproses SELURUH rentang kursor..blok aman dan kursor baru disimpan di akhir. Dengan `LOG_CHUNK=10` dan batas 60 dtk per route, indexer yang tertinggal beberapa ribu blok (cron baru dinyalakan setelah deploy, atau mati beberapa jam) tidak pernah selesai dan kursor tidak pernah maju. Sekarang satu putaran memproses paling banyak `MAX_CHUNKS_PER_RUN` potongan (bawaan 100), menyimpan kursor, dan melanjutkan di menit berikutnya. NAV ditulis hanya setelah kursor mengejar blok aman. File: `indexer/src/{decimal,sync,spur-sync,config,run-once,main}.ts`, tes di `indexer/test/{sync,spur}.test.ts`.
Catatan: saat mengejar, Spur/Graft membaca state kontrak di ujung potongan (bukan blok terbaru), jadi butuh RPC arsip.

## Persiapan Picker (sekali, sebelum deploy)
1. Buat dompet Picker baru (bukan keeper, bukan owner). Masukkan alamatnya ke `spur.pickers` dan `graft.pickers` di `robinhood-mainnet.json` **sebelum deploy**. Setelah ADMIN diserahkan, menambah Picker harus lewat timelock 48 jam.
2. Setelah deploy: kirim USDG dan sedikit ETH (gas), lalu `approve` USDG ke HarvestAuction sebesar total premi yang siap Anda bayar.
3. Spur membayar Picker dalam Stock Token (NVDA), Graft dalam USDG. Hasil klaim masuk ke dompet Picker.

## Risiko yang harus Anda putuskan
- Picker membeli opsi dengan premi tetap. Jika premi lebih murah dari nilai wajar opsi, Picker rugi terus. Premi tetap tidak mengikuti harga pasar.
- Batas `RFQ_MAX_NOTIONAL_RAW` membatasi ukuran satu round, bukan total kerugian.
- Kunci keeper dan kunci Picker ada di env Vercel. Pakai dompet khusus dengan saldo kecil, tandai Sensitive, aktifkan 2FA Vercel.
- `maxDuration` 60 dtk: klaim dua vault berurutan dengan konfirmasi lambat bisa terpotong; job berikutnya mengulang.

## Urutan menyalakan
1. Terapkan file ini, `tsc --noEmit`, dan `node --test` untuk `lib/**` dan `keeper/test`.
2. Vercel: isi env dengan semua `*_MODE=dry-run`, `RFQ_URL` boleh kosong dulu. Jalankan SQL mainnet.
3. Cek `net._http_response`: indexer 200, keeper lane menjawab `dry-run`/`tunggu`, health 200.
4. Isi `KEEPER_PRIVATE_KEY` dan `ALLOW_MAINNET_CRON_KEEPER=true`, ubah satu mode ke `live` dulu (Cordon), amati, lalu Spur/Graft.
5. Pasang `/api/cron/health` ke layanan uptime eksternal (header `Authorization: Bearer <CRON_SECRET>`) supaya Anda dapat notifikasi bila 503.
