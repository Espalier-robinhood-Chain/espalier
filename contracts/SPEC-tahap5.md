# Spesifikasi tahap 5: SpurVault, HarvestAuction, RFQ, keeper round

**Status: spesifikasi, bukan kode.** Kontrak ini memegang dana pengguna. Di lingkungan penulisan tidak ada `forge`/`solc`, jadi Solidity-nya tidak saya tulis tanpa bisa dikompilasi dan diuji. Dokumen ini merangkum yang sudah ditetapkan (halaman `/docs`, alur kerja, `lib/docs/payoff.ts`, keputusan Anda) dan menandai yang HARUS diputuskan dari brief sebelum kode ditulis.

## Sudah ditetapkan (sumber di kurung)
- **Round mingguan**, expiry Jumat 16:00 ET (`lib/schedule.ts`, ilustratif; libur bursa dan feed 24/5 = pertanyaan terbuka 9).
- **Awal round**: `rollRound` memasukkan deposit yang antre dan menetapkan strike (alur kerja 3.1, docs).
- **Strike = persen tetap OTM** (keputusan Anda). Spur: di atas harga, bulatkan ke atas; Graft: di bawah harga, bulatkan ke bawah (`keeper/src/rounds.ts: strikeFor`, dites). Strike dan premi per **token**, bukan per saham (multiplier dividen, docs).
- **Picker membayar premi** lewat RFQ (quote EIP-712 bertanda tangan); round berubah `open -> auctioned` (alur kerja 3.2).
- **Settlement** memakai `SettlementOracle` yang sudah ada: harga dicatat sekali dan permanen, keeper tidak bisa memilih harga (alur kerja 3.4).
- **Payoff** (docs, `lib/docs/payoff.ts`):
  - Spur (covered call, token): harga <= strike -> Picker 0. Harga > strike -> vault membayar Picker `amount x (harga - strike) / harga` dalam **token**.
  - Graft (cash-secured put, USDG): harga >= strike -> 0. Harga < strike -> vault membayar `amount x (strike - harga)` dalam **USDG**. Pengguna bisa rugi lebih dari premi.
- **Harvest**: pengguna meng-claim premi; layanan cards membuat Harvest Card (The Wall).
- **Tabel** sudah ada: `vaults`, `rounds` (status `open|auctioned|settled|cancelled`), `harvests`, `positions`.
- Transisi status yang diizinkan (`canTransition`): `open -> auctioned | cancelled`, `auctioned -> settled`. Terminal: `settled`, `cancelled`.

## Harus diputuskan dari brief (saya tidak mengarang)
1. Apa yang terjadi bila round `open` melewati expiry tanpa Picker: `cancelled` (asumsi saat ini), atau premi 0 dan tetap settle?
2. Bagaimana Picker dipilih: siapa saja yang menandatangani RFQ, atau daftar Picker ber-izin? Ada batas harga minimum premi?
3. Withdraw saat round berjalan: antre ke round berikutnya (teks UI "Withdrawals queue to the next round") dan deposit yang belum masuk round bisa ditarik instan. Konfirmasi akuntansi share: share vault dihitung per round atau per NAV?
4. Strike: berapa persen OTM, tick, dan apakah per vault atau global; siapa yang boleh mengubahnya (ADMIN/timelock disarankan, bukan KEEPER).
5. Settlement Graft memakai strike value yang ditahan sebagai backing: USDG dikunci saat deposit atau saat round dibuka?
6. Fee (kalau ada) di Spur/Graft dan batas hardcode-nya, mengikuti pola `CordonVault`.
7. Stock token corporate action (`oraclePaused`): round ditahan sampai pulih (pola `SettlementOracle`), atau dibatalkan?

## Kebutuhan keamanan (usul)
- Keeper hanya boleh memicu `rollRound` dan `settle`; tidak boleh memilih harga, strike di luar aturan, atau memindahkan dana. Peran `KEEPER_ROLE` (ada di `Roles.sol`); mengubah parameter = ADMIN/timelock.
- `settle` menolak bila `SettlementOracle.settlement(token, expiry).exists == false`; jumlah payoff dihitung di kontrak dari harga itu, bukan dari argumen.
- RFQ: domain EIP-712 memuat `chainId` dan `verifyingContract`. Struct usul: `Quote(address picker, address vault, uint64 roundNo, uint256 premiumUsdg, uint256 strike, uint64 deadline, uint256 nonce)`. Tolak bila `deadline` lewat, `nonce` sudah dipakai, round bukan `open`, atau `strike` tidak sama dengan strike round. Premi dibayar dengan `transferFrom` Picker dalam transaksi yang sama (tanpa kustodi di layanan RFQ). Tanda tangan `ecrecover` dengan penolakan `s` tinggi dan alamat nol (pakai OpenZeppelin `ECDSA`/`SignatureChecker`).
- Reentrancy guard, `SafeERC20`, tanpa token fee-on-transfer (cek `ShortReceipt` seperti di `CordonVault`).
- Jeda aset (`isAssetPaused`) menunda settlement, tidak pernah mengunci klaim yang sudah settle.
- Invarian untuk tes (fuzz/invariant): total klaim Picker + sisa pengguna = total aset round; payoff nol di sisi OTM; tidak ada jalur yang membayar Picker sebelum settlement tercatat; claim harvest tepat sekali.

