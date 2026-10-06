#!/usr/bin/env bash
# Deploy mock ke Robinhood Chain Testnet (46630). Jalankan dari folder contracts/.
# Pakai: bash deploy-b1.sh dry   -> simulasi, tidak mengirim apa pun
#        bash deploy-b1.sh send  -> broadcast sungguhan
set -euo pipefail
cd "$(dirname "$0")"
[ -f .env ] || { echo ".env tidak ada di $(pwd)"; exit 1; }
set -a; source .env; set +a
: "${RH_RPC_TESTNET:?RH_RPC_TESTNET kosong}"
export DEPLOY_CONFIG=script/config/robinhood-testnet-mock-live.json
DEPLOYER=0x8972724baAA9A1e912aDD6163405083B6446fBd6

echo "chain id: $(cast chain-id --rpc-url "$RH_RPC_TESTNET")  (harus 46630)"
echo "saldo deployer: $(cast balance "$DEPLOYER" --rpc-url "$RH_RPC_TESTNET" -e) ETH"

case "${1:-dry}" in
  dry)
    forge script script/Deploy.s.sol --rpc-url "$RH_RPC_TESTNET" \
      --account espalier-testnet --sender "$DEPLOYER" ;;
  send)
    forge script script/Deploy.s.sol --rpc-url "$RH_RPC_TESTNET" \
      --account espalier-testnet --sender "$DEPLOYER" --broadcast
    RPC_URL="$RH_RPC_TESTNET" bash script/smoke.sh robinhood-testnet-mock-live ;;
  *) echo "pakai: dry | send"; exit 1 ;;
esac
