#!/usr/bin/env bash
# Deploy HarvestAuction + SpurVault + GraftVault ke MAINNET (4663), menambah ke deployment mainnet yang SUDAH ada.
# Jalankan dari folder contracts/. WAJIB isi semua env berikut (tidak ada nilai bawaan untuk cap):
#   DEPLOYER_ADDRESS=0x...        alamat kunci deployer (keystore DEPLOYER_ACCOUNT, bawaan espalier-mainnet)
#   PICKER_ADDRESS=0x...          alamat Picker BARU (didaftarkan sekarang; menambah nanti butuh timelock 48 jam)
#   SPUR_DEPOSIT_CAP=<mentah>     batas deposit Spur dalam satuan mentah token aset (18 desimal)
#   GRAFT_DEPOSIT_CAP=<mentah>    batas deposit Graft dalam satuan mentah USDG (6 desimal)
#   bash deploy-spurgraft-mainnet.sh dry     -> simulasi, tidak mengirim apa pun
#   bash deploy-spurgraft-mainnet.sh send    -> broadcast sungguhan (minta konfirmasi ketik)
# JANGAN jalankan dengan "| tee" atau "| tail": pertanyaan konfirmasi dan password jadi tidak terlihat.
set -euo pipefail
cd "$(dirname "$0")"

MODE="${1:-dry}"
NAME="spurgraft-mainnet"
[ -f .env ] && { set -a; source .env; set +a; }
: "${RH_RPC_MAINNET:?RH_RPC_MAINNET kosong}"
: "${DEPLOYER_ADDRESS:?isi DEPLOYER_ADDRESS}"
: "${PICKER_ADDRESS:?isi PICKER_ADDRESS (dompet Picker baru)}"
: "${SPUR_DEPOSIT_CAP:?isi SPUR_DEPOSIT_CAP (satuan mentah, 18 desimal)}"
: "${GRAFT_DEPOSIT_CAP:?isi GRAFT_DEPOSIT_CAP (satuan mentah USDG, 6 desimal)}"
ACCOUNT="${DEPLOYER_ACCOUNT:-espalier-mainnet}"
for c in jq cast forge; do command -v "$c" >/dev/null || { echo "$c belum terpasang"; exit 1; }; done
[[ "$SPUR_DEPOSIT_CAP" =~ ^[1-9][0-9]*$ && "$GRAFT_DEPOSIT_CAP" =~ ^[1-9][0-9]*$ ]] || { echo "cap harus bilangan bulat positif tanpa titik/koma"; exit 1; }

MAIN=deployments/robinhood-mainnet.json
MAINCFG=script/config/robinhood-mainnet.json
TEMPLATE=script/config/$NAME.json
RESOLVED=script/config/$NAME.resolved.json
[ -f "$MAIN" ] || { echo "butuh $MAIN (hasil deploy utama mainnet)"; exit 1; }
[ -f "$TEMPLATE" ] || { echo "tidak ada $TEMPLATE"; exit 1; }

ROUTER="$(jq -r .oracleRouter "$MAIN")"
SETTLEMENT="$(jq -r .settlementOracle "$MAIN")"
OWNER="$(jq -r .timelock "$MAIN")"                 # ADMIN akhir = timelock yang sama dengan cMAG7 dan router
KEEPER="$(jq -r .admin.keeper "$MAINCFG")"
GUARDIAN="$(jq -r .admin.guardian "$MAINCFG")"
USDG="$(jq -r .spur.premiumToken "$MAINCFG")"
ASSET_SYMBOL="$(jq -r .assetSymbol "$TEMPLATE")"
ASSET="$(jq -r --arg s "$ASSET_SYMBOL" '[.assets[]|select(.symbol==$s)][0].token' "$MAINCFG")"
VERIFIED="$(jq -r .addressesVerified "$MAINCFG")"
ZERO=0x0000000000000000000000000000000000000000
for v in ROUTER SETTLEMENT OWNER KEEPER GUARDIAN USDG ASSET PICKER_ADDRESS; do
  [[ "${!v}" =~ ^0x[0-9a-fA-F]{40}$ && "${!v}" != "$ZERO" ]] || { echo "$v tidak valid: ${!v}"; exit 1; }
done
[ "$VERIFIED" = "true" ] || { echo "addressesVerified di $MAINCFG masih $VERIFIED: jalankan script/verify-addresses.sh dulu"; exit 1; }

CID="$(cast chain-id --rpc-url "$RH_RPC_MAINNET")"
echo "chain id        : $CID  (harus 4663)"
[ "$CID" = "4663" ] || { echo "chain id bukan 4663, berhenti"; exit 1; }
echo "router          : $ROUTER"
echo "settlement      : $SETTLEMENT"
echo "owner (timelock): $OWNER"
echo "keeper          : $KEEPER"
echo "guardian        : $GUARDIAN"
echo "picker          : $PICKER_ADDRESS"
echo "usdg            : $USDG"
echo "aset acuan      : $ASSET_SYMBOL ($ASSET)"
echo "spur cap (mentah) : $SPUR_DEPOSIT_CAP"
echo "graft cap (mentah): $GRAFT_DEPOSIT_CAP"
echo "pengirim        : $DEPLOYER_ADDRESS  (keystore: $ACCOUNT)"
echo "saldo pengirim  : $(cast balance "$DEPLOYER_ADDRESS" --rpc-url "$RH_RPC_MAINNET" -e) ETH"
ZEROH=0x0000000000000000000000000000000000000000000000000000000000000000
[ "$(cast call "$ROUTER" 'hasRole(bytes32,address)(bool)' "$ZEROH" "$OWNER" --rpc-url "$RH_RPC_MAINNET")" = "true" ] \
  || { echo "owner BUKAN ADMIN router: pastikan deployments/robinhood-mainnet.json adalah deploy yang benar"; exit 1; }

