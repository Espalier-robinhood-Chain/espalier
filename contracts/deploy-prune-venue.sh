#!/usr/bin/env bash
# Mengaktifkan pruning (CordonVault.prune) di testnet 46630 TANPA men-deploy ulang vault:
#   1) deploy satu MockPruneVenue (menukar pada harga LIVE oracle minus spread, mencetak tokenOut: tidak perlu didanai),
#   2) per vault: setPruneVenue + setPruneSlippageBps (butuh ADMIN vault = espalier-owner),
#   3) per vault: grantRole(KEEPER_ROLE, KEEPER) bila akun keeper belum punya role.
# Venue dipakai ulang bila deployments/prune-venue-testnet-mock.json ada. Aman dijalankan berulang (idempoten).
# Vault yang diproses: cMAG7, cCHIP, cVOLT dari deployments/*.json (seperti deploy-venue.sh),
# atau daftar sendiri lewat VAULTS="0xabc... 0xdef..." (spasi sebagai pemisah) kalau file deployments tidak ada.
# Jalankan dari folder contracts/.
# Pakai: bash deploy-prune-venue.sh dry   -> hanya memeriksa dan mencetak rencana, tidak mengirim apa pun
#        bash deploy-prune-venue.sh send  -> deploy venue, pasang, atur slippage, beri role
# Opsi env: SLIPPAGE_BPS=100 (1-300, batas pruneSlippageBps), SPREAD_BPS=0 (spread venue, harus <= SLIPPAGE_BPS),
#           KEEPER=0x55d4... (akun keeper), VAULTS="...", PASSWORD_FILE=<file>.
# HANYA TESTNET: MockPruneVenue mencetak token dan setter-nya tanpa otorisasi. Untuk mainnet pakai adapter DEX sungguhan.
set -euo pipefail
cd "$(dirname "$0")"
[ -f .env ] || { echo ".env tidak ada di $(pwd)"; exit 1; }
set -a; source .env; set +a
: "${RH_RPC_TESTNET:?RH_RPC_TESTNET kosong}"
for c in jq cast forge; do command -v $c >/dev/null || { echo "$c belum terpasang"; exit 1; }; done

OWNER="${OWNER:-0xE0bf53F10B12bcd19A979C698809750f34512f47}"
ACCOUNT="${REFRESH_ACCOUNT:-espalier-owner}"
KEEPER="${KEEPER:-0x55d40D0a601AD5303dCe300877Af7aE36FD15149}"
SLIPPAGE_BPS="${SLIPPAGE_BPS:-100}"
SPREAD_BPS="${SPREAD_BPS:-0}"
B1=deployments/robinhood-testnet-mock-live.json
OUT=deployments/prune-venue-testnet-mock.json
RPC="$RH_RPC_TESTNET"
ZERO=0x0000000000000000000000000000000000000000
ADMIN_ROLE=0x0000000000000000000000000000000000000000000000000000000000000000
KEEPER_ROLE="$(cast keccak KEEPER_ROLE)"
pw=(); [ -n "${PASSWORD_FILE:-}" ] && pw=(--password-file "$PASSWORD_FILE")

[[ "$SLIPPAGE_BPS" =~ ^[0-9]+$ ]] && [ "$SLIPPAGE_BPS" -ge 1 ] && [ "$SLIPPAGE_BPS" -le 300 ] || { echo "SLIPPAGE_BPS harus 1-300"; exit 1; }
[[ "$SPREAD_BPS" =~ ^[0-9]+$ ]] && [ "$SPREAD_BPS" -le "$SLIPPAGE_BPS" ] || { echo "SPREAD_BPS harus angka <= SLIPPAGE_BPS ($SLIPPAGE_BPS), kalau tidak vault menolak setiap swap"; exit 1; }
[[ "$KEEPER" =~ ^0x[0-9a-fA-F]{40}$ ]] || { echo "KEEPER bukan alamat valid: $KEEPER"; exit 1; }
CHAIN="$(cast chain-id --rpc-url "$RPC")"
[ "$CHAIN" = "46630" ] || { echo "chain id $CHAIN, harus 46630"; exit 1; }
echo "slippage : $SLIPPAGE_BPS bps | spread venue: $SPREAD_BPS bps | keeper: $KEEPER"
echo "saldo owner: $(cast balance "$OWNER" --rpc-url "$RPC" -e) ETH"

# Kumpulkan vault.
NAMES=(); VAULTS_L=()
addv() { local n="$1" v="$2"
  [[ "$v" =~ ^0x[0-9a-fA-F]{40}$ ]] || { echo "(lewati $n: alamat tidak valid: $v)"; return; }
  [ "$(cast code "$v" --rpc-url "$RPC")" != "0x" ] || { echo "(lewati $n: $v tanpa kode di chain)"; return; }
  NAMES+=("$n"); VAULTS_L+=("$v"); }
if [ -n "${VAULTS:-}" ]; then
  for v in $VAULTS; do addv "$v" "$v"; done
else
  addf() { [ -f "$2" ] && addv "$1" "$(jq -r '.cordonVault' "$2")" || echo "(lewati $1: $2 tidak ada)"; }
  if [ -f deployments/cmag7-testnet-mock.json ]; then addf cMAG7 deployments/cmag7-testnet-mock.json; else addf cMAG7 "$B1"; fi
  addf cCHIP deployments/cchip-testnet-mock.json; addf cVOLT deployments/cvolt-testnet-mock.json
fi
[ "${#VAULTS_L[@]}" -gt 0 ] || { echo "tidak ada vault (isi VAULTS=\"0x.. 0x..\")"; exit 1; }

