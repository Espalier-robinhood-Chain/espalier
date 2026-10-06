# Indexer (tahap 3 + 6)

Server terpisah dari web. Membaca event `CordonVault` dan mengisi Supabase: `cordons`, `cordon_assets`, `positions`, `nav_points`. Web tidak berubah: Realtime sudah menyiarkan baris baru `nav_points`.

Tahap 6 menambah jalur **Spur** (opsional, aktif bila `SPUR_VAULT_ADDRESS` diisi): mengisi `vaults`, `rounds`, `harvests`, dan `positions` untuk `SpurVault`.

## Cara kerja
- **Posisi**: event `Transfer` share hanya menandai akun yang berubah. Saldo dibaca absolut dari kontrak di blok aman terbaru (`head - CONFIRMATIONS`), lalu di-upsert; saldo 0 menghapus baris. Memproses ulang rentang yang sama tidak pernah menggandakan data, dan tidak perlu node arsip.
- **NAV**: `tryNav()` di blok aman terbaru, ditulis ke `nav_points` setelah tiap putaran yang menemukan blok baru, plus snapshot berkala (`NAV_EVERY_MS`) karena harga oracle berubah tanpa transaksi. Bila ada komponen tanpa harga valid (`ok=false`), titik NAV dilewati, bukan ditulis salah.
- **Kursor**: tabel `indexer_state` (migrasi `0006`). Urutan tulis: posisi, NAV, kursor. Crash di tengah = rentang diproses ulang.
- **Bangun ulang dari nol** (onchain = sumber kebenaran): `delete from indexer_state;` (dan kosongkan `positions` bila perlu), jalankan ulang.

## Jalur Spur (tahap 6)
Kode: `spur-ledger.ts` (murni), `spur-sync.ts` (orkestrasi), `spur-chain.ts` / `spur-store.ts` (adapter), `spur-abi.ts`.
- **Kenapa beda dari Cordon**: posisi Spur bukan ERC-20 dan setoran baru menjadi share saat `rollRound`. "Berapa share akun X selama round n" tidak bisa dibaca belakangan tanpa node arsip, jadi share per akun dihitung dengan mereplikasi aturan kontrak dari event (setoran/penarikan antre, konversi `floor(amount*1e18/ppsStart)` per akun saat roll, premium `floor(floor(premium*2^128/totalShares)*share/2^128)`). Hasilnya sama dengan pembulatan kontrak, jadi premium tampil `0.999999`, bukan `1`.
- **`rounds`**: event hanya menandai round yang berubah; isinya dibaca absolut dari `getRound(n)` di blok aman. Status: `open` (belum terjual), `auctioned` (terjual), `settled`, `cancelled` (`RoundClosedUnsold`). `RoundSkipped` (tidak ada opsi) tidak membuat baris, karena strike/expiry tidak ada. `settled_at` = waktu blok `RoundSettled`.
- **`harvests`**: satu baris per (akun, round) saat `RoundSold`. `claimPremium` mengambil semua hak yang menumpuk, jadi satu event `PremiumClaimed` mengisi `claimed_at` untuk semua round yang belum diklaim akun itu.
- **`positions`**: share vault (skala 18 desimal) setelah roll. Setoran yang masih antre belum dihitung sebagai posisi.
- **Pagar integritas**: tiap akun yang berubah dibandingkan dengan `sharesOf` di blok aman; total share tiap roll dan jumlah tiap klaim dibandingkan dengan event kontrak (toleransi pembulatan saja). Selisih = galat keras, kursor tidak maju. Ini lebih baik berhenti daripada menulis angka yang salah ke halaman publik.
- **Snapshot**: kursor dan ledger disimpan di satu baris `indexer_snapshots` (migrasi `0007`), jadi atomik. Urutan tulis: `rounds` -> `positions` -> `harvests` -> snapshot; semuanya upsert, jadi crash di tengah hanya mengulang batch.
- **Bangun ulang**: `delete from indexer_snapshots where key like 'spur:%';` lalu jalankan ulang dari `SPUR_START_BLOCK` (blok deploy `SpurVault`). Tidak butuh node arsip. `START_BLOCK` terlalu besar terdeteksi sebagai "round terlewat".
- **ABI event** ditulis tangan di `spur-abi.ts` dan dijaga oleh `test/spur-abi.test.ts` agar identik dengan `contracts/src/SpurVault.sol`.

## Menjalankan
```bash
cd indexer && npm install       # butuh ../packages/sdk (file:)
npm test                        # 23 tes, tanpa jaringan
cp .env.example .env            # lalu isi; jalankan dengan: node --env-file=.env --experimental-strip-types src/main.ts
```
Terapkan dulu `supabase/migrations/0006_indexer_state.sql` (dan `0007_indexer_snapshots.sql` bila memakai Spur). Kunci `SUPABASE_SERVICE_ROLE_KEY` hanya untuk server ini, jangan pernah masuk `NEXT_PUBLIC_*`.

`START_BLOCK` wajib: isi dengan blok deploy vault (ada di explorer atau receipt `Deploy.s.sol`).

## Batasan yang diketahui
- Seed demo: kolom `symbol` di `cordons` unik. Bila ada cordon demo `cMAG7` dengan alamat lain, indexer berhenti dengan galat unik. Hapus atau ganti simbol baris demo itu dulu.
- `cost_basis_usd` belum diisi (butuh NAV saat mint per akun); `prunings` belum ada karena kontrak belum punya event pruning (tahap 4, keeper).
- Penerima fee (`feeRecipient`) ikut tercatat sebagai pemegang karena fee dicetak sebagai share.
- NAV historis saat backfill tidak direkonstruksi (butuh node arsip): grafik terisi mulai indexer menyala.
- Kode adapter (`viem-chain.ts`, `supabase-store.ts`) belum dijalankan terhadap RPC/Supabase sungguhan; logika inti (`sync.ts`) yang dites.

### Batasan jalur Spur
- `spur-chain.ts` (viem) sudah diuji terhadap kontrak hasil `Deploy.s.sol` di anvil lewat `keeper/e2e/spur-anvil.ts` (satu siklus penuh: round terjual dan settled, round tanpa pembeli, klaim premium, sinkron inkremental). `spur-store.ts` (Supabase) belum dijalankan terhadap database sungguhan; ia hanya diuji lewat tiruan antarmuka `SpurStore`.
- `cost_basis_usd` posisi Spur belum diisi, jadi `/wall` menilai posisi vault Spur 0 (perilaku lama untuk vault tanpa cost basis).
- Snapshot ledger menyimpan semua akun berposisi dalam satu baris JSON. Cukup untuk ribuan akun; di atas itu perlu dipecah per akun.
- Jumlah `harvests` per round adalah penjumlahan pembulatan per round; kontrak membulatkan kumulatif, jadi total klaim bisa beda sampai 1 satuan terkecil USDG per round dari penjumlahan baris. Pagar klaim menoleransi selisih sebesar itu.
- Simbol vault unik: bila ada vault demo (`sNVDA`) dengan alamat lain, indexer berhenti dengan galat unik. Hapus baris demo atau pakai `SPUR_VAULT_SYMBOL`.
- Keeper (`rollRound`, `fill`, `settleRound`) belum ada, jadi di testnet baris `rounds` baru muncul bila ada yang memanggilnya.
