#!/usr/bin/env bash
# Smoke test pasca-deploy: memanggil kontrak lewat RPC SUNGGUHAN (cast call), bukan simulasi lokal forge.
# Ini satu-satunya pemeriksaan yang membuktikan bytecode benar-benar jalan di chain targetnya (mis. dukungan opcode
# `cancun`, lihat README "Pra-deploy"). Hanya membaca; tidak mengirim transaksi.
#
# Pemakaian (dari folder contracts/):
#   RH_RPC_TESTNET=https://... ./script/smoke.sh robinhood-testnet
#   RPC_URL=http://127.0.0.1:8545 ./script/smoke.sh robinhood-testnet-mock
set -euo pipefail

NAME="${1:?pemakaian: ./script/smoke.sh <name>   (membaca deployments/<name>.json)}"
FILE="deployments/${NAME}.json"
RPC="${RPC_URL:-${RH_RPC_TESTNET:-}}"
[[ -f "$FILE" ]] || { echo "tidak ada $FILE (deploy dulu dengan --broadcast)"; exit 1; }
[[ -n "$RPC" ]] || { echo "isi RPC_URL atau RH_RPC_TESTNET"; exit 1; }
command -v cast >/dev/null || { echo "cast (Foundry) tidak ditemukan"; exit 1; }
command -v jq >/dev/null || { echo "jq tidak ditemukan"; exit 1; }

fail=0
ok()  { printf '  ok    %s\n' "$1"; }
bad() { printf '  GAGAL %s\n' "$1"; fail=1; }
get() { jq -r "$1" "$FILE"; }

EXPECT_CHAIN="$(get .chainId)"
GOT_CHAIN="$(cast chain-id --rpc-url "$RPC")"
[[ "$GOT_CHAIN" == "$EXPECT_CHAIN" ]] && ok "chain id $GOT_CHAIN" || bad "chain id $GOT_CHAIN (diharapkan $EXPECT_CHAIN)"
[[ "$GOT_CHAIN" != "4663" ]] || { echo "mainnet ditolak"; exit 1; }

SESSION="$(get .marketSession)"; ROUTER="$(get .oracleRouter)"
SETTLE="$(get .settlementOracle)"; VAULT="$(get .cordonVault)"; ADMIN="$(get .admin)"

for pair in "MarketSession:$SESSION" "OracleRouter:$ROUTER" "SettlementOracle:$SETTLE" "CordonVault:$VAULT"; do
  label="${pair%%:*}"; addr="${pair#*:}"
  code="$(cast code "$addr" --rpc-url "$RPC")"
  [[ "$code" != "0x" ]] && ok "$label punya kode ($addr)" || bad "$label tanpa kode di $addr"
done

# Panggilan view yang menjalankan bytecode di node chain.
NOW="$(cast block latest --field timestamp --rpc-url "$RPC")"
SESSION_ID="$(cast call "$SESSION" 'sessionAt(uint256)(uint8)' "$NOW" --rpc-url "$RPC")"
ok "MarketSession.sessionAt(now) = $SESSION_ID (0..3 = Closed/Overnight/Extended/Regular menurut enum kontrak)"

[[ "$(cast call "$ROUTER" 'marketSession()(address)' --rpc-url "$RPC")" == "$(cast to-check-sum-address "$SESSION")" ]] \
  && ok "router.marketSession cocok" || bad "router.marketSession tidak cocok"
[[ "$(cast call "$SETTLE" 'ROUTER()(address)' --rpc-url "$RPC")" == "$(cast to-check-sum-address "$ROUTER")" ]] \
  && ok "settlement.ROUTER cocok" || bad "settlement.ROUTER tidak cocok"

N="$(cast call "$VAULT" 'componentCount()(uint256)' --rpc-url "$RPC")"
EXPECT_N="$(jq '.tokens | length' "$FILE")"
[[ "$N" == "$EXPECT_N" ]] && ok "vault punya $N komponen" || bad "vault punya $N komponen (diharapkan $EXPECT_N)"

# ADMIN akhir (timelock atau owner) memegang DEFAULT_ADMIN_ROLE di ketiga kontrak berizin.
for pair in "MarketSession:$SESSION" "OracleRouter:$ROUTER" "CordonVault:$VAULT"; do
  label="${pair%%:*}"; addr="${pair#*:}"
  r="$(cast call "$addr" 'hasRole(bytes32,address)(bool)' 0x0000000000000000000000000000000000000000000000000000000000000000 "$ADMIN" --rpc-url "$RPC")"
  [[ "$r" == "true" ]] && ok "$label: ADMIN akhir memegang DEFAULT_ADMIN_ROLE" || bad "$label: ADMIN akhir TIDAK memegang peran"
  d="$(cast call "$addr" 'hasRole(bytes32,address)(bool)' 0x0000000000000000000000000000000000000000000000000000000000000000 "$(get .deployer)" --rpc-url "$RPC")"
  if [[ "$(cast to-check-sum-address "$ADMIN")" != "$(cast to-check-sum-address "$(get .deployer)")" ]]; then
    [[ "$d" == "false" ]] && ok "$label: deployer sudah melepas ADMIN" || bad "$label: deployer MASIH ADMIN"
  fi
