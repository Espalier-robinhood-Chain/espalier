#!/usr/bin/env bash
# Deploy Cordon cCHIP atau cVOLT ke MAINNET (4663), menambah vault baru ke deployment mainnet yang SUDAH ada.
# Jalankan dari folder contracts/.
#   DEPLOYER_ADDRESS=0x... bash deploy-cordon-mainnet.sh cchip dry    -> simulasi, tidak mengirim apa pun
#   DEPLOYER_ADDRESS=0x... bash deploy-cordon-mainnet.sh cchip send   -> broadcast sungguhan (minta konfirmasi ketik)
# Urutan WAJIB: cchip dulu, baru cvolt (urutan EXTRA_CORDONS: cordon1 = cCHIP, cordon2 = cVOLT di indexer dan keeper).
#
# Prasyarat: deployments/robinhood-mainnet.json (hasil Deploy.s.sol mainnet) ada, dan script/verify-addresses.sh sudah
# SEMUA OK sehingga addressesVerified=true di script/config/robinhood-mainnet.json.
# Pengirim = kunci deployer di keystore/hardware wallet (DEPLOYER_ACCOUNT, bawaan espalier-mainnet), BUKAN owner/Safe dan
# BUKAN keeper. Pengirim hanya menjadi ADMIN vault sesaat; ADMIN langsung diserahkan ke timelock di transaksi yang sama.
set -euo pipefail
cd "$(dirname "$0")"

WHICH="${1:-}"; MODE="${2:-dry}"
case "$WHICH" in
  cchip) SYMBOL=cCHIP; COUNT=4 ;;
  cvolt) SYMBOL=cVOLT; COUNT=4 ;;
  *) echo "pakai: bash deploy-cordon-mainnet.sh cchip|cvolt dry|send"; exit 1 ;;
esac
NAME="$WHICH-mainnet"
[ -f .env ] && { set -a; source .env; set +a; }
: "${RH_RPC_MAINNET:?RH_RPC_MAINNET kosong}"
: "${DEPLOYER_ADDRESS:?isi DEPLOYER_ADDRESS (alamat kunci deployer di keystore/ledger)}"
ACCOUNT="${DEPLOYER_ACCOUNT:-espalier-mainnet}"
for c in jq cast forge; do command -v "$c" >/dev/null || { echo "$c belum terpasang"; exit 1; }; done

MAIN=deployments/robinhood-mainnet.json
MAINCFG=script/config/robinhood-mainnet.json
TEMPLATE=script/config/$NAME.json
RESOLVED=script/config/$NAME.resolved.json
[ -f "$MAIN" ] || { echo "butuh $MAIN (hasil deploy utama mainnet)"; exit 1; }
[ -f "$TEMPLATE" ] || { echo "tidak ada $TEMPLATE"; exit 1; }

ROUTER="$(jq -r .oracleRouter "$MAIN")"
OWNER="$(jq -r .timelock "$MAIN")"          # ADMIN vault = timelock yang sama dengan cMAG7 dan router
KEEPER="$(jq -r .admin.keeper "$MAINCFG")"
VERIFIED="$(jq -r .addressesVerified "$MAINCFG")"
ZERO=0x0000000000000000000000000000000000000000
for v in ROUTER OWNER KEEPER; do
  [[ "${!v}" =~ ^0x[0-9a-fA-F]{40}$ && "${!v}" != "$ZERO" ]] || { echo "$v tidak valid: ${!v}"; exit 1; }
done
[ "$VERIFIED" = "true" ] || { echo "addressesVerified di $MAINCFG masih $VERIFIED: jalankan script/verify-addresses.sh dulu"; exit 1; }

echo "chain id        : $(cast chain-id --rpc-url "$RH_RPC_MAINNET")  (harus 4663)"
[ "$(cast chain-id --rpc-url "$RH_RPC_MAINNET")" = "4663" ] || { echo "chain id bukan 4663, berhenti"; exit 1; }
echo "router          : $ROUTER"
echo "owner (timelock): $OWNER"
echo "keeper          : $KEEPER"
echo "pengirim        : $DEPLOYER_ADDRESS  (keystore: $ACCOUNT)"
echo "saldo pengirim  : $(cast balance "$DEPLOYER_ADDRESS" --rpc-url "$RH_RPC_MAINNET" -e) ETH"
ZEROH=0x0000000000000000000000000000000000000000000000000000000000000000
[ "$(cast call "$ROUTER" 'hasRole(bytes32,address)(bool)' "$ZEROH" "$OWNER" --rpc-url "$RH_RPC_MAINNET")" = "true" ] \
  || { echo "owner BUKAN ADMIN router: pastikan deployments/robinhood-mainnet.json adalah deploy yang benar"; exit 1; }

