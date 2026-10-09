#!/usr/bin/env bash
# Mengaktifkan "To USDG" (CordonVault.redeemToUsdg) di testnet 46630 TANPA men-deploy ulang vault:
#   1) deploy satu MockExecutionVenue (menjual komponen ke USDG pada harga LIVE oracle, minus spread),
#   2) pasang venue itu ke tiap vault lewat setExecutionVenue (butuh ADMIN vault = espalier-owner).
# USDG yang dipakai = USDG mock yang sama dengan Spur/Graft (field premiumToken di deployments/robinhood-testnet-mock-live.json).
# Venue mencetak USDG mock saat membayar (mint publik), jadi tidak perlu mendanai venue.
# Vault yang diproses: cMAG7 (deployments/cmag7-testnet-mock.json bila ada, kalau tidak: B1), cCHIP (deployments/cchip-testnet-mock.json),
# cVOLT (deployments/cvolt-testnet-mock.json); yang filenya tidak ada, atau vault-nya tanpa kode di chain, dilewati.
# Venue dipakai ulang: bila deployments/venue-testnet-mock.json ada (atau ada vault yang sudah memasang venue), `send` TIDAK men-deploy venue
# baru, hanya memasang venue yang sama ke vault yang belum punya. Jadi aman dijalankan lagi setelah men-deploy vault baru.
# Jalankan dari folder contracts/.
# Pakai: bash deploy-venue.sh dry   -> hanya memeriksa dan mencetak rencana, tidak mengirim apa pun
#        bash deploy-venue.sh send  -> deploy venue lalu pasang ke vault
# Opsi env: SPREAD_BPS=0 (spread venue, maks 500), PASSWORD_FILE=<file>, USDG_TOKEN=0x... (kalau premiumToken tidak ada di JSON B1).
# Pengirim = espalier-owner.
set -euo pipefail
cd "$(dirname "$0")"
[ -f .env ] || { echo ".env tidak ada di $(pwd)"; exit 1; }
set -a; source .env; set +a
: "${RH_RPC_TESTNET:?RH_RPC_TESTNET kosong}"
for c in jq cast forge; do command -v $c >/dev/null || { echo "$c belum terpasang"; exit 1; }; done

OWNER="${OWNER:-0xE0bf53F10B12bcd19A979C698809750f34512f47}"
ACCOUNT="${REFRESH_ACCOUNT:-espalier-owner}"
SPREAD_BPS="${SPREAD_BPS:-0}"
B1=deployments/robinhood-testnet-mock-live.json
OUT=deployments/venue-testnet-mock.json
RPC="$RH_RPC_TESTNET"
pw=(); [ -n "${PASSWORD_FILE:-}" ] && pw=(--password-file "$PASSWORD_FILE")
[ -f "$B1" ] || { echo "butuh $B1 (hasil deploy B1)"; exit 1; }
[[ "$SPREAD_BPS" =~ ^[0-9]+$ ]] && [ "$SPREAD_BPS" -le 500 ] || { echo "SPREAD_BPS harus 0-500"; exit 1; }

CHAIN="$(cast chain-id --rpc-url "$RPC")"
[ "$CHAIN" = "46630" ] || { echo "chain id $CHAIN, harus 46630"; exit 1; }
ROUTER="$(jq -r '.oracleRouter' "$B1")"
USDG="${USDG_TOKEN:-$(jq -r '.premiumToken // empty' "$B1")}"
[[ "$ROUTER" =~ ^0x[0-9a-fA-F]{40}$ ]] || { echo "oracleRouter tidak valid di $B1: $ROUTER"; exit 1; }
[[ "$USDG" =~ ^0x[0-9a-fA-F]{40}$ ]] || { echo "alamat USDG tidak ditemukan di $B1 (field premiumToken). Isi: USDG_TOKEN=0x... bash deploy-venue.sh $1"; exit 1; }
[ "$(cast code "$USDG" --rpc-url "$RPC")" != "0x" ] || { echo "USDG $USDG tanpa kode di chain ini"; exit 1; }
echo "router : $ROUTER"
echo "USDG   : $USDG ($(cast call "$USDG" 'symbol()(string)' --rpc-url "$RPC"), $(cast call "$USDG" 'decimals()(uint8)' --rpc-url "$RPC") desimal)"
echo "spread : $SPREAD_BPS bps"
echo "saldo owner: $(cast balance "$OWNER" --rpc-url "$RPC" -e) ETH"

# Kumpulkan vault.
NAMES=(); VAULTS=()
add() { local f="$2"; [ -f "$f" ] || { echo "(lewati $1: $f tidak ada)"; return; }
        local v; v="$(jq -r '.cordonVault' "$f")"
        [[ "$v" =~ ^0x[0-9a-fA-F]{40}$ ]] || { echo "(lewati $1: cordonVault tidak valid di $f)"; return; }
        [ "$(cast code "$v" --rpc-url "$RPC")" != "0x" ] || { echo "(lewati $1: $v di $f tanpa kode di chain, sisa deploy yang gagal? hapus file itu lalu deploy ulang)"; return; }
        NAMES+=("$1"); VAULTS+=("$v"); }
