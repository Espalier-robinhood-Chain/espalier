# Espalier

Aplikasi Next.js 16 tunggal (struktur Next.js biasa, bukan monorepo). Stack: Next.js 16, Tailwind v4, Motion, Supabase.

```bash
npm install
cp .env.local.example .env.local   # isi URL + key Supabase
npm run dev          # http://localhost:3000  dan  /dev/components
npm run typecheck && npm run lint && npm test && npm run build
```

Supabase: terapkan `supabase/migrations/0001_init.sql` lalu `0002_rounds_spot_start.sql` (SQL Editor atau `supabase db push`).
Halaman `/dev/components` hanya untuk pemeriksaan dan akan dihapus (`/setup` sudah dihapus saat Landing dibuat).
`scripts/fake-postgrest.mjs`: server PostgREST palsu untuk menguji Route Handler tanpa Supabase (jalankan `node scripts/fake-postgrest.mjs`, lalu isi `NEXT_PUBLIC_SUPABASE_URL=http://localhost:4010` dan `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=fake` sebelum `npm run build`; nilai NEXT_PUBLIC di-inline saat build).

Supabase: terapkan juga `0003_realtime.sql` (menambah `nav_points` dan `rounds` ke publication `supabase_realtime`; tanpa ini Realtime tersambung tetapi tidak mengirim event).
`scripts/fake-supabase.mjs`: PostgREST + Realtime palsu + endpoint admin. `scripts/e2e-live.mjs` menyalakannya bersama `next start` dan menguji pembaruan langsung di Chromium

## Login wallet dan privasi The Wall (migrasi 0004)

Terapkan `0004_wall_privacy.sql`. Migrasi ini membuat fungsi `wallet_addresses()`, tabel `wall_preferences`, dan **mengganti** kebijakan baca publik `positions` dan `harvests`: Wall bawaannya privat.

Setelah migrasi, **seed demo harus menambahkan baris `wall_preferences (account, is_private=false)` untuk tiap akun demo** (lewat service role), kalau tidak Wall demo tidak bisa dibuka siapa pun.

Pengaturan Supabase (dashboard) yang dibutuhkan login:
1. Authentication → Providers → **Web3 Wallet** → aktifkan Ethereum.
2. Authentication → URL Configuration → Redirect URLs: tambahkan `http://localhost:3000/**` dan domain produksi `https://<domain>/**` (Supabase mencocokkan domain dan URI pesan yang ditandatangani).
3. Authentication → Rate Limits (Web3) dan CAPTCHA: atur sebelum publik (akun wallet gratis dibuat).

**Verifikasi login pertama** (wajib, lihat catatan item 22 di checklist). Setelah satu kali sign in, jalankan di SQL editor:

    select provider, provider_id, identity_data from auth.identities where provider = 'web3';
    select public.wallet_addresses(); -- jalankan sebagai user itu (lewat rpc dari aplikasi); harus berisi alamat huruf kecil

`wallet_addresses()` hanya menerima `provider_id` berbentuk `[awalan:]0x<40 hex>`. Bila bentuk sungguhan berbeda, fungsi mengembalikan `{}` (tertutup) dan Wall pemilik tidak akan terbuka; sesuaikan regex di migrasi.
(build dulu dengan `NEXT_PUBLIC_SUPABASE_URL=http://localhost:4010 NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=fake`; butuh `playwright`, opsional `axe-core`, terpasang global).

Gambar share dan OG (`next/og`, Satori): `GET /api/accounts/[address]/card.png` (Harvest Card terbaru; 404 bila belum ada Harvest), `GET /api/accounts/[address]/wall.png` (pohon + hitungan; 404 bila tanpa posisi), dan `opengraph-image` di `/`, `/cordons/[symbol]`, `/vaults/[symbol]` (1200×630). Tanpa nominal dolar dan tanpa alamat di gambar.
Font gambar: ttf statis di `assets/og-fonts/` (Satori tidak membaca woff2; cara membuatnya ada di README di folder itu). `NEXT_PUBLIC_SITE_URL` harus terisi saat build supaya URL gambar OG di halaman statis benar.

Pohon 3D di Landing: `components/hero-tree.tsx` memuat `three` lewat `next/dynamic` (ssr:false) setelah browser idle dan hanya bila WebGL ada; pohon SVG (`WallTree`) tetap tampilan awal dan cadangan, lalu disembunyikan setelah frame 3D pertama. Bentuk 3D dihitung dari `TreeInput` yang sama di `lib/tree3d-layout.ts` (diuji). Tema, reduced-motion, tombol "Grow again", dan seret untuk memutar mengikuti espalier.html.
Hitung mundur di Landing (`components/demo-countdown.tsx`, logika di `lib/schedule.ts`): Jumat 16:00 ET dengan `Intl` zona `America/New_York`, plus jam WIB. Berlabel "Illustrative schedule". Libur bursa dan feed 24/5 belum tercakup (pertanyaan terbuka 9); `RoundCountdown` lama (berbasis `expiry` dari data round) tidak diubah.

