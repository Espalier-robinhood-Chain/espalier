# cVOLT: panduan jalan (testnet 46630)

Semua path relatif ke akar repo `espalier`. File di folder ini punya path yang sama, tinggal timpa / salin. `*.sh` sudah berakhiran baris LF.

## Yang saya buat / ubah

| Bagian | Perubahan |
|---|---|
| `contracts/script/config/cvolt-testnet-mock.json` (baru) | Konfigurasi cVOLT: **TSLA, RIVN, LCID, NIO, bobot 25% x 4**. TSLA = token mock B1 yang sama dengan cMAG7 (dipakai ulang). RIVN, LCID, NIO = token + feed mock baru. Fee 10/10/50 bps. Seed 1000 cVOLT ke owner. |
| `contracts/deploy-cvolt.sh` (baru) | `dry` lalu `send`. Mengambil alamat TSLA dari `deployments/robinhood-testnet-mock-live.json` (dicek lewat NVDA dulu), menulis config terselesaikan, lalu memanggil `DeployCordon.s.sol` yang sudah dipakai cCHIP. Menolak `send` kedua bila `deployments/cvolt-testnet-mock.json` sudah ada. |
| `contracts/refresh-cvolt-feeds.sh` (baru) | Menyegarkan feed TSLA, RIVN, LCID, NIO. |
| `lib/web3/env.ts`, `env.test.ts` | Web mendukung tiga Cordon: env `NEXT_PUBLIC_CVOLT_VAULT_*`. Tes env: 21 lulus. |
| `.env.local.example` | Blok env cVOLT. |
| `app/cordons/page.tsx` | Kartu "Not yet planted" cVOLT menampilkan TSLA, RIVN, LCID, NIO dan bobot Equal. Begitu indexer menulis cVOLT ke database, kartunya pindah ke "In the garden". |

Tidak ada perubahan di `DeployCordon.s.sol` dan indexer: keduanya sudah mendukung Cordon tambahan (`EXTRA_CORDONS` dipisah koma). Karena itu tidak ada kode Solidity baru yang perlu dikompilasi.
Terverifikasi: tes env web (21 lulus), `bash -n` kedua skrip, logika pengisian TSLA dengan file B1 contoh. **Tidak terverifikasi:** `forge`/`cast` dan eksekusi on-chain (tidak ada di sandbox saya), makanya langkah 1 adalah `dry`.

## Langkah

### 1. Deploy cVOLT (dari folder `contracts/`)

```bash
bash deploy-cvolt.sh dry     # simulasi: tidak mengirim apa pun
bash deploy-cvolt.sh send    # kirim sungguhan, SEKALI saja
```

- Pengirim = keystore **`espalier-owner`**. Pastikan chain id 46630 dan saldo owner cukup.
- Kalau skrip bilang `tokens[4] ... bukan NVDA`, struktur file B1 kamu berbeda. Ambil alamat token TSLA mock sendiri (dari `deployments/robinhood-testnet-mock-live.json` atau explorer) lalu: `TSLA_TOKEN=0x... bash deploy-cvolt.sh dry`.
- Di akhir, skrip mencetak blok "salin ke env": alamat vault dan blok deploy-nya.

### 2. Segarkan feed

```bash
bash refresh-cvolt-feeds.sh
```

Meminta password 4 kali (TSLA, RIVN, LCID, NIO). Default: TSLA 300, RIVN 15, LCID 3, NIO 5 (ubah: `PRICE_RIVN=18 bash ...`). Feed TSLA dipakai bersama cMAG7. Ulangi kapan pun harga basi (sekitar 15 menit), atau `LOOP=600`.

### 3. Isi env

`indexer/.env`: **tambahkan** cVOLT ke `EXTRA_CORDONS` yang sudah berisi cCHIP, dipisah koma (jangan ganti, nanti cCHIP hilang dari indexer):

```env
EXTRA_CORDONS=0x3F905b6D5Eb5BEf0dbC90a8C1a00A12D4A190B64@130694185,0x<ALAMAT_CVOLT>@<BLOK_DEPLOY_CVOLT>
```

`.env.local`: tambahkan tiga baris:

```env
NEXT_PUBLIC_CVOLT_VAULT_ADDRESS=0x<ALAMAT_CVOLT>
NEXT_PUBLIC_CVOLT_VAULT_CHAIN_ID=46630
NEXT_PUBLIC_CVOLT_VAULT_SYMBOL=cVOLT
```

### 4. Jalankan ulang

Indexer (terminal baru, atau `unset` variabel lama dulu supaya nilai `.env` tidak ditimpa env shell), lalu web (restart wajib):

```bash
cd indexer && node --env-file=.env --experimental-strip-types src/main.ts
# terminal lain, dari akar repo
npm run dev
```

Di log harus muncul `indexer siap: cVOLT @ 0x... (chain 46630), 4 komponen`. `/cordons` lalu menampilkan cVOLT di "In the garden". Grafik NAV butuh minimal dua titik valid.

### 5. Coba mint

Mint in-kind menarik keempat token. Dari `contracts/` (jalankan di terminal sendiri, `source .env` memengaruhi shell itu):

```bash
set -a; source .env; set +a
CV=deployments/cvolt-testnet-mock.json
for T in $(jq -r '.tokens[]' $CV); do
  cast send $T "mint(address,uint256)" <ALAMAT_WALLET_KAMU> 1000000000000000000000 \
    --rpc-url "$RH_RPC_TESTNET" --account espalier-owner
done
```

Seed per share: 0,008 TSLA, 0,16 RIVN, 0,8 LCID, 0,48 NIO (+ fee mint 10 bps), sekitar US$2,4 per aset, US$9,6 per share. 1000 token tiap aset cukup untuk sekitar 1.000 share. Buka `/cordons/cVOLT`, sambungkan wallet, cek "You receive" sebelum konfirmasi.

## Yang perlu kamu tahu

- **Bobot 25% x 4 dan harga mock adalah pilihanmu/perkiraan saya.** Bobot tidak bisa diubah setelah deploy. Ubah `targetBps` (total 10000) di `cvolt-testnet-mock.json` sebelum `send` bila perlu.
- `cvolt-testnet-mock.resolved.json` dibuat otomatis oleh skrip deploy. Jangan di-commit.
- Panel mint tetap demo kalau `NEXT_MODE`, `NEXT_PUBLIC_REOWN_PROJECT_ID`, atau `NEXT_PUBLIC_RH_RPC_TESTNET` kosong, atau server dev belum di-restart.
- Indexer memakai satu RPC untuk semua Cordon. cVOLT dimulai dari blok deploy-nya sendiri, jadi penyisirannya kecil.
- Key Alchemy, dRPC, dan Supabase yang tertempel di chat sebaiknya diganti.
