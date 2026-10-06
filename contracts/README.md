# Espalier contracts

Proyek Foundry (solc 0.8.28, evm cancun). Target: Robinhood Chain (testnet 46630, mainnet 4663).

```bash
# dalam repo git, dari folder contracts/
forge install foundry-rs/forge-std OpenZeppelin/openzeppelin-contracts@v5.4.0
# diuji dengan forge-std v1.9.7 dan v1.17.0
forge build && forge test
FOUNDRY_PROFILE=ci forge test      # fuzz 2000 run, invariant 512 run
forge fmt --check
slither . --config-file slither.config.json
```

## Isi

- `src/OracleRouter.sol` (Fase 2 item 2 + 3): harga Chainlink per Stock Token, 18 desimal, fail-closed. Cek sequencer uptime
  (+ grace period), advisory `oraclePaused()`, answer > 0, round valid, dan **staleness sadar sesi** (tiga jendela per aset:
  Regular/Extended/Overnight). `getPrice`/`tryGetPrice` = harga live (ditolak `MarketClosed` saat sesi Closed);
  `getReferencePrice`/`tryGetReferencePrice` = harga acuan (saat Closed, harga yang ditahan feed diterima bila segar pada
  saat pasar tutup; untuk NAV dan redeem in-kind). `freshnessReference` dipakai SettlementOracle.
- `src/MarketSession.sol` (item 3): kalender sesi 24/5 dalam waktu New York (DST AS), libur diisi admin per tanggal.
  `sessionAt(ts)` dan `lastOpenEnd(ts)`. Jam sesi sama dengan aproksimasi web (`lib/api/market.ts`), belum diverifikasi
  terhadap feed Robinhood.
- `src/SettlementOracle.sol` (item 3): harga settlement (token, expiry) dicatat sekali, dibuktikan onchain, permissionless.
  `settle` = print (round pertama dengan updatedAt >= expiry, round sebelumnya < expiry, dalam `MAX_PRINT_DELAY`);
  `settleFallback` = round terakhir sebelum expiry bila tidak ada print dalam jendela dan harga segar saat expiry.
  Aturan ini usulan untuk pertanyaan terbuka 9, belum disetujui.
- `src/CordonVault.sol` (item 4 tanpa DEX + item 5): share ERC-20 atas basket; `seed` (admin), `mint`/`redeem` proporsional in-kind
  (redeem selektif per komponen), `nav` dengan harga acuan router. Item 5: fee mint/redeem (bps) dan fee manajemen streaming,
  semuanya dalam share (bukan token), semua 0 sampai ADMIN mengatur, batas hardcode 100/100/200 bps (usulan, belum disetujui).
  `mint` ditolak bila salah satu komponen dijeda di OracleRouter; `redeem` tidak pernah ditutup. Tanpa USDG (Fase 3).
- `src/SpurVault.sol` + `src/HarvestAuction.sol` (M4, MVP satu vault, mis. sNVDA): covered call mingguan. Gardener menyetor
  Stock Token, KEEPER memanggil `rollRound(expiry)` (strike = harga oracle live x (1 + `otmBps`), default 10% OTM, dihitung
  di kontrak), Picker yang di-whitelist menandatangani quote EIP-712 dan `HarvestAuction.fill` memindahkan premium USDG ke
  vault, lalu setelah expiry `SettlementOracle.settle` dan `SpurVault.settleRound` (siapa saja). Bila P > K, Picker menerima
  `notional x (P - K) / P` Stock Token (ditarik sendiri lewat `claimPickerPayout`). Premium dibagi per share lewat akumulator
  dan diklaim lewat `claimPremium`. Setoran dan penarikan diantrikan ke roll berikutnya. Posisi BUKAN ERC-20 dan tidak bisa
  dipindahkan (MVP). Pembukuan aset internal, jadi donasi tidak menggeser harga per share. Lantai premium (`minPremiumBps`),
  batas setoran (`depositCap`), jeda (hanya `deposit` dan `rollRound`), dan batas expiry 1..14 hari dipaksa di kontrak.
  Harga per share dibulatkan ke 1e-18 (selalu merugikan penarik, hingga shares/1e18 wei per penarikan). Round dilewati
  (tanpa opsi dan tanpa oracle) bila yang tersisa di bawah `MIN_DEPOSIT`. Graft ada di `GraftVault`. BELUM ADA: share yang
  bisa dipindahkan, penyesuaian corporate action, dan integrasi ke `script/Deploy.s.sol`.