# Config terselesaikan: router, owner, keeper, addressesVerified, dan fee diambil dari deploy utama (fee sama dengan cMAG7).
jq --arg r "$ROUTER" --arg o "$OWNER" --arg k "$KEEPER" --argjson v "$VERIFIED" --slurpfile m "$MAINCFG" \
  '.router=$r | .owner=$o | .keeper=$k | .addressesVerified=$v | .fees=$m[0].fees' "$TEMPLATE" > "$RESOLVED"
export CORDON_CONFIG="$RESOLVED"
export CONFIRM_MAINNET_DEPLOY=true

case "$MODE" in
  dry)
    forge script script/DeployCordonMainnet.s.sol --rpc-url "$RH_RPC_MAINNET" \
      --account "$ACCOUNT" --sender "$DEPLOYER_ADDRESS" ;;
  send)
    if [ -f "deployments/$NAME.json" ]; then
      echo "deployments/$NAME.json sudah ada: $SYMBOL sepertinya sudah pernah di-deploy. send lagi men-deploy vault kedua."
      echo "Kalau memang mau deploy ulang, pindahkan dulu file itu."; exit 1
    fi
    read -r -p "Ketik 'DEPLOY $SYMBOL' untuk mengirim ke MAINNET: " CONFIRM
    [ "$CONFIRM" = "DEPLOY $SYMBOL" ] || { echo "dibatalkan"; exit 1; }
    forge script script/DeployCordonMainnet.s.sol --rpc-url "$RH_RPC_MAINNET" \
      --account "$ACCOUNT" --sender "$DEPLOYER_ADDRESS" --broadcast
    FILE="deployments/$NAME.json"
    [ -f "$FILE" ] || { echo "tidak ada $FILE"; exit 1; }
    VAULT="$(jq -r .cordonVault "$FILE")"
    # Blok deploy = blok transaksi pembuatan CordonVault (untuk EXTRA_CORDONS di indexer).
    TX="$(jq -r '[.transactions[] | select(.contractName=="CordonVault")][0].hash' "broadcast/DeployCordonMainnet.s.sol/4663/run-latest.json")"
    BLOCK="$(cast receipt "$TX" blockNumber --rpc-url "$RH_RPC_MAINNET")"
    KEEPER_ROLE="$(cast keccak KEEPER_ROLE)"
    echo "---- cek ulang lewat RPC ----"
    echo "symbol          : $(cast call "$VAULT" 'symbol()(string)' --rpc-url "$RH_RPC_MAINNET")  (harus $SYMBOL)"
    echo "componentCount  : $(cast call "$VAULT" 'componentCount()(uint256)' --rpc-url "$RH_RPC_MAINNET")  (harus $COUNT)"
    echo "totalSupply     : $(cast call "$VAULT" 'totalSupply()(uint256)' --rpc-url "$RH_RPC_MAINNET")"
    echo "timelock ADMIN  : $(cast call "$VAULT" 'hasRole(bytes32,address)(bool)' "$ZEROH" "$OWNER" --rpc-url "$RH_RPC_MAINNET")  (harus true)"
    echo "pengirim ADMIN  : $(cast call "$VAULT" 'hasRole(bytes32,address)(bool)' "$ZEROH" "$DEPLOYER_ADDRESS" --rpc-url "$RH_RPC_MAINNET")  (harus false)"
    echo "keeper KEEPER   : $(cast call "$VAULT" 'hasRole(bytes32,address)(bool)' "$KEEPER_ROLE" "$KEEPER" --rpc-url "$RH_RPC_MAINNET")  (harus true)"
    echo
    echo "==== salin ke env Vercel (lalu REDEPLOY) ===="
    if [ "$WHICH" = cchip ]; then
      echo "EXTRA_CORDONS=$VAULT@$BLOCK                         # cCHIP HARUS di posisi pertama (cordon1)"
      echo "NEXT_PUBLIC_CCHIP_VAULT_ADDRESS=$VAULT"
      echo "NEXT_PUBLIC_CCHIP_VAULT_CHAIN_ID=4663"
      echo "NEXT_PUBLIC_CCHIP_VAULT_SYMBOL=cCHIP"
    else
      echo "EXTRA_CORDONS=<cCHIP>@<blok_cCHIP>,$VAULT@$BLOCK     # cVOLT di posisi kedua (cordon2)"
      echo "NEXT_PUBLIC_CVOLT_VAULT_ADDRESS=$VAULT"
      echo "NEXT_PUBLIC_CVOLT_VAULT_CHAIN_ID=4663"
      echo "NEXT_PUBLIC_CVOLT_VAULT_SYMBOL=cVOLT"
    fi
    echo "Lalu verifikasi kontrak di Blockscout dan jalankan: bash script/smoke.sh robinhood-mainnet" ;;
  *) echo "pakai: dry | send"; exit 1 ;;
esac
