#!/usr/bin/env bash
# Venue pruning mainnet (4663): cek pool, deploy, dan usulan timelock. Jalankan dari folder contracts/ dengan `bash`.
#   bash prune-venue-mainnet.sh pools                 -> HANYA BACA: pool Uniswap v3 tiap token <-> USDG, kedalaman, usulan fee
#   bash prune-venue-mainnet.sh deploy dry|send       -> deploy UniswapV3PruneVenue (pemilik = Safe)
#   bash prune-venue-mainnet.sh propose <VENUE> [slippage_bps]   -> cetak calldata scheduleBatch/executeBatch untuk Safe
#   bash prune-venue-mainnet.sh status <VENUE> [slippage_bps]    -> status operasi di timelock + isi vault setelah eksekusi
# Env wajib: RH_RPC_MAINNET. Untuk pools: UNISWAP_V3_FACTORY. Untuk deploy: UNISWAP_ROUTER, VENUE_TOKENS, VENUE_FEES, DEPLOYER_ADDRESS.
# BELUM DIJALANKAN terhadap chain mana pun; bagian jq/cast belum diuji.
set -euo pipefail
cd "$(dirname "$0")"
[ -f .env ] && { set -a; source .env; set +a; }
: "${RH_RPC_MAINNET:?RH_RPC_MAINNET kosong}"
for c in jq cast; do command -v "$c" >/dev/null || { echo "$c belum terpasang"; exit 1; }; done
[ "$(cast chain-id --rpc-url "$RH_RPC_MAINNET")" = "4663" ] || { echo "chain id bukan 4663"; exit 1; }
CFG=script/config/robinhood-mainnet.json
USDG="$(jq -r .spur.premiumToken "$CFG")"
ZERO=0x0000000000000000000000000000000000000000
ZEROH=0x0000000000000000000000000000000000000000000000000000000000000000
CMD="${1:-}"

tokens_json() { jq -c '[(.assets + (.routerAssets // []))[] | {symbol, token}] | unique_by(.token)' "$CFG"; }

vault_list() { # tiga vault: cMAG7, cCHIP, cVOLT
  local a b c
  a="$(jq -r .cordonVault deployments/robinhood-mainnet.json)"
  b="$(jq -r .cordonVault deployments/cchip-mainnet.json)"
  c="$(jq -r .cordonVault deployments/cvolt-mainnet.json)"
  for v in "$a" "$b" "$c"; do [[ "$v" =~ ^0x[0-9a-fA-F]{40}$ && "$v" != "$ZERO" ]] || { echo "alamat vault tidak valid: $v" >&2; exit 1; }; done
  echo "$a $b $c"
}

build_batch() { # $1 venue, $2 slippage -> mengisi TARGETS VALUES PAYLOADS
  local venue="$1" slip="$2" t="" p=""
  for v in $(vault_list); do
    t="$t,$v,$v"
    p="$p,$(cast calldata 'setPruneVenue(address)' "$venue"),$(cast calldata 'setPruneSlippageBps(uint16)' "$slip")"
  done
  TARGETS="[${t#,}]"; PAYLOADS="[${p#,}]"; VALUES="[0,0,0,0,0,0]"
}