# cMAG7: vault baru (deploy-cmag7.sh) kalau ada; kalau belum, vault dari deploy B1.
if [ -f deployments/cmag7-testnet-mock.json ]; then add cMAG7 deployments/cmag7-testnet-mock.json; else add cMAG7 "$B1"; fi
add cCHIP deployments/cchip-testnet-mock.json; add cVOLT deployments/cvolt-testnet-mock.json
[ "${#VAULTS[@]}" -gt 0 ] || { echo "tidak ada vault"; exit 1; }

ADMIN_ROLE=0x0000000000000000000000000000000000000000000000000000000000000000
TODO=(); EXISTING_VENUE=""
for i in "${!VAULTS[@]}"; do
  n="${NAMES[$i]}"; v="${VAULTS[$i]}"
  sym="$(cast call "$v" 'symbol()(string)' --rpc-url "$RPC" | tr -d '"')"
  cur="$(cast call "$v" 'executionVenue()(address)' --rpc-url "$RPC" 2>/dev/null || echo ERR)"
  isadmin="$(cast call "$v" 'hasRole(bytes32,address)(bool)' "$ADMIN_ROLE" "$OWNER" --rpc-url "$RPC")"
  if [ "$cur" = "ERR" ]; then echo "$n ($sym) $v: TIDAK punya executionVenue(), kontrak lama, dilewati"; continue; fi
  if [ "$cur" != "0x0000000000000000000000000000000000000000" ]; then echo "$n ($sym) $v: venue sudah terpasang ($cur), dilewati"; [ -n "$EXISTING_VENUE" ] || EXISTING_VENUE="$cur"; continue; fi
  if [ "$isadmin" != "true" ]; then echo "$n ($sym) $v: $OWNER bukan ADMIN vault ini, dilewati"; continue; fi
  echo "$n ($sym) $v: siap dipasang"; TODO+=("$v")
done
[ "${#TODO[@]}" -gt 0 ] || { echo "tidak ada vault yang perlu dipasang"; exit 0; }

case "${1:-dry}" in
  dry) if [ -f "$OUT" ] || [ -n "$EXISTING_VENUE" ]; then echo "dry: tidak ada transaksi dikirim. 'send' akan memakai ulang venue yang sudah ada dan memasangnya ke ${#TODO[@]} vault."
       else echo "dry: tidak ada transaksi dikirim. 'send' akan men-deploy venue baru dan memasangnya ke ${#TODO[@]} vault."; fi ;;
  send)
    # Pakai ulang venue yang sudah ada (file hasil deploy venue, atau venue yang sudah terpasang di vault lain). Deploy baru hanya bila belum ada.
    VENUE=""
    if [ -f "$OUT" ]; then VENUE="$(jq -r '.venue' "$OUT")"; elif [ -n "$EXISTING_VENUE" ]; then VENUE="$EXISTING_VENUE"; fi
    if [ -n "$VENUE" ]; then
      [[ "$VENUE" =~ ^0x[0-9a-fA-F]{40}$ ]] || { echo "alamat venue tidak valid ($VENUE) di $OUT"; exit 1; }
      [ "$(cast code "$VENUE" --rpc-url "$RPC")" != "0x" ] || { echo "venue $VENUE tanpa kode di chain. Hapus $OUT bila mau deploy venue baru."; exit 1; }
      vu="$(cast call "$VENUE" 'USDG()(address)' --rpc-url "$RPC")"; vr="$(cast call "$VENUE" 'ROUTER()(address)' --rpc-url "$RPC")"
      if [ "${vu,,}" != "${USDG,,}" ] || [ "${vr,,}" != "${ROUTER,,}" ]; then
        echo "venue $VENUE tidak cocok (USDG=$vu, router=$vr; seharusnya USDG=$USDG, router=$ROUTER). Hapus $OUT bila mau deploy venue baru."; exit 1
      fi
      echo "memakai ulang venue yang sudah ada: $VENUE"
    else
      JSON="$(forge create test/mocks/MockExecutionVenue.sol:MockExecutionVenue --rpc-url "$RPC" --account "$ACCOUNT" "${pw[@]}" \
        --broadcast --json --constructor-args "$ROUTER" "$USDG" "$OWNER" "$SPREAD_BPS")"
      VENUE="$(echo "$JSON" | jq -r '.deployedTo')"
      [[ "$VENUE" =~ ^0x[0-9a-fA-F]{40}$ ]] || { echo "deploy venue gagal: $JSON"; exit 1; }
      echo "venue baru: $VENUE"
      echo "{\"name\":\"venue-testnet-mock\",\"chainId\":46630,\"venue\":\"$VENUE\",\"usdg\":\"$USDG\",\"router\":\"$ROUTER\",\"spreadBps\":$SPREAD_BPS}" | jq . > "$OUT"
    fi
    for v in "${TODO[@]}"; do
      cast send "$v" 'setExecutionVenue(address)' "$VENUE" --rpc-url "$RPC" --account "$ACCOUNT" "${pw[@]}" >/dev/null
      echo "terpasang di $v: venue=$(cast call "$v" 'executionVenue()(address)' --rpc-url "$RPC"), usdg=$(cast call "$v" 'usdgToken()(address)' --rpc-url "$RPC")"
    done
    echo
    echo "Selesai. Tidak ada perubahan env. Muat ulang web; 'To USDG' aktif di panel Redeem selama harga live tersedia (pasar buka)." ;;
  *) echo "pakai: dry | send"; exit 1 ;;
esac