# Periksa tiap vault.
ROUTER=""; TODO=()
for i in "${!VAULTS_L[@]}"; do
  n="${NAMES[$i]}"; v="${VAULTS_L[$i]}"
  cur="$(cast call "$v" 'pruneVenue()(address)' --rpc-url "$RPC" 2>/dev/null || echo ERR)"
  if [ "$cur" = "ERR" ]; then echo "$n $v: TIDAK punya pruneVenue(), kontrak lama, dilewati (perlu deploy ulang)"; continue; fi
  isadmin="$(cast call "$v" 'hasRole(bytes32,address)(bool)' "$ADMIN_ROLE" "$OWNER" --rpc-url "$RPC")"
  if [ "$isadmin" != "true" ]; then echo "$n $v: $OWNER bukan ADMIN vault ini, dilewati (admin = timelock? lewat timelock manual)"; continue; fi
  r="$(cast call "$v" 'ROUTER()(address)' --rpc-url "$RPC")"
  if [ -z "$ROUTER" ]; then ROUTER="$r"; elif [ "${r,,}" != "${ROUTER,,}" ]; then echo "$n $v: router $r beda dari $ROUTER, dilewati (venue mock terikat satu router)"; continue; fi
  slip="$(cast call "$v" 'pruneSlippageBps()(uint256)' --rpc-url "$RPC" | awk '{print $1}')"
  haskeeper="$(cast call "$v" 'hasRole(bytes32,address)(bool)' "$KEEPER_ROLE" "$KEEPER" --rpc-url "$RPC")"
  echo "$n $v: venue=$cur slippage=$slip keeperRole=$haskeeper -> perlu dikerjakan"
  TODO+=("$v")
done
[ "${#TODO[@]}" -gt 0 ] || { echo "tidak ada vault yang bisa diproses"; exit 0; }

case "${1:-dry}" in
  dry) if [ -f "$OUT" ]; then echo "dry: tidak ada transaksi dikirim. 'send' memakai ulang venue di $OUT untuk ${#TODO[@]} vault."
       else echo "dry: tidak ada transaksi dikirim. 'send' men-deploy venue baru (router $ROUTER) untuk ${#TODO[@]} vault."; fi ;;
  send)
    if [ -f "$OUT" ]; then
      VENUE="$(jq -r '.venue' "$OUT")"
      [ "$(cast code "$VENUE" --rpc-url "$RPC")" != "0x" ] || { echo "venue $VENUE tanpa kode. Hapus $OUT bila mau deploy baru."; exit 1; }
      vr="$(cast call "$VENUE" 'ROUTER()(address)' --rpc-url "$RPC")"
      [ "${vr,,}" = "${ROUTER,,}" ] || { echo "venue $VENUE memakai router $vr, vault memakai $ROUTER. Hapus $OUT untuk deploy baru."; exit 1; }
      echo "memakai ulang venue: $VENUE"
    else
      JSON="$(forge create test/mocks/MockPruneVenue.sol:MockPruneVenue --rpc-url "$RPC" --account "$ACCOUNT" "${pw[@]}" \
        --broadcast --json --constructor-args "$ROUTER" "$SPREAD_BPS")"
      VENUE="$(echo "$JSON" | jq -r '.deployedTo')"
      [[ "$VENUE" =~ ^0x[0-9a-fA-F]{40}$ ]] || { echo "deploy venue gagal: $JSON"; exit 1; }
      echo "venue baru: $VENUE"
      echo "{\"name\":\"prune-venue-testnet-mock\",\"chainId\":46630,\"venue\":\"$VENUE\",\"router\":\"$ROUTER\",\"spreadBps\":$SPREAD_BPS,\"slippageBps\":$SLIPPAGE_BPS}" | jq . > "$OUT"
    fi
    for v in "${TODO[@]}"; do
      cur="$(cast call "$v" 'pruneVenue()(address)' --rpc-url "$RPC")"
      if [ "$cur" = "$ZERO" ]; then
        cast send "$v" 'setPruneVenue(address)' "$VENUE" --rpc-url "$RPC" --account "$ACCOUNT" "${pw[@]}" >/dev/null
      else echo "$v: venue sudah terpasang ($cur), tidak diubah"; fi
      slip="$(cast call "$v" 'pruneSlippageBps()(uint256)' --rpc-url "$RPC" | awk '{print $1}')"
      [ "$slip" != "0" ] || cast send "$v" 'setPruneSlippageBps(uint16)' "$SLIPPAGE_BPS" --rpc-url "$RPC" --account "$ACCOUNT" "${pw[@]}" >/dev/null
      hk="$(cast call "$v" 'hasRole(bytes32,address)(bool)' "$KEEPER_ROLE" "$KEEPER" --rpc-url "$RPC")"
      [ "$hk" = "true" ] || cast send "$v" 'grantRole(bytes32,address)' "$KEEPER_ROLE" "$KEEPER" --rpc-url "$RPC" --account "$ACCOUNT" "${pw[@]}" >/dev/null
      echo "$v: venue=$(cast call "$v" 'pruneVenue()(address)' --rpc-url "$RPC") slippage=$(cast call "$v" 'pruneSlippageBps()(uint256)' --rpc-url "$RPC" | awk '{print $1}') keeperRole=$(cast call "$v" 'hasRole(bytes32,address)(bool)' "$KEEPER_ROLE" "$KEEPER" --rpc-url "$RPC")"
    done
    echo
    echo "Selesai. Kosongkan shell dari variabel lama, isi EXTRA_CORDONS di keeper/.env, lalu jalankan keeper lagi." ;;
  *) echo "pakai: dry | send"; exit 1 ;;
esac