#!/usr/bin/env bash
# Deploy Cordon cVOLT (kendaraan listrik: TSLA, RIVN, LCID, NIO) ke Robinhood Chain Testnet (46630),
# menambah vault baru ke deployment B1 yang sudah ada. Jalankan dari folder contracts/.
# Pakai: bash deploy-cvolt.sh dry   -> simulasi, tidak mengirim apa pun
#        bash deploy-cvolt.sh send  -> broadcast sungguhan, lalu cek ulang dan cetak baris env
# Pengirim = espalier-owner (ADMIN OracleRouter). Bukan keystore espalier-testnet: deployer itu sudah melepas ADMIN.
set -euo pipefail
cd "$(dirname "$0")"
[ -f .env ] || { echo ".env tidak ada di $(pwd)"; exit 1; }
set -a; source .env; set +a
: "${RH_RPC_TESTNET:?RH_RPC_TESTNET kosong}"
command -v jq >/dev/null || { echo "jq belum terpasang: sudo apt install -y jq"; exit 1; }
OWNER=0xE0bf53F10B12bcd19A979C698809750f34512f47
NAME=cvolt-testnet-mock
B1=deployments/robinhood-testnet-mock-live.json
TEMPLATE=script/config/$NAME.json
RESOLVED=script/config/$NAME.resolved.json
NVDA_KNOWN=0xd7F0Eccb089280156c454fe3AD9aF924c40f6BD2
[ -f "$B1" ] || { echo "butuh $B1 (hasil deploy B1)"; exit 1; }

# TSLA mock sudah ada di deploy B1 (urutan aset B1: AAPL, MSFT, GOOGL, AMZN, NVDA, META, TSLA). Pastikan urutannya benar
# dulu lewat NVDA (indeks 4, alamatnya sudah dipakai cCHIP), baru ambil TSLA (indeks 6).
# Kalau struktur file B1 kamu beda, isi sendiri: TSLA_TOKEN=0x... bash deploy-cvolt.sh dry
if [ -n "${TSLA_TOKEN:-}" ]; then
  TSLA="$TSLA_TOKEN"
else
  NVDA_B1="$(jq -r '.tokens[4]' "$B1")"
  if [ "${NVDA_B1,,}" != "${NVDA_KNOWN,,}" ]; then
    echo "tokens[4] di $B1 = $NVDA_B1, bukan NVDA ($NVDA_KNOWN). Urutan/struktur file berbeda dari dugaan, berhenti."
    echo "Isi alamat token TSLA mock sendiri: TSLA_TOKEN=0x... bash deploy-cvolt.sh dry"; exit 1
  fi
  TSLA="$(jq -r '.tokens[6]' "$B1")"
fi
[[ "$TSLA" =~ ^0x[0-9a-fA-F]{40}$ ]] || { echo "alamat TSLA tidak valid: $TSLA"; exit 1; }
echo "TSLA (dipakai ulang dari B1): $TSLA"
jq --arg t "$TSLA" '(.assets[] | select(.symbol=="TSLA") | .token) = $t' "$TEMPLATE" > "$RESOLVED"
export CORDON_CONFIG="$RESOLVED"

echo "chain id: $(cast chain-id --rpc-url "$RH_RPC_TESTNET")  (harus 46630)"
echo "saldo owner: $(cast balance "$OWNER" --rpc-url "$RH_RPC_TESTNET" -e) ETH"

case "${1:-dry}" in
  dry)
    forge script script/DeployCordon.s.sol --rpc-url "$RH_RPC_TESTNET" \
      --account espalier-owner --sender "$OWNER" ;;
  send)
    if [ -f "deployments/$NAME.json" ]; then
      echo "deployments/$NAME.json sudah ada: cVOLT sepertinya sudah pernah di-deploy. Menjalankan send lagi men-deploy cVOLT kedua."
      echo "Kalau memang mau deploy ulang, pindahkan dulu file itu, lalu jalankan lagi."; exit 1
    fi
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
    echo "indexer/.env       : tambahkan ke EXTRA_CORDONS, dipisah koma:"
    echo "                     EXTRA_CORDONS=<yang_sudah_ada>,$VAULT@$BLOCK"
    echo ".env.local (web)   : NEXT_PUBLIC_CVOLT_VAULT_ADDRESS=$VAULT"
    echo "                     NEXT_PUBLIC_CVOLT_VAULT_CHAIN_ID=46630"
    echo "                     NEXT_PUBLIC_CVOLT_VAULT_SYMBOL=cVOLT"
    echo "Lalu segarkan feed:  bash refresh-cvolt-feeds.sh" ;;
  *) echo "pakai: dry | send"; exit 1 ;;
esac