## Event yang dibutuhkan indexer (supaya DB bisa dibangun ulang dari event)
`RoundRolled(vault, roundNo, strike, expiry, notional, spotStart)`, `RoundAuctioned(vault, roundNo, picker, premiumUsdg)`, `RoundSettled(vault, roundNo, settlementPrice, payoff)`, `RoundCancelled(vault, roundNo)`, `HarvestClaimed(account, vault, roundNo, premiumUsdg)`, `Deposited/Withdrawn/Queued`. Indexer: ekstensi `indexer/src` untuk `rounds` dan `harvests` memakai pola yang sama (event menandai, nilai dibaca absolut dari kontrak).

## Urutan pengerjaan setelah brief tersedia
1. Jawab 7 pertanyaan di atas. 2. Tulis `ISpurVault`/`IHarvestAuction` + tes forge (termasuk fork dan invariant). 3. `gen-abis` ke SDK. 4. Keeper: `nextRoundAction` (sudah ada) + eksekutor kontrak. 5. Layanan RFQ (penandatangan, batas harga, nonce) dan layanan cards. 6. Indexer rounds/harvests. 7. Panel Deposit/Withdraw dan klaim Harvest di web (pola `trade-live.tsx`).

## Keputusan Graft (tahap 9): diturunkan dari brief, bukan dari asumsi
Sumber: `devbriefespalier.md` bagian 5.2 (GraftVault, SpurVault, HarvestAuction, Corporate actions), 6 (scope MVP), 7 (risiko), 9 (pertanyaan terbuka).
Pertanyaan 1 sampai 4 di atas sudah dijawab oleh implementasi `SpurVault` dan berlaku sama untuk Graft (`closeUnsold` setelah jendela penjualan, Picker di-whitelist + lantai premi, antrean ke round berikutnya + akumulator premium, `otmBps` per vault 1% sampai 50% dihitung di kontrak).

5. **Backing Graft: dikunci saat round dibuka.** Brief: "Collateral = `strike x amount` USDG per round" dan "eksposur settlement dibatasi collateral vault". Setoran antre dan baru menjadi collateral saat `rollRound` (sama seperti Spur), jadi collateral tidak berubah selama round berjalan. `notional` = collateral / strike (dibulatkan ke bawah): `notional x strike <= collateral`, payout `notional x (K - P)` selalu di bawah collateral. Brief juga menetapkan cash-settled dalam USDG; varian physical ditunda ke v2.
6. **Fee: tidak ada di MVP.** Brief hanya mendefinisikan fee untuk CordonVault (dengan batas hardcode). Untuk Spur/Graft tidak ada fee yang disebut, dan `SpurVault` juga tanpa fee. Menambah fee nanti berarti kontrak baru (vault immutable, migrasi opt-in).
7. **Corporate action: round ditahan, tidak dibatalkan.** Brief: wajib ada pause per aset; penyesuaian strike/notional setelah split lewat fungsi admin (timelock) dan tes split 1:10; mekanisme token penerbit harus dipelajari SEBELUM menulis akuntansi (pertanyaan terbuka 9.1, belum terjawab). Yang dikerjakan sekarang: aset acuan dijeda di `OracleRouter` atau `oraclePaused()` menyala = `rollRound` revert dan settlement menunggu print (pola `SettlementOracle`). Fungsi penyesuaian split SENGAJA belum ditulis (butuh jawaban 9.1); ini sama untuk Spur.

Catatan scope: brief bagian 6 menaruh Graft setelah MVP (MVP = cMAG7 + satu Spur sNVDA). Kontraknya dikerjakan atas permintaan; mainnet Graft tetap mengikuti keputusan produk, review hukum (opsi, kerugian bisa melebihi premi), dan audit.