- `src/GraftVault.sol` (tahap 9): cash-secured put mingguan (mis. gNVDA), cermin `SpurVault` (struktur round, antrean, akumulator
  premium, event, `getRound`, dan ABI tulis sama, jadi `HarvestAuction`, SDK, indexer, dan keeper memakai ulang bentuk yang sama).
  Aset vault = USDG (collateral sekaligus premium), `UNDERLYING` = Stock Token acuan harga. Strike = harga live x (1 - `otmBps`)
  dibulatkan ke BAWAH; `notional` = seluruh collateral / strike dibulatkan ke bawah, sehingga `notional x strike <= managedAssets`
  (cash-secured). Collateral dikunci per round; antrean setoran/penarikan baru diproses pada roll berikutnya. Bila P < K, Picker
  menerima `notional x (K - P)` USDG (ditarik lewat `claimPickerPayout`), tidak pernah lebih dari collateral; Gardener bisa rugi
  lebih dari premium. Karena collateral dan premium satu token, `recordSale` menghitung premium sebagai tambahan di atas SELURUH
  pembukuan (managed + pending + reserved + pickerOwed + premiumHeld), bukan hanya `premiumHeld`. Tanpa fee. Aset acuan dijeda
  (`OracleRouter`) = `rollRound` revert dan settlement menunggu: round ditahan, bukan dibatalkan. BELUM ADA: varian physical,
  share yang bisa dipindahkan, penyesuaian strike/notional setelah split (menunggu mekanisme Stock Token, pertanyaan terbuka 9.1 brief).
  Keputusan dan sumbernya di brief: lihat bagian "Keputusan Graft" di `SPEC-tahap5.md`. Skrip deploy: bagian `graft` di konfigurasi
  (opsional, berbagi `HarvestAuction` dan USDG dengan `spur`). Tes: `test/GraftVault.t.sol`, `test/Deploy.t.sol`.
- `src/libraries/Roles.sol` (item 5): `KEEPER_ROLE`, `GUARDIAN_ROLE`. ADMIN = `DEFAULT_ADMIN_ROLE`, di produksi dipegang
  `TimelockController` OpenZeppelin (jeda 48 jam; multisig sebagai proposer/executor). GUARDIAN: hanya `OracleRouter.pauseAsset`
  (langsung berlaku). KEEPER: hanya MENAMBAH libur di `MarketSession`. Membuka jeda, menghapus libur, mengubah fee/aset = ADMIN.
- `script/Deploy.s.sol` (item 6): deploy `MarketSession`, `OracleRouter`, `SettlementOracle`, `CordonVault` (dan, bila
  bagian `spur` di konfigurasi aktif, `HarvestAuction` + satu `SpurVault`) dari satu file konfigurasi JSON, atur aset/libur/fee/peran, seed (opsional), lalu serahkan ADMIN. `script/smoke.sh`: pemeriksaan
  pasca-deploy lewat RPC sungguhan. `script/config/`: `robinhood-testnet.json` (template, ditolak sampai diisi) dan
  `robinhood-testnet-mock.json` (token dan feed palsu untuk rehearsal). Lihat "Deploy testnet" di bawah.
- `test/mocks/`: `MockAggregator` (feed dengan riwayat round, `getRoundData`, juga mock sequencer feed), `MockStockToken`.
- `test/data/`: `session_vectors.json` dibuat `gen_session_vectors.py` (Python `zoneinfo`, implementasi independen).
  Jalankan ulang skrip bila aturan sesi berubah.

## Peran (item 5)

| Peran | Boleh | Tidak boleh |
|---|---|---|
| ADMIN (timelock 48 jam) | `setFees`, `setFeeRecipient`, `seed`, `setAsset*`, `removeAsset`, `unpauseAsset`, hapus libur, kelola peran | melampaui batas fee hardcode |
| GUARDIAN | `pauseAsset` | membuka jeda, mengubah parameter, memberi peran, memindahkan dana |
| KEEPER | tambah libur di `MarketSession` | hapus libur, jeda, parameter |

Timelock dipasang saat deploy oleh `script/Deploy.s.sol` bila `admin.timelockDelaySeconds` > 0:
`new TimelockController(delay, [owner], [owner], address(0))`, lalu alamatnya jadi ADMIN di `MarketSession`, `OracleRouter`,
`CordonVault` (deployer melepas perannya).

## Deploy testnet (Fase 2 item 6)

Skrip siap dijalankan; **belum pernah dijalankan di Robinhood Chain Testnet**. Yang sudah terbukti hanya di EVM lokal
(`forge test`) dan anvil dengan chain id 46630. Bukti dan batasnya ada di checklist (Fase 2 item 6).

### Pra-deploy: isi dari sumber resmi, jangan dari tebakan

`script/config/robinhood-testnet.json` sengaja berisi alamat `0x0`. Skrip menolak (dan tidak mengirim transaksi apa pun)
sampai semuanya diisi dan `addressesVerified` diubah menjadi `true`.

