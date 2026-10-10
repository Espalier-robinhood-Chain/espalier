# Panduan pindah ke Mainnet (Robinhood Chain 4663)

> Perangkat lunak ini **belum diaudit**. Jangan menerima deposit nyata sebelum audit eksternal selesai.
> Mulai dengan deposit cap kecil dan naikkan bertahap.

## Yang berubah di paket ini
| File | Perubahan |
|---|---|
| `contracts/script/Deploy.s.sol` | Bagian baru `routerAssets` di config: aset yang hanya didaftarkan ke OracleRouter (untuk cCHIP/cVOLT, lihat `PANDUAN-cCHIP-cVOLT-MAINNET.md`). Mainnet tidak lagi ditolak mutlak. Diizinkan hanya bila `_validateMainnet` lolos: tanpa mock, `addressesVerified=true`, timelock >= 172800 dtk, `admin.owner` = kontrak multisig, guardian/keeper/sequencer feed terisi, depositCap Spur/Graft tidak nol, dan env `CONFIRM_MAINNET_DEPLOY=true`. |
| `contracts/test/Deploy.t.sol` | Tes penolakan mainnet disesuaikan + tes baru (tanpa timelock, owner EOA). **Belum dijalankan** (tidak ada Foundry di lingkungan pembuatan): jalankan `forge test` dulu. |
| `contracts/script/config/robinhood-mainnet.json` | Template baru. Semua alamat `0x0` dan `addressesVerified=false` sampai Anda isi dari sumber resmi. |
| `contracts/script/verify-addresses.sh` | Baru. Cek on-chain (hanya baca) semua token, feed, dan USDG di config mainnet. |
| `contracts/script/smoke.sh` | Boleh dijalankan ke mainnet (hanya baca), memakai `RH_RPC_MAINNET`. |
| `app/api/cron/keeper/route.ts` | Di chain 4663 menolak jalan kecuali `ALLOW_MAINNET_CRON_KEEPER=true`. |
| `vercel.mainnet.env.example` | Template env mainnet tanpa rahasia. |

Tidak diubah (sengaja tetap testnet-only): `DeployCordon.s.sol` (cCHIP/cVOLT mainnet memakai `DeployCordonMainnet.s.sol`), `DeploySpur.s.sol` (tanpa timelock), `/api/rfq`, `/api/cron/feeds`, skrip `deploy-*.sh` yang memakai mock. Frontend (`NEXT_MODE=mainnet`) sudah mendukung 4663.

## Urutan
1. **Lengkapi `robinhood-mainnet.json`**. Token, feed, dan USDG sudah terisi (dicocokkan dengan Robinhood docs + Chainlink). Isi: owner (Safe di 4663), guardian, keeper, fee, depositCap, dan cocokkan `holidays` dengan kalender NYSE. Jalankan `RH_RPC_MAINNET=... bash script/verify-addresses.sh`; bila semua ok, ubah `addressesVerified` ke `true`.
2. `cd contracts && forge test` (semua harus hijau), lalu fork test dengan feed asli.
3. Simpan kunci deployer di keystore/hardware wallet (`cast wallet import espalier-mainnet --interactive` atau `--ledger`), jangan di `.env`.
4. Dry-run (tanpa `--broadcast`):
   ```bash
   export RH_RPC_MAINNET=https://...
   export DEPLOY_CONFIG=script/config/robinhood-mainnet.json
   export CONFIRM_MAINNET_DEPLOY=true
   forge script script/Deploy.s.sol --rpc-url robinhood_mainnet --account espalier-mainnet --sender <ALAMAT>
   ```
5. Kirim: tambahkan `--broadcast`. Tidak idempoten dan serah-terima ADMIN tidak bisa dibatalkan.
6. `bash script/smoke.sh robinhood-mainnet`, lalu verifikasi kontrak di Blockscout. cCHIP dan cVOLT: lanjut ke `PANDUAN-cCHIP-cVOLT-MAINNET.md`.
7. Supabase: project baru, terapkan migrasi, jadwalkan cron (`supabase/cron/espalier-cron.sql`) **tanpa** job `espalier-feeds`.
8. Vercel: isi env dari `vercel.mainnet.env.example` (kunci baru), lalu **redeploy**. Daftarkan domain di Reown.
9. Jalankan indexer dengan `START_BLOCK` = block deploy. Jalankan keeper dulu dengan `*_MODE=dry-run`, baru `live`.
10. Peluncuran: cap kecil, tes nominal kecil, pastikan guardian bisa pause.

## Catatan hasil verifikasi alamat
- **Sequencer Uptime Feed Robinhood Chain tidak ada.** Chainlink tidak mencantumkannya dan berhenti menambah jaringan baru. Config memakai `sequencer.allowDisabled=true`. Risiko: sequencer dioperasikan Robinhood (terpusat); mitigasi lewat guardian/pause dan staleness.
- **Staleness 90000 dtk** (heartbeat Chainlink 86400 + 1 jam) agar mint/redeem tidak macet saat harga tidak bergerak: feed 24/5, deviasi 0.5%, tanpa heartbeat di luar jam pasar. Konsekuensinya harga bisa setua ~25 jam bila oracle mati. Ketatkan setelah mengamati `updatedAt` di mainnet.
- Feed Robinhood sudah mengalikan `uiMultiplier` (harga per token), jadi kontrak tidak perlu mengalikan lagi. Selama corporate action, token memasang `oraclePaused()`; config memakai `checkOraclePause=true`.
