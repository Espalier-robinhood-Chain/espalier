#!/usr/bin/env bash
# Deploy ULANG Cordon cMAG7 (AAPL, MSFT, GOOGL, AMZN, NVDA, META, TSLA) ke Robinhood Chain Testnet (46630) sebagai vault
# BARU yang punya redeemToUsdg. Memakai OracleRouter dan ketujuh token + feed mock yang sudah ada dari deploy B1: tidak ada
# token atau feed baru. Jalankan dari folder contracts/.
# Pakai: bash deploy-cmag7.sh dry   -> simulasi, tidak mengirim apa pun
#        bash deploy-cmag7.sh send  -> broadcast sungguhan, lalu cek ulang dan cetak baris env
# Pengirim = espalier-owner (ADMIN OracleRouter). Bukan keystore espalier-testnet: deployer itu sudah melepas ADMIN.
# Vault lama TIDAK dihapus dan tidak dimigrasi: vault baru kosong lalu di-seed dari konfigurasi.
set -euo pipefail
cd "$(dirname "$0")"
[ -f .env ] || { echo ".env tidak ada di $(pwd)"; exit 1; }
set -a; source .env; set +a
: "${RH_RPC_TESTNET:?RH_RPC_TESTNET kosong}"
command -v jq >/dev/null || { echo "jq belum terpasang: sudo apt install -y jq"; exit 1; }
OWNER=0xE0bf53F10B12bcd19A979C698809750f34512f47
NAME=cmag7-testnet-mock
B1=deployments/robinhood-testnet-mock-live.json
TEMPLATE=script/config/$NAME.json
RESOLVED=script/config/$NAME.resolved.json
NVDA_KNOWN=0xd7F0Eccb089280156c454fe3AD9aF924c40f6BD2
[ -f "$B1" ] || { echo "butuh $B1 (hasil deploy B1)"; exit 1; }

# Urutan aset B1 = urutan aset di konfigurasi: AAPL, MSFT, GOOGL, AMZN, NVDA, META, TSLA (indeks 0..6).
# Pastikan strukturnya benar lewat NVDA (indeks 4, alamatnya sudah dipakai cCHIP) sebelum mengisi ketujuh token.
[ "$(jq -r '.tokens | length' "$B1")" -ge 7 ] || { echo "$B1 punya kurang dari 7 token di .tokens, struktur berbeda dari dugaan, berhenti."; exit 1; }
NVDA_B1="$(jq -r '.tokens[4]' "$B1")"
if [ "${NVDA_B1,,}" != "${NVDA_KNOWN,,}" ]; then
  echo "tokens[4] di $B1 = $NVDA_B1, bukan NVDA ($NVDA_KNOWN). Urutan/struktur file berbeda dari dugaan, berhenti."; exit 1
fi
jq --slurpfile b "$B1" '.assets |= [to_entries[] | .value.token = $b[0].tokens[.key] | .value]' "$TEMPLATE" > "$RESOLVED"
for i in 0 1 2 3 4 5 6; do
  T="$(jq -r ".assets[$i].token" "$RESOLVED")"
  [[ "$T" =~ ^0x[0-9a-fA-F]{40}$ ]] || { echo "token aset #$i tidak valid: $T"; exit 1; }
  echo "$(jq -r ".assets[$i].symbol" "$RESOLVED") (dipakai ulang dari B1): $T"
done
export CORDON_CONFIG="$RESOLVED"

echo "chain id: $(cast chain-id --rpc-url "$RH_RPC_TESTNET")  (harus 46630)"
echo "saldo owner: $(cast balance "$OWNER" --rpc-url "$RH_RPC_TESTNET" -e) ETH"

case "${1:-dry}" in
  dry)
    forge script script/DeployCordon.s.sol --rpc-url "$RH_RPC_TESTNET" \
      --account espalier-owner --sender "$OWNER" ;;
  send)
    if [ -f "deployments/$NAME.json" ]; then
      echo "deployments/$NAME.json sudah ada: cMAG7 baru sepertinya sudah pernah di-deploy. Menjalankan send lagi men-deploy vault kedua."
      echo "Kalau memang mau deploy ulang, pindahkan dulu file itu, lalu jalankan lagi."; exit 1
    fi
    forge script script/DeployCordon.s.sol --rpc-url "$RH_RPC_TESTNET" \
      --account espalier-owner --sender "$OWNER" --broadcast
    FILE="deployments/$NAME.json"
    [ -f "$FILE" ] || { echo "tidak ada $FILE"; exit 1; }
    VAULT="$(jq -r .cordonVault "$FILE")"
    # Blok deploy = blok transaksi pembuatan CordonVault (untuk START_BLOCK di indexer).
    TX="$(jq -r '[.transactions[] | select(.contractName=="CordonVault")][0].hash' "broadcast/DeployCordon.s.sol/46630/run-latest.json")"
    BLOCK="$(cast receipt "$TX" blockNumber --rpc-url "$RH_RPC_TESTNET")"
    echo "---- cek ulang lewat RPC ----"
    echo "symbol          : $(cast call "$VAULT" 'symbol()(string)' --rpc-url "$RH_RPC_TESTNET")"
    echo "componentCount  : $(cast call "$VAULT" 'componentCount()(uint256)' --rpc-url "$RH_RPC_TESTNET")  (harus 7)"
    echo "totalSupply     : $(cast call "$VAULT" 'totalSupply()(uint256)' --rpc-url "$RH_RPC_TESTNET")"
    echo "owner ADMIN     : $(cast call "$VAULT" 'hasRole(bytes32,address)(bool)' 0x0000000000000000000000000000000000000000000000000000000000000000 "$OWNER" --rpc-url "$RH_RPC_TESTNET")  (harus true)"
    echo "executionVenue  : $(cast call "$VAULT" 'executionVenue()(address)' --rpc-url "$RH_RPC_TESTNET")  (harus terbaca; 0x000... = belum dipasang)"
    echo
    echo "==== salin ke env (cMAG7 adalah Cordon UTAMA, bukan EXTRA_CORDONS) ===="
    echo "indexer/.env       : CORDON_VAULT_ADDRESS=$VAULT"
    echo "                     START_BLOCK=$BLOCK"
    echo "keeper/.env        : CORDON_VAULT_ADDRESS=$VAULT"
    echo ".env.local (web)   : NEXT_PUBLIC_CORDON_VAULT_ADDRESS=$VAULT"
    echo "                     NEXT_PUBLIC_CORDON_VAULT_CHAIN_ID=46630"
    echo "                     NEXT_PUBLIC_CORDON_VAULT_SYMBOL=cMAG7"
    echo "PENTING: simbol di Supabase harus unik. Sebelum indexer dijalankan dengan alamat baru, hapus baris vault lama:"
    echo "  delete from cordons where lower(address) = lower('<alamat cMAG7 lama>');"
    echo "Feed mock cMAG7 sudah dipakai bersama (B1), jadi tidak ada skrip refresh baru." ;;
  *) echo "pakai: dry | send"; exit 1 ;;
esac
