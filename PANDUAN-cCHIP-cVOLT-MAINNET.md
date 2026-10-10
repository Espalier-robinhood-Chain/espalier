# cCHIP dan cVOLT di Mainnet (Robinhood Chain 4663)

> Belum diaudit dan **belum dikompilasi atau dijalankan** (tidak ada Foundry di lingkungan pembuatan). Jalankan `forge test` dulu.
> Paket ini bertumpu pada `espalier-main (20)` + `mainnet-changes (1)` + `mainnet-otomatis`: semuanya sudah digabung di zip ini, tinggal timpa.

## Komposisi mainnet

| Cordon | Komponen | Beda dari testnet |
|---|---|---|
| cCHIP | NVDA, AMD, TSM, MU (25% x 4) | MU menggantikan AVGO (AVGO tidak punya token/feed Robinhood). Cadangan lain: INTC. |
| cVOLT | TSLA, PLTR, RKLB, IONQ (25% x 4) | PLTR, RKLB, IONQ menggantikan RIVN, LCID, NIO (tanpa token/feed Robinhood). |

NVDA dan TSLA sudah menjadi komponen cMAG7, jadi hanya **6 aset baru** yang perlu didaftarkan ke OracleRouter: AMD, TSM, MU, PLTR, RKLB, IONQ.

## Kenapa ada perubahan di `Deploy.s.sol`

Setelah deploy utama, ADMIN OracleRouter dipegang timelock 48 jam. Mendaftarkan aset baru sesudahnya butuh Safe menjadwalkan transaksi lalu menunggu 48 jam. Maka 6 aset baru didaftarkan **di deploy utama** lewat bagian baru `routerAssets` (hanya masuk router, bukan komponen cMAG7). Setelah itu cCHIP/cVOLT bisa di-deploy kapan saja tanpa menyentuh router.

## Yang berubah

| File | Perubahan |
|---|---|
| `contracts/script/Deploy.s.sol` | Bagian opsional `routerAssets` di config: divalidasi (mode nyata, kode ada, tanpa duplikat), didaftarkan ke router, dan diverifikasi ulang. Tanpa bagian itu perilakunya sama seperti sebelumnya. |
| `contracts/script/config/robinhood-mainnet.json` | Ditambah `routerAssets` (6 aset, alamat dari spreadsheet Anda, staleness 90000 seperti aset lain). |
| `contracts/script/DeployCordonMainnet.s.sol` (baru) | Deploy satu CordonVault ke deployment mainnet yang ada. Tidak membuat mock, tidak mendaftarkan aset, pengirim tidak perlu peran apa pun di router. Peran KEEPER diberikan, lalu ADMIN diserahkan ke timelock dan pengirim melepasnya. Mati sebelum transaksi pertama bila ada yang tidak cocok. |
| `contracts/script/config/cchip-mainnet.json`, `cvolt-mainnet.json` (baru) | Konfigurasi dua Cordon. `router`, `owner` (timelock), `keeper`, `addressesVerified`, dan fee diisi otomatis oleh skrip shell. |
| `contracts/deploy-cordon-mainnet.sh` (baru) | `dry` lalu `send`, konfirmasi ketik, cek ulang lewat RPC, dan mencetak baris env. |
| `contracts/script/verify-addresses.sh` | Ikut memeriksa `routerAssets`, dan mencocokkan token+feed di config cCHIP/cVOLT dengan config utama. |
| `contracts/test/Deploy.t.sol`, `DeployCordonMainnet.t.sol` | 10 tes `routerAssets` dan 15 tes skrip Cordon mainnet. **Belum dijalankan.** |
| `vercel.mainnet.env.example`, `PANDUAN-MAINNET.md` | Catatan urutan `EXTRA_CORDONS` dan rujukan ke panduan ini. |
| (dari paket sebelumnya) | `keeper`, `rfq`, `cron/picker-claim`, `cron/health`, SQL cron mainnet, `PANDUAN-OTOMATIS-MAINNET.md`: tidak diubah, hanya digabung. |

## Keputusan yang harus Anda ambil

