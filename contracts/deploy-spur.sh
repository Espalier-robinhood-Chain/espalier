#!/usr/bin/env bash
# Mengganti Spur vault yang MACET dengan vault baru, tanpa men-deploy ulang apa pun yang lain (testnet 46630).
# Dipakai bila round terjual tetapi harga settlement tidak bisa dicatat (print terlambat > maxPrintDelay DAN round terakhir
# sebelum expiry tidak segar): rollRound butuh active == false dan kontrak sengaja tanpa jalur admin, jadi vault itu tidak
# bisa jalan lagi. Vault baru memakai ulang OracleRouter, SettlementOracle, HarvestAuction (daftar Picker + KEEPER tetap
# berlaku), USDG, dan token NVDA dari deploy B1. Yang baru hanya satu SpurVault.
# Jalankan dari folder contracts/.
#
#   bash deploy-spur.sh dry      simulasi dan cek, tidak mengirim apa pun
#   bash deploy-spur.sh send     deploy sungguhan (SEKALI saja; skrip menolak send kedua)
#
# Pengirim = espalier-owner (ADMIN akhir vault baru). FORCE=1 mengabaikan peringatan "vault lama tidak tampak macet".
set -euo pipefail
cd "$(dirname "$0")"
[ -f .env ] || { echo ".env tidak ada di $(pwd)"; exit 1; }
set -a; source .env; set +a
R="${RH_RPC_TESTNET:?RH_RPC_TESTNET kosong}"
command -v jq >/dev/null || { echo "jq belum terpasang: sudo apt install -y jq"; exit 1; }
command -v forge >/dev/null || { echo "forge belum terpasang (foundryup)"; exit 1; }

MODE="${1:-dry}"; [[ "$MODE" == dry || "$MODE" == send ]] || { echo "mode: dry | send"; exit 1; }
B1=deployments/robinhood-testnet-mock-live.json
CFG=script/config/robinhood-testnet-mock-live.json
OUT=deployments/spur-v2-testnet-mock.json
[ -f "$B1" ] && [ -f "$CFG" ] || { echo "butuh $B1 dan $CFG"; exit 1; }
[ -f "$OUT" ] && [ "$MODE" = send ] && { echo "$OUT sudah ada: vault pengganti sudah pernah di-deploy. Pindahkan file itu dulu bila memang mau deploy ulang."; exit 1; }

addr_ok() { [[ "$1" =~ ^0x[0-9a-fA-F]{40}$ ]]; }
get() { jq -r "$1" "$B1"; }
export ROUTER SETTLEMENT AUCTION USDG ASSET OWNER KEEPER GUARDIAN FILL_WINDOW MIN_DEPOSIT DEPOSIT_CAP OTM_BPS MIN_PREMIUM_BPS
ROUTER="$(get .oracleRouter)"; SETTLEMENT="$(get .settlementOracle)"; AUCTION="$(get .harvestAuction)"; USDG="$(get .premiumToken)"
ASSET="$(get '.tokens[4]')"; OLD="$(get .spurVault)"
OWNER="$(jq -r .admin.owner "$CFG")"; KEEPER="$(jq -r .admin.keeper "$CFG")"; GUARDIAN="$(jq -r '.admin.guardian // "0x0000000000000000000000000000000000000000"' "$CFG")"
FILL_WINDOW="$(jq -r .spur.fillWindowSeconds "$CFG")"; MIN_DEPOSIT="$(jq -r .spur.minDeposit "$CFG")"; DEPOSIT_CAP="$(jq -r .spur.depositCap "$CFG")"
OTM_BPS="$(jq -r .spur.otmBps "$CFG")"; MIN_PREMIUM_BPS="$(jq -r .spur.minPremiumBps "$CFG")"
for v in ROUTER SETTLEMENT AUCTION USDG ASSET OLD OWNER KEEPER GUARDIAN; do addr_ok "${!v}" || { echo "$v tidak valid: ${!v}"; exit 1; }; done

# NVDA harus token yang sama dengan vault lama (jangan sampai indeks tokens[] bergeser).
OLD_ASSET="$(cast call "$OLD" 'ASSET()(address)' --rpc-url "$R")"
[ "${OLD_ASSET,,}" = "${ASSET,,}" ] || { echo "tokens[4]=$ASSET beda dari ASSET vault lama ($OLD_ASSET). Berhenti."; exit 1; }
[ "$(cast call "$OLD" 'AUCTION()(address)' --rpc-url "$R" | tr A-F a-f)" = "$(tr A-F a-f <<<"$AUCTION")" ] || { echo "AUCTION vault lama beda dari $AUCTION. Berhenti."; exit 1; }