| Isi | Dari mana | Catatan |
|---|---|---|
| `assets[].token`, `assets[].feed` | Fase 0 item 7 (halaman Token Contracts Robinhood, halaman alamat Chainlink) | Komposisi 7 ticker di template hanyalah placeholder, bobot hampir sama (6 x 1429 + 1 x 1426 = 10000) |
| `sequencer.feed` | Fase 0 item 7 | Kosong hanya boleh bila `allowDisabled: true` (pemeriksaan sequencer mati) |
| `assets[].staleness*Seconds` | heartbeat dan deviation tiap feed (pertanyaan terbuka 2) | Nilai di template (900/1800/3600) adalah contoh, bukan keputusan; bisa diubah ADMIN nanti (`setAssetWindows`) |
| `settlement.maxPrintDelaySeconds` | pertanyaan terbuka 9 | 7200 adalah contoh; batas kontrak 86400 |
| `admin.owner` | alamat multisig atau EOA testnet milik Anda | wajib; menerima ADMIN |
| `admin.timelockDelaySeconds` | keputusan Anda | 0 = tanpa timelock (owner langsung ADMIN, praktis untuk testnet); 172800 = desain produksi 48 jam |
| `admin.guardian`, `admin.keeper` | opsional | `0x0` = peran tidak diberikan |
| `fees.*` | pertanyaan terbuka 12 | semua 0 sampai diputuskan; wajib `recipient` bila ada fee > 0; batas kontrak 100/100/200 bps |
| `spur.*` (opsional) | keputusan Anda; USDG dari sumber resmi | `enabled:false` = Spur Vault tidak di-deploy (default di template). Bila `true`: `assetSymbol` harus ada di `assets`, `premiumToken` = alamat USDG (wajib ada kode), `admin.keeper` wajib, `fillWindowSeconds` 3600-172800, `otmBps` 100-5000 (1000 = strike 10% di atas harga live), `minPremiumBps` 0-2000, `minDeposit` (string mentah), `depositCap` (string; `"0"` = tanpa batas, jangan dipakai saat peluncuran publik), `pickers` (alamat yang boleh menandatangani quote; mulai dari satu alamat uji milik tim) |
| `holidays` | kalender resmi NYSE | template: 26 Nov dan 25 Des 2026. **Libur 2027 belum diisi.** Jam tutup lebih awal (13:00) belum didukung kontrak |
| `evm_version` di `foundry.toml` | dukungan ArbOS Robinhood Chain | default `cancun` (belum dipastikan). Alternatif: `FOUNDRY_EVM_VERSION=shanghai forge ...` (build dan 213 test juga lulus dengan shanghai) |

Format angka: `holidays` = `YYYYMMDD`; `seed.amounts` = string jumlah mentah (18 desimal) per aset, urutan sama dengan `assets`.

### Urutan

```bash
# dari folder contracts/ (setelah `forge install ...` di atas)
cp .env.example .env                       # isi RH_RPC_TESTNET (endpoint Alchemy/penyedia lain)
cast wallet import espalier-testnet --interactive   # kunci deployer disimpan terenkripsi; jangan taruh kunci di .env
DEPLOYER=$(cast wallet address --account espalier-testnet)   # beri ETH testnet ke alamat ini

# 1. Rehearsal lokal (gratis): token dan feed palsu, ADMIN lewat timelock 1 jam
anvil --chain-id 46630 &
DEPLOY_CONFIG=script/config/robinhood-testnet-mock.json forge script script/Deploy.s.sol \
  --rpc-url http://127.0.0.1:8545 --private-key <kunci akun #0 anvil> --broadcast
RPC_URL=http://127.0.0.1:8545 bash script/smoke.sh robinhood-testnet-mock

# 2. Dry-run di testnet: simulasi penuh, TIDAK mengirim apa pun dan tidak menulis file
forge script script/Deploy.s.sol --rpc-url robinhood_testnet --account espalier-testnet --sender "$DEPLOYER"

# 3. Kirim (tambahkan --broadcast). Hasil ditulis ke deployments/robinhood-testnet.json
forge script script/Deploy.s.sol --rpc-url robinhood_testnet --account espalier-testnet --sender "$DEPLOYER" --broadcast

# 4. Smoke test lewat RPC sungguhan (cast call; membuktikan bytecode jalan di chain targetnya)
bash script/smoke.sh robinhood-testnet
```