1. **Nama cVOLT.** Isinya sudah bukan kendaraan listrik (PLTR, RKLB, IONQ). Saya pakai nama netral `Espalier Cordon VOLT`; ganti di `cvolt-mainnet.json` bila mau. Situs dan README masih menulis "Electric vehicles" dan AVGO/RIVN/LCID/NIO (`app/cordons/page.tsx` baris kartu "planned", `README.md`). Itu tidak saya ubah karena testnet masih memakai komposisi lama; kartu itu hanya tampil sampai indexer menulis Cordon-nya, tapi teksnya sebaiknya Anda samakan dengan mainnet.
2. **Bobot.** 25% x 4 adalah asumsi saya (situs menulis "To be set" untuk cCHIP).
3. **Fee.** Skrip menyalin fee dari `robinhood-mainnet.json` (sama dengan cMAG7). Isi dulu di sana, termasuk `recipient` bila fee > 0.
4. **Staleness 90000 dtk** untuk 6 aset baru, sama dengan aset lama. Kalau feed AMD/TSM/MU/PLTR/RKLB/IONQ punya heartbeat berbeda, ubah di `routerAssets` **sebelum** deploy utama (setelahnya harus lewat timelock).
5. **Cordon tidak di-seed** (supply awal 0). Seed butuh token asli di dompet deployer dan hanya bisa sebelum serah-terima; `seed.enabled` tetap bisa dinyalakan di config Cordon bila Anda mau.

## Urutan (deploy utama belum dilakukan)

1. Timpa file dari zip ini ke `espalier-main`.
2. Lengkapi `robinhood-mainnet.json` (owner Safe, guardian, keeper, fee, pickers, holidays) seperti di `PANDUAN-MAINNET.md`.
3. `RH_RPC_MAINNET=... bash script/verify-addresses.sh`. Harus **SEMUA OK** untuk 13 aset dan dua config Cordon. Lalu `addressesVerified` ke `true`.
4. `cd contracts && forge test`. Tempel galat kompilasi bila ada.
5. Deploy utama (dry-run lalu `--broadcast`) seperti di `PANDUAN-MAINNET.md`. Sekarang router mendaftarkan 13 aset.
6. `DEPLOYER_ADDRESS=0x... bash deploy-cordon-mainnet.sh cchip dry`, lalu `send`. Setelah itu `cvolt`. **cCHIP dulu**: urutan di `EXTRA_CORDONS` menentukan cordon1 = cCHIP, cordon2 = cVOLT.
7. Salin baris env yang dicetak ke Vercel (`EXTRA_CORDONS=cchip@blok,cvolt@blok`, `NEXT_PUBLIC_CCHIP_VAULT_*`, `NEXT_PUBLIC_CVOLT_VAULT_*`), lalu redeploy. Job `cordon1`/`cordon2` di SQL cron mainnet sudah ada.
8. `bash script/smoke.sh robinhood-mainnet`, verifikasi kontrak di Blockscout.

Kalau deploy utama **sudah terlanjur** dilakukan tanpa `routerAssets`: skrip Cordon akan berhenti dengan pesan "belum terdaftar di OracleRouter". Jalan keluarnya: Safe menjadwalkan 6 panggilan `setAssetWindows` lewat timelock, tunggu 48 jam, eksekusi, baru jalankan skrip Cordon.

## Pruning cCHIP/cVOLT

Keeper mendapat KEEPER_ROLE, tapi `setPruneVenue`, `setExecutionVenue`, dan slippage hanya bisa ADMIN (timelock 48 jam), sama seperti cMAG7. Mint dan redeem in-kind tidak membutuhkannya. Biarkan `KEEPER_MODE=dry-run` sampai venue diatur.

## Catatan alamat dari tangkapan layar

Alamat 6 aset baru saya salin dari gambar spreadsheet Anda. Semuanya lolos checksum EIP-55 (peluang salah-tapi-lolos sangat kecil), dan 7 alamat lama yang saya coba dengan cara sama juga lolos. Satu karakter di token **MU** tidak terbaca jelas di gambar; saya pulihkan lewat checksum menjadi `0xfF080c8ce2E5feadaCa0Da81314Ae59D232d4afD` (satu-satunya kandidat yang lolos). Bandingkan dengan spreadsheet, dan `verify-addresses.sh` akan memeriksa symbol, decimals, feed, dan `uiMultiplier` langsung dari chain.

## Yang belum diuji

- Semua Solidity (`Deploy.s.sol`, `DeployCordonMainnet.s.sol`, dua file tes) belum pernah dikompilasi. Hanya keseimbangan tanda kurung yang dicek.
- Skrip shell hanya dicek sintaksnya (`bash -n`); bagian `jq` tidak dijalankan.
- Tidak ada tes untuk `CONFIRM_MAINNET_DEPLOY=false` di skrip Cordon (variabel env dipakai bersama antar tes).
- Simulasi terhadap RPC mainnet (`dry`) adalah pemeriksaan sesungguhnya pertama; jalankan sebelum `send`.