echo "chain id : $(cast chain-id --rpc-url "$R")  (harus 46630)"
echo "vault lama: $OLD"
ACTIVE="$(cast call "$OLD" 'active()(bool)' --rpc-url "$R")"
RND="$(cast call "$OLD" 'round()(uint64)' --rpc-url "$R" | awk '{print $1}')"
echo "  active=$ACTIVE round=$RND"
if [ "$ACTIVE" != true ] && [ "${FORCE:-0}" != 1 ]; then
  echo "Vault lama TIDAK aktif (round tidak berjalan), jadi tidak macet: keeper bisa roll lagi. Tidak perlu vault baru."
  echo "Kalau tetap mau: FORCE=1 bash $0 $MODE"; exit 1
fi
echo "baru     : asset=$ASSET usdg=$USDG auction=$AUCTION owner=$OWNER keeper=$KEEPER fillWindow=${FILL_WINDOW}s otm=${OTM_BPS}bps"

if [ "$MODE" = dry ]; then
  forge script script/DeploySpur.s.sol --rpc-url "$R" --account espalier-owner --sender "$OWNER"
  echo "(dry-run selesai: belum ada yang dikirim. Lanjut: bash $0 send)"; exit 0
fi

forge script script/DeploySpur.s.sol --rpc-url "$R" --account espalier-owner --sender "$OWNER" --broadcast
[ -f "$OUT" ] || { echo "tidak ada $OUT"; exit 1; }
NEW="$(jq -r .spurVault "$OUT")"
TX="$(jq -r '[.transactions[] | select(.contractName=="SpurVault")][0].hash' "broadcast/DeploySpur.s.sol/46630/run-latest.json")"
BLOCK="$(cast receipt "$TX" blockNumber --rpc-url "$R")"
H=0x0000000000000000000000000000000000000000000000000000000000000000
KEEPER_ROLE="$(cast keccak KEEPER_ROLE)"

echo "---- cek ulang lewat RPC ----"
echo "ASSET()     : $(cast call "$NEW" 'ASSET()(address)' --rpc-url "$R")  (harus $ASSET)"
echo "AUCTION()   : $(cast call "$NEW" 'AUCTION()(address)' --rpc-url "$R")  (harus $AUCTION)"
echo "round/active: $(cast call "$NEW" 'round()(uint64)' --rpc-url "$R" | awk '{print $1}') / $(cast call "$NEW" 'active()(bool)' --rpc-url "$R")  (harus 0 / false)"
echo "owner ADMIN : $(cast call "$NEW" 'hasRole(bytes32,address)(bool)' "$H" "$OWNER" --rpc-url "$R")  (harus true)"
echo "keeper      : $(cast call "$NEW" 'hasRole(bytes32,address)(bool)' "$KEEPER_ROLE" "$KEEPER" --rpc-url "$R")  (harus true)"
echo
echo "==== langkah berikutnya ===="
echo "vault baru: $NEW  (blok deploy $BLOCK)"
echo "1) Supabase (SQL editor): hapus baris vault LAMA dulu, simbol harus unik. Cascade ke round dan harvest:"
echo "     delete from positions where contract = '${OLD,,}';"
echo "     delete from vaults where address = '${OLD,,}';"
echo "     delete from indexer_state where key = 'spur:46630:${OLD,,}';"
echo "2) indexer/.env : SPUR_VAULT_ADDRESS=$NEW"
echo "                  SPUR_START_BLOCK=$BLOCK"
echo "3) .env.local   : NEXT_PUBLIC_SPUR_VAULT_ADDRESS=$NEW"
echo "4) keeper/.env  : SPUR_VAULT_ADDRESS=$NEW   (bila keeper Spur dipakai)"
echo "5) picker.sh otomatis memakai $OUT. Restart indexer dan 'npm run dev'."
echo "6) Vault baru kosong. Deposit lagi (stoknya mock; NVDA vault lama yang terkunci tidak bisa dipindah), lalu keeper/owner roll:"
echo "     bash refresh-all-feeds.sh   # harga live segar dulu (pasar harus buka)"
echo "     (rollRound(expiry) oleh KEEPER, lalu: bash picker.sh fill spur <premi>)"
echo "7) Jangan lupa: biarkan 'LOOP=600 bash refresh-all-feeds.sh' jalan SAMPAI lewat expiry, lalu dalam 2 jam: bash picker.sh print spur && bash picker.sh finish spur"