Pohon 3D, pembaruan: semua posisi digambar sampai `MAX_CORDONS_3D` (20 cordon = 10 tingkat kawat). Di atas 4 tingkat, kawat dirapatkan di rentang tinggi yang hampir sama, daun dan buah mengecil (`layout.scale`), dan daun per cordon dikurangi supaya jumlah mesh terkendali. Sampai 8 posisi bentuknya sama seperti sebelumnya. Posisi di atas 20 dihitung di `hiddenCordons` dan disebut di `aria-label`.
`components/garden-tree.tsx` (`GardenTree`) adalah komponen pohon bersama: 3D bila bisa, SVG sebagai tampilan awal dan cadangan. `HeroTree` hanya alias untuk Landing. `/wall` dan Landing memakai `GardenTree`. `WallTree` (SVG) tetap dipakai untuk Harvest Card dan sebagai cadangan di dalam `GardenTree`.
Tes browser jalur 3D: `scripts/e2e-tree3d.mjs` (Chromium + SwiftShader, butuh `playwright` global). Halaman bantu `/dev/tree3d?n=12&h=14&s=5` hanya hidup di dev, atau di production bila `ENABLE_DEV_PAGES=1`; hapus bersama `/dev/components`.
```bash
npm run build && ENABLE_DEV_PAGES=1 npm run start
BASE_URL=http://localhost:3000 node scripts/e2e-tree3d.mjs
```
Catatan: pohon 3D hanya menggambar bentuk "Horizontal tiers". Bentuk Fan, Candelabra, dan Belgian fence di pohon SVG belum punya padanan 3D.

Struktur: kode aplikasi ada di root (`app/`, `components/`, `lib/`, `assets/`, `public/`). Logika pohon yang dulu paket `@espalier/tree` kini `lib/tree/` dan diimpor sebagai `@/lib/tree` (di dalam `lib/*.ts` yang dijalankan `node --test`: `./tree/index.ts`, karena Node tidak membaca alias `@/`). File di `lib/tree/` yang diuji lewat `node --test` harus mengimpor dengan ekstensi `.ts`.

Audit kontras (tanpa dependensi): `node scripts/audit-contrast.mjs` menghitung rasio WCAG dari token di `app/globals.css` untuk tema terang dan gelap; kode keluar 1 bila ada yang gagal.

## Tata letak gabungan (Fase 1 + Fase 2)

- Akar repo = aplikasi Next.js (Fase 1). `packages/sdk` = `@espalier/sdk` (ABI, kuotasi mint/redeem, dekode error; punya `package.json` sendiri, belum jadi workspace npm: `cd packages/sdk && npm install && npm test`). `contracts/` = Foundry (Fase 2).
- **`contracts/`** berisi `src/`, `test/` (termasuk `test/fork/`), `script/`, dan konfigurasi Foundry. `lib/` (forge-std, OpenZeppelin v5.4.0) tidak ada di zip: jalankan `forge install` sesuai `contracts/README.md`. `packages/sdk/scripts/gen-abis.mjs` membaca `contracts/src` dan `contracts/lib`.
- `tsconfig.json` dan `eslint.config.mjs` mengecualikan `packages/` dan `contracts/` (sdk punya tsconfig sendiri). Rincian dan status verifikasi: lihat "Struktur repo gabungan" di checklist.

## Panel mint/redeem sungguhan (tahap 2 Alur Kerja)

`components/trade-live.tsx` memanggil `CordonVault` lewat wagmi dan `@espalier/sdk` (alias di `tsconfig.json`, belum workspace npm). Aktif hanya bila `NEXT_MODE` (`mainnet`/`testnet`), `NEXT_PUBLIC_REOWN_PROJECT_ID` dan `NEXT_PUBLIC_CORDON_VAULT_ADDRESS` terisi, chain vault sama dengan mode, dan simbol di URL sama dengan `NEXT_PUBLIC_CORDON_VAULT_SYMBOL`; selain itu panel tetap simulasi. `NEXT_MODE` kosong = seluruh situs simulasi tanpa wallet (`trade-panels.tsx`).

- **Mint**: jumlah yang diketik adalah *share* yang diterima (kontrak: `mint(shares, to, maxAmounts)`). Vault menarik tiap token komponen, bukan USDG. Kuotasi dari `previewMint`, batas atas = kuotasi + slippage (0,5% atau 1%). Token yang allowance-nya kurang di-approve satu per satu, sebesar batas setoran saja (bukan tak terbatas), lalu `mint`.
- **Redeem**: in-kind semua komponen (`redeem(shares, to, fullMask, minAmounts)`). Opsi "To USDG" dimatikan: vault tidak punya jalur USDG onchain.
- Sebelum dikirim, transaksi di-`simulateContract`; error kontrak diterjemahkan oleh `decodeCordonError` + `cordonErrorMessage` (`lib/web3/trade.ts`). Penolakan di wallet tidak dianggap error.
- Pasar tutup memblokir mint di UI (sama seperti sebelumnya); redeem in-kind tetap jalan. Penjeda aset onchain (`AssetPaused`) tetap ditegakkan kontrak.
- Setelah transaksi terkonfirmasi, saldo dan kuotasi dibaca ulang. NAV di halaman baru berubah setelah indexer ada (tahap 3).