case "$CMD" in
  pools)
    : "${UNISWAP_V3_FACTORY:?isi UNISWAP_V3_FACTORY (alamat UniswapV3Factory di 4663, dari docs Uniswap)}"
    echo "USDG: $USDG"; echo "Pool v3 per token (kedalaman = USDG di dalam pool):"
    best_t=""; best_f=""
    while read -r row; do
      sym="$(jq -r .symbol <<<"$row")"; tok="$(jq -r .token <<<"$row")"
      bf=0; bb=0
      for fee in 100 500 3000 10000; do
        pool="$(cast call "$UNISWAP_V3_FACTORY" 'getPool(address,address,uint24)(address)' "$tok" "$USDG" "$fee" --rpc-url "$RH_RPC_MAINNET")"
        [ "$pool" = "$ZERO" ] && continue
        bal="$(cast call "$USDG" 'balanceOf(address)(uint256)' "$pool" --rpc-url "$RH_RPC_MAINNET" | awk '{print $1}')"
        liq="$(cast call "$pool" 'liquidity()(uint128)' --rpc-url "$RH_RPC_MAINNET" | awk '{print $1}')"
        printf '  %-6s fee %-5s pool %s  USDG=%s  liquidity=%s\n' "$sym" "$fee" "$pool" "$(cast from-wei "$bal" 6 2>/dev/null || echo "$bal raw")" "$liq"
        if [ "$bal" -gt "$bb" ] 2>/dev/null; then bb="$bal"; bf="$fee"; fi
      done
      if [ "$bf" = 0 ]; then echo "  $sym: TIDAK ADA pool v3 dengan USDG -> rute ini tidak bisa dipakai"; else echo "  => $sym usulan fee $bf"; fi
      best_t="$best_t,$tok"; best_f="$best_f,$bf"
    done < <(tokens_json | jq -c '.[]')
    echo; echo "Usulan (periksa dulu; fee 0 = tidak ada pool):"
    echo "export VENUE_TOKENS=${best_t#,}"; echo "export VENUE_FEES=${best_f#,}"
    echo "Catatan: kedalaman USDG kecil berarti slippage besar; pool v4 tidak dibaca skrip ini." ;;

  deploy)
    MODE="${2:-dry}"
    : "${UNISWAP_ROUTER:?isi UNISWAP_ROUTER (SwapRouter02 di 4663; verifikasi di docs Uniswap)}"
    : "${VENUE_TOKENS:?jalankan pools dulu}"; : "${VENUE_FEES:?jalankan pools dulu}"
    : "${DEPLOYER_ADDRESS:?alamat deployer}"
    export USDG VENUE_OWNER="$(jq -r .admin.owner "$CFG")" CONFIRM_MAINNET_DEPLOY=true
    case ",$VENUE_FEES," in *,0,*) echo "VENUE_FEES berisi 0 (token tanpa pool): buang token itu atau pilih pool lain"; exit 1;; esac
    echo "router : $UNISWAP_ROUTER (kode: $(cast code "$UNISWAP_ROUTER" --rpc-url "$RH_RPC_MAINNET" | wc -c) karakter)"
    echo "owner  : $VENUE_OWNER (Safe)"; echo "USDG   : $USDG"
    ACCOUNT="${DEPLOYER_ACCOUNT:-espalier-mainnet}"
    case "$MODE" in
      dry) forge script script/DeployPruneVenueMainnet.s.sol --rpc-url "$RH_RPC_MAINNET" --account "$ACCOUNT" --sender "$DEPLOYER_ADDRESS" ;;
      send) read -r -p "Ketik 'DEPLOY VENUE' untuk mengirim ke MAINNET: " C; [ "$C" = "DEPLOY VENUE" ] || { echo dibatalkan; exit 1; }
            forge script script/DeployPruneVenueMainnet.s.sol --rpc-url "$RH_RPC_MAINNET" --account "$ACCOUNT" --sender "$DEPLOYER_ADDRESS" --broadcast ;;
      *) echo "pakai: dry | send"; exit 1;;
    esac ;;

  propose)
    VENUE="${2:?alamat venue}"; SLIP="${3:-200}"
    [ "$SLIP" -ge 1 ] && [ "$SLIP" -le 300 ] || { echo "slippage harus 1..300 bps (batas kontrak 300)"; exit 1; }
    [ "$(cast code "$VENUE" --rpc-url "$RH_RPC_MAINNET")" != "0x" ] || { echo "venue bukan kontrak"; exit 1; }
    TL="$(jq -r .timelock deployments/robinhood-mainnet.json)"
    DELAY="$(cast call "$TL" 'getMinDelay()(uint256)' --rpc-url "$RH_RPC_MAINNET" | awk '{print $1}')"
    SALT="$(cast keccak "espalier-prune-venue-$VENUE-$SLIP")"
    build_batch "$VENUE" "$SLIP"
    echo "timelock: $TL   jeda: $DELAY dtk   salt: $SALT"
    echo "Kirim dari Safe (proposer) ke alamat timelock, nilai 0, data:"
    echo "--- scheduleBatch ---"
    cast calldata 'scheduleBatch(address[],uint256[],bytes[],bytes32,bytes32,uint256)' "$TARGETS" "$VALUES" "$PAYLOADS" "$ZEROH" "$SALT" "$DELAY"
    echo "--- executeBatch (setelah jeda lewat) ---"
    cast calldata 'executeBatch(address[],uint256[],bytes[],bytes32,bytes32)' "$TARGETS" "$VALUES" "$PAYLOADS" "$ZEROH" "$SALT" ;;

  status)
    VENUE="${2:?alamat venue}"; SLIP="${3:-200}"
    TL="$(jq -r .timelock deployments/robinhood-mainnet.json)"
    SALT="$(cast keccak "espalier-prune-venue-$VENUE-$SLIP")"
    build_batch "$VENUE" "$SLIP"
    ID="$(cast call "$TL" 'hashOperationBatch(address[],uint256[],bytes[],bytes32,bytes32)(bytes32)' "$TARGETS" "$VALUES" "$PAYLOADS" "$ZEROH" "$SALT" --rpc-url "$RH_RPC_MAINNET")"
    echo "operasi $ID"
    for f in isOperationPending isOperationReady isOperationDone; do echo "  $f: $(cast call "$TL" "$f(bytes32)(bool)" "$ID" --rpc-url "$RH_RPC_MAINNET")"; done
    for v in $(vault_list); do
      echo "vault $v ($(cast call "$v" 'symbol()(string)' --rpc-url "$RH_RPC_MAINNET" | tr -d '"')): pruneVenue=$(cast call "$v" 'pruneVenue()(address)' --rpc-url "$RH_RPC_MAINNET") slippageBps=$(cast call "$v" 'pruneSlippageBps()(uint16)' --rpc-url "$RH_RPC_MAINNET" | awk '{print $1}')"
    done ;;
  *) sed -n 2,8p "$0"; exit 1 ;;
esac