done

# Spur Vault (M4): hanya diperiksa bila deployments/<name>.json memuatnya.
SPUR="$(jq -r '.spurVault // empty' "$FILE")"
if [[ -n "$SPUR" ]]; then
  AUCTION="$(get .harvestAuction)"; PREM="$(get .premiumToken)"
  for pair in "SpurVault:$SPUR" "HarvestAuction:$AUCTION" "PremiumToken:$PREM"; do
    label="${pair%%:*}"; addr="${pair#*:}"
    code="$(cast code "$addr" --rpc-url "$RPC")"
    [[ "$code" != "0x" ]] && ok "$label punya kode ($addr)" || bad "$label tanpa kode di $addr"
  done
  same() { [[ "$(cast to-check-sum-address "$1")" == "$(cast to-check-sum-address "$2")" ]]; }
  same "$(cast call "$SPUR" 'AUCTION()(address)' --rpc-url "$RPC")" "$AUCTION" && ok "spur.AUCTION cocok" || bad "spur.AUCTION tidak cocok"
  same "$(cast call "$SPUR" 'PREMIUM()(address)' --rpc-url "$RPC")" "$PREM" && ok "spur.PREMIUM cocok" || bad "spur.PREMIUM tidak cocok"
  same "$(cast call "$SPUR" 'ROUTER()(address)' --rpc-url "$RPC")" "$ROUTER" && ok "spur.ROUTER cocok" || bad "spur.ROUTER tidak cocok"
  same "$(cast call "$SPUR" 'SETTLEMENT()(address)' --rpc-url "$RPC")" "$SETTLE" && ok "spur.SETTLEMENT cocok" || bad "spur.SETTLEMENT tidak cocok"
  SPUR_ASSET="$(cast call "$SPUR" 'ASSET()(address)' --rpc-url "$RPC")"
  found=0
  for token in $(jq -r '.tokens[]' "$FILE"); do same "$token" "$SPUR_ASSET" && found=1; done
  [[ "$found" -eq 1 ]] && ok "spur.ASSET termasuk aset yang terdaftar di router" || bad "spur.ASSET ($SPUR_ASSET) tidak ada di daftar token"
  for pair in "SpurVault:$SPUR" "HarvestAuction:$AUCTION"; do
    label="${pair%%:*}"; addr="${pair#*:}"
    r="$(cast call "$addr" 'hasRole(bytes32,address)(bool)' 0x0000000000000000000000000000000000000000000000000000000000000000 "$ADMIN" --rpc-url "$RPC")"
    [[ "$r" == "true" ]] && ok "$label: ADMIN akhir memegang DEFAULT_ADMIN_ROLE" || bad "$label: ADMIN akhir TIDAK memegang peran"
    if [[ "$(cast to-check-sum-address "$ADMIN")" != "$(cast to-check-sum-address "$(get .deployer)")" ]]; then
      d="$(cast call "$addr" 'hasRole(bytes32,address)(bool)' 0x0000000000000000000000000000000000000000000000000000000000000000 "$(get .deployer)" --rpc-url "$RPC")"
      [[ "$d" == "false" ]] && ok "$label: deployer sudah melepas ADMIN" || bad "$label: deployer MASIH ADMIN"
    fi
  done
  printf '  info  spur: round=%s active=%s otmBps=%s fillWindow=%s\n' \
    "$(cast call "$SPUR" 'round()(uint64)' --rpc-url "$RPC")" "$(cast call "$SPUR" 'active()(bool)' --rpc-url "$RPC")" \
    "$(cast call "$SPUR" 'otmBps()(uint16)' --rpc-url "$RPC")" "$(cast call "$SPUR" 'FILL_WINDOW()(uint32)' --rpc-url "$RPC")"
fi

# Harga per aset lewat router (status 0 = Ok). Bukan kegagalan bila bukan 0: feed bisa basi atau pasar tutup.
i=0
for token in $(jq -r '.tokens[]' "$FILE"); do
  st="$(cast call "$ROUTER" 'tryGetReferencePrice(address)(uint8,uint256,uint256,uint8)' "$token" --rpc-url "$RPC" | head -1)"
  printf '  info  aset %d (%s): status harga acuan = %s (0 = Ok)\n' "$i" "$token" "$st"
  i=$((i + 1))
done

SUPPLY="$(cast call "$VAULT" 'totalSupply()(uint256)' --rpc-url "$RPC")"
printf '  info  totalSupply cMAG7 = %s\n' "$SUPPLY"

if [[ "$fail" -eq 0 ]]; then echo "SMOKE LULUS"; else echo "SMOKE GAGAL"; exit 1; fi