jq --arg r "$ROUTER" --arg s "$SETTLEMENT" --arg o "$OWNER" --arg k "$KEEPER" --arg g "$GUARDIAN" \
   --arg u "$USDG" --arg a "$ASSET" --arg p "$PICKER_ADDRESS" --argjson v "$VERIFIED" \
   --arg sc "$SPUR_DEPOSIT_CAP" --arg gc "$GRAFT_DEPOSIT_CAP" \
  '.router=$r | .settlement=$s | .owner=$o | .keeper=$k | .guardian=$g | .usdg=$u | .asset=$a | .picker=$p
   | .addressesVerified=$v | .spur.depositCap=$sc | .graft.depositCap=$gc' "$TEMPLATE" > "$RESOLVED"
export SPURGRAFT_CONFIG="$RESOLVED"
export CONFIRM_MAINNET_DEPLOY=true

case "$MODE" in
  dry)
    forge script script/DeploySpurGraftMainnet.s.sol --rpc-url "$RH_RPC_MAINNET" \
      --account "$ACCOUNT" --sender "$DEPLOYER_ADDRESS" ;;
  send)
    if [ -f "deployments/$NAME.json" ]; then
      echo "deployments/$NAME.json sudah ada: Spur/Graft sepertinya sudah pernah di-deploy. send lagi men-deploy set kedua."
      echo "Kalau memang mau deploy ulang, pindahkan dulu file itu."; exit 1
    fi
    read -r -p "Ketik 'DEPLOY SPUR GRAFT' untuk mengirim ke MAINNET: " CONFIRM
    [ "$CONFIRM" = "DEPLOY SPUR GRAFT" ] || { echo "dibatalkan"; exit 1; }
    forge script script/DeploySpurGraftMainnet.s.sol --rpc-url "$RH_RPC_MAINNET" \
      --account "$ACCOUNT" --sender "$DEPLOYER_ADDRESS" --broadcast
    FILE="deployments/$NAME.json"
    [ -f "$FILE" ] || { echo "tidak ada $FILE"; exit 1; }
    SPUR="$(jq -r .spurVault "$FILE")"; GRAFT="$(jq -r .graftVault "$FILE")"; AUCTION="$(jq -r .harvestAuction "$FILE")"
    BR="broadcast/DeploySpurGraftMainnet.s.sol/4663/run-latest.json"
    blk() { cast receipt "$(jq -r --arg n "$1" '[.transactions[]|select(.contractName==$n)][0].hash' "$BR")" blockNumber --rpc-url "$RH_RPC_MAINNET"; }
    SB="$(blk SpurVault)"; GB="$(blk GraftVault)"
    KEEPER_ROLE="$(cast keccak KEEPER_ROLE)"; GUARDIAN_ROLE="$(cast keccak GUARDIAN_ROLE)"
    echo "---- cek ulang lewat RPC ----"
    for pair in "spur:$SPUR" "graft:$GRAFT" "auction:$AUCTION"; do
      n="${pair%%:*}"; a="${pair#*:}"
      echo "$n timelock ADMIN : $(cast call "$a" 'hasRole(bytes32,address)(bool)' "$ZEROH" "$OWNER" --rpc-url "$RH_RPC_MAINNET")  (harus true)"
      echo "$n pengirim ADMIN : $(cast call "$a" 'hasRole(bytes32,address)(bool)' "$ZEROH" "$DEPLOYER_ADDRESS" --rpc-url "$RH_RPC_MAINNET")  (harus false)"
      echo "$n keeper         : $(cast call "$a" 'hasRole(bytes32,address)(bool)' "$KEEPER_ROLE" "$KEEPER" --rpc-url "$RH_RPC_MAINNET")  (harus true)"
    done
    echo "spur guardian   : $(cast call "$SPUR" 'hasRole(bytes32,address)(bool)' "$GUARDIAN_ROLE" "$GUARDIAN" --rpc-url "$RH_RPC_MAINNET")  (harus true)"
    echo "graft guardian  : $(cast call "$GRAFT" 'hasRole(bytes32,address)(bool)' "$GUARDIAN_ROLE" "$GUARDIAN" --rpc-url "$RH_RPC_MAINNET")  (harus true)"
    echo "picker terdaftar: $(cast call "$AUCTION" 'isPicker(address)(bool)' "$PICKER_ADDRESS" --rpc-url "$RH_RPC_MAINNET")  (harus true)"
    echo "spur.depositCap : $(cast call "$SPUR" 'depositCap()(uint256)' --rpc-url "$RH_RPC_MAINNET")"
    echo "graft.depositCap: $(cast call "$GRAFT" 'depositCap()(uint256)' --rpc-url "$RH_RPC_MAINNET")"
    echo
    echo "==== salin ke env Vercel (lalu REDEPLOY) ===="
    echo "NEXT_PUBLIC_SPUR_VAULT_ADDRESS=$SPUR"
    echo "SPUR_VAULT_ADDRESS=$SPUR"
    echo "SPUR_START_BLOCK=$SB"
    echo "NEXT_PUBLIC_GRAFT_VAULT_ADDRESS=$GRAFT"
    echo "GRAFT_VAULT_ADDRESS=$GRAFT"
    echo "GRAFT_START_BLOCK=$GB"
    echo "RFQ_AUCTION_ADDRESS=$AUCTION"
    echo "Lalu verifikasi kontrak di Blockscout dan jalankan: RPC_URL=\$RH_RPC_MAINNET bash script/smoke.sh robinhood-mainnet" ;;
  *) echo "pakai: dry | send"; exit 1 ;;
esac
