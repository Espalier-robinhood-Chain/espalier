# cCHIP: panduan jalan (testnet 46630)

Semua path relatif ke akar repo `espalier-main`. File di folder ini punya path yang sama, tinggal timpa / salin.

## Yang saya ubah

| Bagian | Perubahan |
|---|---|
| `contracts/script/DeployCordon.s.sol` (baru) | Deploy **satu CordonVault baru** ke deployment B1 yang sudah ada, pakai `OracleRouter` yang sama. NVDA mock dipakai ulang. AMD, AVGO, TSM = token + feed mock baru. |
| `contracts/script/config/cchip-testnet-mock.json` (baru) | Konfigurasi cCHIP. Bobot **25% x 4** (asumsi saya, di halaman tertulis "To be set"). Fee 10/10/50 bps sama dengan cMAG7. Seed 1000 cCHIP ke owner. |
| `contracts/deploy-cchip.sh` (baru) | `dry` lalu `send`, cek ulang, lalu mencetak baris env yang siap disalin. |
| `contracts/refresh-cchip-feeds.sh` (baru) | Menyegarkan feed mock (mencegah `PriceUnavailable(8)`). |
| `indexer/src/config.ts`, `main.ts` | Env baru `EXTRA_CORDONS=alamat@blokDeploy`. Tiap Cordon punya kursor dan snapshot NAV sendiri, galat di satu Cordon tidak menghentikan yang lain. |
| `lib/web3/env.ts`, `components/trade-panels.tsx`, `components/trade-live.tsx` | Web mendukung dua Cordon: env `NEXT_PUBLIC_CCHIP_VAULT_*`. Panel mint/redeem memilih vault sesuai simbol di URL. |
| `app/cordons/page.tsx` | cCHIP pindah dari "Not yet planted" ke "In the garden" begitu indexer sudah menulisnya ke database. cVOLT tetap di "Not yet planted". |

Terverifikasi di sandbox: `tsc` web dan indexer, `eslint`, tes web (111 lulus), tes indexer (29 lulus, termasuk 2 tes baru `EXTRA_CORDONS`, 3 tes baru env cCHIP).
**Tidak terverifikasi: kompilasi Solidity.** Foundry tidak ada di sandbox saya, jadi `DeployCordon.s.sol` belum pernah dikompilasi. Itu sebabnya langkah 1 adalah `dry`. Kalau ada galat kompilasi, tempel apa adanya.

## Langkah

### 1. Deploy cCHIP (dari folder `contracts/`)

```bash
bash deploy-cchip.sh dry     # simulasi: tidak mengirim apa pun, mencetak estimasi gas
bash deploy-cchip.sh send    # kirim sungguhan
```

- Pengirim = keystore **`espalier-owner`** (password owner), bukan `espalier-testnet`. Deployer lama sudah melepas ADMIN, sedangkan mendaftarkan AMD/AVGO/TSM butuh ADMIN `OracleRouter`.
- Pastikan saldo ETH testnet di `0xE0bf...2f47` cukup (skrip menampilkan saldonya).
- Skrip **tidak idempoten**: menjalankan `send` dua kali men-deploy cCHIP kedua. Kalau `send` berhasil, jangan diulang.
- Di akhir, skrip mencetak baris untuk langkah 3: alamat vault dan **blok deploy**-nya.

### 2. Segarkan feed

```bash
bash refresh-cchip-feeds.sh
```

Feed mock tidak update sendiri. Tanpa ini harga basi, NAV tidak ditulis, dan mint gagal. Harga bawaan: NVDA 250, AMD 160, AVGO 310, TSM 200 (ubah lewat `PRICE_AMD=170 bash ...`). Feed NVDA dipakai bersama cMAG7, Spur, dan Graft, jadi harga NVDA ikut berubah di sana (250 sama dengan yang dipakai di sesi sebelumnya).
Ini minta password keystore tiap transaksi (4 kali per putaran). Untuk testnet boleh `PASSWORD_FILE=...` dan `LOOP=600`.

### 3. Isi env

**`indexer/.env`**: tambahkan satu baris (nilai dari output langkah 1). Sisanya tidak berubah:

```env
CORDON_VAULT_ADDRESS=0x5DA77352D8587d325f01AB058F89f62B424Ef002   # cMAG7, tetap
EXTRA_CORDONS=0x<ALAMAT_CCHIP>@<BLOK_DEPLOY_CCHIP>
```

**`.env.local`** (web): tambahkan tiga baris. `NEXT_PUBLIC_CORDON_VAULT_*` untuk cMAG7 jangan diubah:

```env
NEXT_PUBLIC_CCHIP_VAULT_ADDRESS=0x<ALAMAT_CCHIP>
NEXT_PUBLIC_CCHIP_VAULT_CHAIN_ID=46630
NEXT_PUBLIC_CCHIP_VAULT_SYMBOL=cCHIP
```

Tidak ada perubahan di `keeper/.env` (pruning cCHIP belum ada: keeper masih dry-run, hanya untuk satu Cordon).

### 4. Jalankan ulang

```bash
cd indexer && node --env-file=.env --experimental-strip-types src/main.ts
# terminal lain, dari akar repo (wajib restart: NEXT_PUBLIC_* di-inline saat start)
npm run dev
```

Di log indexer harus muncul `indexer siap: cCHIP @ 0x... (chain 46630), 4 komponen`. Setelah itu `/cordons` menampilkan cCHIP di "In the garden". Grafik NAV butuh minimal dua titik harga valid (`NAV_EVERY_MS` default 5 menit), jadi jaga feed tetap segar.

### 5. Coba mint di web

Mint in-kind menarik **keempat** token komponen. Token mock bisa dicetak siapa saja. Ganti `<WALLET>` dengan alamat wallet kamu, jalankan dari `contracts/` (env sudah dimuat):

```bash
NVDA=0xd7F0Eccb089280156c454fe3AD9aF924c40f6BD2
CH=deployments/cchip-testnet-mock.json
for T in $NVDA $(jq -r '.tokens[1]' $CH) $(jq -r '.tokens[2]' $CH) $(jq -r '.tokens[3]' $CH); do
  cast send $T "mint(address,uint256)" <WALLET> 100000000000000000000 \
    --rpc-url "$RH_RPC_TESTNET" --account espalier-owner
done
```

Seed awal: 0.01 NVDA, 0.015 AMD, 0.008 AVGO, 0.012 TSM per share (+ fee mint 10 bps). Jadi 100 token tiap aset sangat cukup. Buka `/cordons/cCHIP`, cek angka "You receive" sebelum konfirmasi.

## Hal yang perlu kamu tahu

- **Bobot 25% x 4 adalah asumsi saya.** Kalau mau bobot lain, ubah `targetBps` di `cchip-testnet-mock.json` (total harus 10000) **sebelum** `send`. Setelah deploy, bobot tidak bisa diubah.
- Alamat token NVDA di config (`0xd7F0...6BD2`) dan router (`0x7918...Cd0e`) saya ambil dari catatan sesi. Kalau deploy B1 kamu pernah diulang, cocokkan dengan `deployments/robinhood-testnet-mock-live.json`.
- Indexer di Alchemy: batas `eth_getLogs` paket gratis (10 blok) sudah kamu atasi dengan PAYG. cCHIP dimulai dari blok deploy-nya sendiri, jadi penyisirannya kecil.
- cVOLT belum dikerjakan (basket "Set from available Stock Tokens" belum punya daftar aset).
- Rotasi kunci Alchemy dan Supabase yang pernah tertempel di chat (catatan sesi bagian 12) masih belum dicentang.
