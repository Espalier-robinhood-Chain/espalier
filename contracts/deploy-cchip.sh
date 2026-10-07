#!/usr/bin/env bash
# Deploy Cordon cCHIP ke Robinhood Chain Testnet (46630), menambah vault baru ke deployment B1 yang sudah ada.
# Jalankan dari folder contracts/.
# Pakai: bash deploy-cchip.sh dry   -> simulasi, tidak mengirim apa pun
#        bash deploy-cchip.sh send  -> broadcast sungguhan, lalu cek ulang dan cetak baris env
# Pengirim = espalier-owner (ADMIN OracleRouter). Bukan keystore espalier-testnet: deployer itu sudah melepas ADMIN.
set -euo pipefail
cd "$(dirname "$0")"
[ -f .env ] || { echo ".env tidak ada di $(pwd)"; exit 1; }
set -a; source .env; set +a
: "${RH_RPC_TESTNET:?RH_RPC_TESTNET kosong}"
command -v jq >/dev/null || { echo "jq belum terpasang: sudo apt install -y jq"; exit 1; }
export CORDON_CONFIG=script/config/cchip-testnet-mock.json
OWNER=0xE0bf53F10B12bcd19A979C698809750f34512f47
NAME=cchip-testnet-mock

echo "chain id: $(cast chain-id --rpc-url "$RH_RPC_TESTNET")  (harus 46630)"
echo "saldo owner: $(cast balance "$OWNER" --rpc-url "$RH_RPC_TESTNET" -e) ETH"

case "${1:-dry}" in
  dry)
    forge script script/DeployCordon.s.sol --rpc-url "$RH_RPC_TESTNET" \
      --account espalier-owner --sender "$OWNER" ;;
  send)
    forge script script/DeployCordon.s.sol --rpc-url "$RH_RPC_TESTNET" \
      --account espalier-owner --sender "$OWNER" --broadcast
    FILE="deployments/$NAME.json"
    [ -f "$FILE" ] || { echo "tidak ada $FILE"; exit 1; }
    VAULT="$(jq -r .cordonVault "$FILE")"
    # Blok deploy = blok transaksi pembuatan CordonVault (untuk EXTRA_CORDONS di indexer).
    TX="$(jq -r '[.transactions[] | select(.contractName=="CordonVault")][0].hash' "broadcast/DeployCordon.s.sol/46630/run-latest.json")"
    BLOCK="$(cast receipt "$TX" blockNumber --rpc-url "$RH_RPC_TESTNET")"
    echo "---- cek ulang lewat RPC ----"
    echo "symbol          : $(cast call "$VAULT" 'symbol()(string)' --rpc-url "$RH_RPC_TESTNET")"
    echo "componentCount  : $(cast call "$VAULT" 'componentCount()(uint256)' --rpc-url "$RH_RPC_TESTNET")  (harus 4)"
    echo "totalSupply     : $(cast call "$VAULT" 'totalSupply()(uint256)' --rpc-url "$RH_RPC_TESTNET")"
    echo "owner ADMIN     : $(cast call "$VAULT" 'hasRole(bytes32,address)(bool)' 0x0000000000000000000000000000000000000000000000000000000000000000 "$OWNER" --rpc-url "$RH_RPC_TESTNET")  (harus true)"
    echo
    echo "==== salin ke env ===="
    echo "indexer/.env       : EXTRA_CORDONS=$VAULT@$BLOCK"
    echo ".env.local (web)   : NEXT_PUBLIC_CCHIP_VAULT_ADDRESS=$VAULT"
    echo "                     NEXT_PUBLIC_CCHIP_VAULT_CHAIN_ID=46630"
    echo "                     NEXT_PUBLIC_CCHIP_VAULT_SYMBOL=cCHIP"
    echo "Lalu segarkan feed:  bash refresh-cchip-feeds.sh" ;;
  *) echo "pakai: dry | send"; exit 1 ;;
esac