Butuh `cast` dan `jq` untuk `smoke.sh` (file ini tidak ber-bit eksekusi, jalankan dengan `bash script/smoke.sh ...` atau `chmod +x`).
Bila deployment memuat Spur Vault, `smoke.sh` juga memeriksa kode, keterkaitan (AUCTION/PREMIUM/ROUTER/SETTLEMENT/ASSET), dan ADMIN akhir.
Di mode mock, USDG palsu (6 desimal) dibuat skrip dan tiap alamat di `spur.pickers` menerima 1.000.000 USDG mock untuk rehearsal. `DEPLOY_CONFIG` memilih file konfigurasi (default `script/config/robinhood-testnet.json`).
Opsional, belum diuji di chain ini: `--verify --verifier blockscout --verifier-url https://explorer.testnet.chain.robinhood.com/api/`
(URL API explorer belum diverifikasi). Bila estimasi gas gagal di Orbit chain, coba `--gas-estimate-multiplier 150`
(saran umum untuk chain Arbitrum; belum dicoba di sini).

### Yang dilakukan skrip

1. Validasi konfigurasi **sebelum** transaksi pertama; berhenti bila chain id RPC berbeda dari konfigurasi, chain adalah
   mainnet (4663, selalu ditolak), alamat kosong atau tanpa kode, bobot tidak berjumlah 10000, fee > 0 tanpa penerima, dll.
2. Deploy (deployer = ADMIN sementara): `MarketSession`, `OracleRouter`, `SettlementOracle`, `CordonVault`, dan bila
   `spur.enabled`: `HarvestAuction` + `SpurVault` (KEEPER di keduanya, GUARDIAN di vault, whitelist picker; ADMIN ikut
   diserahkan ke owner/timelock).
3. Konfigurasi: `setAssetWindows` per aset, libur, peran GUARDIAN/KEEPER, penerima fee dan fee.
4. Seed (bila `seed.enabled`): **harus sebelum serah-terima**, karena `seed` menarik token dari ADMIN. Setelah ADMIN berpindah
   ke timelock, seed butuh tiga operasi terjadwal (transfer token ke timelock, approve, seed). Untuk testnet paling mudah:
   `timelockDelaySeconds: 0` dan seed oleh owner, atau seed langsung lewat konfigurasi.
5. Serah-terima: ADMIN ke `owner` (atau ke `TimelockController` baru dengan owner sebagai proposer dan executor, tanpa admin
   tambahan), lalu deployer melepas `DEFAULT_ADMIN_ROLE` di ketiga kontrak. **Tidak bisa dibatalkan**; deploy ulang = set kontrak baru.
6. Membaca kembali seluruh hasil dan membandingkannya dengan konfigurasi (peran, aset, bobot, libur, fee, seed, timelock).
   Ini berjalan di simulasi lokal, jadi mengesahkan logika dan konfigurasi, bukan perilaku chain.
7. Dengan `--broadcast`: menulis `deployments/<name>.json`. Skrip tidak idempoten: menjalankannya lagi men-deploy set baru.

Mode mock (`"mocks": true`): token ERC-20 dan feed dibuat skrip; harga feed mock cepat basi (jendela staleness menit-jam).
Segarkan dengan `cast send <feed> "setRound(int256)" 25000000000 --rpc-url ... --account ...` (siapa pun boleh memanggilnya).
Alamat admin di file mock adalah akun anvil bawaan dengan kunci **publik**: ganti bila dipakai di testnet.

## Belum

- Deploy ke testnet (item 6): skrip siap, belum dijalankan di chain (alamat dan nilai di config belum diisi).
- Spur/Graft: `SpurVault` + `HarvestAuction` sudah masuk skrip deploy dan lolos rehearsal di anvil (46630) dengan `smoke.sh`.
  Belum ada: indexer untuk round/premium, keeper yang menjalankan `rollRound`/`fill`/`settleRound`, panel web live. Graft: kontrak ada (`GraftVault`), SDK/keeper/indexer/panel web belum.
- Fork test dengan feed asli: item 8 (butuh alamat terverifikasi, Fase 0 item 7).
- Alamat feed, token, dan Sequencer Uptime Feed Robinhood Chain belum diverifikasi; jangan diisi dari tebakan.
- Nilai jendela staleness per aset dan `MAX_PRINT_DELAY` belum ditentukan (butuh heartbeat dan deviation tiap feed, pertanyaan terbuka 2).
- `evm_version = "cancun"` perlu dipastikan didukung ArbOS Robinhood Chain sebelum deploy.
- Slither dijalankan sekali (0 High, 27 Medium: semua dinilai false positive/tidak berbahaya, lihat checklist) tetapi `slither.config.json`
  memakai `fail_medium`, jadi CI akan merah sampai Medium itu dianotasi atau dikecualikan (keputusan di item 1). Aderyn belum dijalankan ulang untuk item 5.
- Jam tutup lebih awal (mis. 13:00) belum didukung `MarketSession`.