Belum diuji di jaringan: kode ini ditulis tanpa `npm install` (registry diblokir di lingkungan penulisnya), jadi `typecheck`, `lint`, dan `build` belum dijalankan. Jalankan `npm run typecheck && npm run lint && npm test && npm run build`, lalu coba di anvil (`anvil --chain-id 46630`, deploy jalur mock sesuai `contracts/README.md`) sebelum testnet.

## Panel deposit/withdraw Spur sungguhan (tahap 8)

`components/spur-live.tsx` memanggil `SpurVault` lewat wagmi dan `@espalier/sdk` (`packages/sdk/src/spur.ts`: `readSpurInfo`, `readSpurAccount`, `decodeSpurError`, `spurWriteAbi`). `DepositWithdrawPanel` memilihnya hanya bila `asset="stock"` (Spur), `NEXT_MODE` dan `NEXT_PUBLIC_REOWN_PROJECT_ID` terisi, `NEXT_PUBLIC_SPUR_VAULT_ADDRESS` terisi, `NEXT_PUBLIC_SPUR_VAULT_SYMBOL` (default `sNVDA`) sama dengan simbol di URL, dan chain vault sama dengan `NEXT_MODE`. Selain itu panel tetap simulasi. **Graft tetap simulasi** di web: kontrak `GraftVault` sudah ada (`contracts/src/GraftVault.sol`), tetapi SDK/keeper/indexer/panel web untuk Graft belum.

- **Deposit**: approve sebesar jumlah (bukan tak terbatas), lalu `deposit`. Setoran masuk antrean dan baru menjadi share saat roll berikutnya; sebelum itu bisa dibatalkan penuh (`cancelDeposit`).
- **Withdraw**: pengguna mengetik jumlah Stock Token, kontrak meminta *share*. Konversi dibulatkan ke bawah (`planWithdraw`), dan jumlah yang sama dengan nilai seluruh share bebas berarti tarik semua. Penarikan diantrikan, dihargai saat roll berikutnya (setelah opsi round ini settle), lalu diambil lewat `claimWithdraw`. Selama antre, share tetap menanggung risiko dan tetap berhak atas premium round yang berjalan.
- **Premium**: `claimPremium` mengambil USDG yang sudah menjadi hak akun.
- Jeda hanya menutup deposit; withdraw dan klaim tetap terbuka (UI mencerminkannya).
- Aturan "receipt sudah diproses roll" (`queuedDeposit`, `queuedWithdrawShares`, `lib/web3/spur.ts`) sama dengan kontrak: setoran dengan `round <= round()` tidak lagi bisa dibatalkan. Ini diuji terhadap kontrak asli, bukan hanya tiruan.
- Keadaan dibaca ulang setelah tiap transaksi dan tiap 30 detik (roll dan settlement terjadi tanpa interaksi pengguna).
- **Perubahan terhadap halaman vault**: aturan "simulator wajib sebelum deposit" tetap berlaku untuk panel demo. Untuk panel live, deposit dibuka juga saat tidak ada round aktif (vault baru, atau di antara dua round), karena tanpa itu round pertama tidak pernah bisa dimulai lewat UI (roll tanpa share dilewati). Halaman lalu menjelaskan bahwa strike dan premium ditetapkan saat roll. Satu baris `canDeposit` di `app/vaults/[symbol]/page.tsx`; ubah bila produk memutuskan lain.
- Uji ujung-ke-ujung terhadap kontrak hasil `Deploy.s.sol` di anvil: `scripts/e2e-spur-panel.ts` (petunjuk di kepala berkas). Mencakup deposit, batal, roll, antre dan batal penarikan, fill quote EIP-712, klaim premium, settlement, dan klaim penarikan, dengan pengecekan bahwa error kontrak dan error token ter-decode jadi nama.
- ABI `SpurVault` dan `HarvestAuction` kini ada di `packages/sdk/src/abis.ts` (hasil `npm run gen:abis` di `packages/sdk`, butuh `contracts/lib`). Indexer dan keeper masih memakai `spur-abi.ts` sendiri yang dijaga tes; migrasi ke SDK opsional.
- Sisa yang belum ada: indexer belum mengisi `cost_basis_usd` posisi Spur (lihat `indexer/README.md`), jadi `/wall` masih menilai posisi vault Spur 0 walau deposit sudah sungguhan. Perlu keputusan: cost basis murni (butuh harga saat deposit) atau kolom nilai baru.

## Indexer (tahap 3)
`indexer/` = server terpisah yang mengisi `positions` dan `nav_points` dari event `CordonVault`. Terapkan `supabase/migrations/0006_indexer_state.sql`. Detail dan batasan: `indexer/README.md`.

## Keeper pruning (tahap 4, off-chain saja)
`keeper/` = perencana dan siklus keeper, mode dry-run saja (kontrak belum punya `prune`). Detail dan daftar sisa pekerjaan: `keeper/README.md`.
