#!/usr/bin/env bash
# Pemeriksa kesiapan LIVE mainnet (4663). HANYA MEMBACA: tidak mengirim transaksi, tidak butuh kunci privat.
# Jalankan dari folder contracts/ (butuh cast dan curl):
#   bash preflight-mainnet.sh ../vercel.mainnet.env
# Membaca env yang sama dengan Vercel. Tambahan opsional di env/shell: PICKER_ADDRESS=0x... (alamat dompet Picker, BUKAN kunci).
# Hasil: per lane "SIAP LIVE" atau "BELUM" beserta alasannya. Exit 1 bila ada yang BELUM.
set -uo pipefail
ENVFILE="${1:-../vercel.mainnet.env}"
[ -f "$ENVFILE" ] || { echo "file env tidak ada: $ENVFILE"; exit 1; }
command -v cast >/dev/null || { echo "cast (Foundry) belum terpasang"; exit 1; }
set -a; source "$ENVFILE"; set +a

RPC="${KEEPER_RPC_URL:-${INDEXER_RPC_URL:-}}"
[ -n "$RPC" ] || { echo "KEEPER_RPC_URL / INDEXER_RPC_URL kosong"; exit 1; }
KEEPER="${KEEPER_ADDRESS:-}"
ZERO=0x0000000000000000000000000000000000000000
fail=0
ok()  { printf '    ok     %s\n' "$1"; }
no()  { printf '    BELUM  %s\n' "$1"; fail=1; lane_bad=1; }
warn(){ printf '    catatan %s\n' "$1"; }
call(){ cast call "$@" --rpc-url "$RPC" 2>/dev/null | awk 'NR==1{print $1}'; }
isaddr(){ [[ "${1:-}" =~ ^0x[0-9a-fA-F]{40}$ && "$1" != "$ZERO" ]]; }
verdict(){ if [ "${lane_bad:-0}" = 0 ]; then echo "  => $1: SIAP LIVE"; else echo "  => $1: BELUM"; fi; }

echo "== Umum"
lane_bad=0
[ "$(cast chain-id --rpc-url "$RPC" 2>/dev/null)" = "4663" ] && ok "RPC = chain 4663" || no "RPC bukan chain 4663 / tidak terjangkau"
isaddr "$KEEPER" && ok "KEEPER_ADDRESS terisi ($KEEPER)" || no "KEEPER_ADDRESS kosong / tidak valid"
[ "${KEEPER_CHAIN_ID:-${INDEXER_CHAIN_ID:-}}" = "4663" ] && ok "KEEPER_CHAIN_ID / INDEXER_CHAIN_ID = 4663" || no "KEEPER_CHAIN_ID / INDEXER_CHAIN_ID bukan 4663"
[ -n "${CRON_SECRET:-}" ] && ok "CRON_SECRET terisi" || no "CRON_SECRET kosong"
[ -n "${SUPABASE_URL:-}" ] && [ -n "${SUPABASE_SERVICE_ROLE_KEY:-}" ] && ok "Supabase server terisi" || no "SUPABASE_URL / SERVICE_ROLE_KEY kosong"
[ "${FEED_BOT_PRIVATE_KEY:-}" = "" ] && [ "${FEED_ADDRESSES:-}" = "" ] && ok "tidak ada FEED_* (benar untuk mainnet)" || no "FEED_* terisi: kosongkan di mainnet"
if isaddr "$KEEPER"; then
  bal="$(cast balance "$KEEPER" --rpc-url "$RPC" 2>/dev/null || echo 0)"
  [ "$bal" != "0" ] && [ "${#bal}" -ge 15 ] && ok "saldo ETH keeper $(cast from-wei "$bal" 2>/dev/null) (>= 0,001)" || no "saldo ETH keeper rendah: ${bal} wei (isi >= 0,003 ETH)"
fi
verdict "Umum"

KR="$(cast keccak KEEPER_ROLE)"
check_cordon() { # alamat label
  local v="$1" label="$2"
  echo "== Cordon $label ($v)"; lane_bad=0
  isaddr "$v" || { no "alamat tidak valid"; verdict "$label"; return; }
  local sym; sym="$(cast call "$v" 'symbol()(string)' --rpc-url "$RPC" 2>/dev/null | tr -d '"')"
  [ -n "$sym" ] && ok "symbol $sym" || { no "vault tidak terbaca di chain ini"; verdict "$label"; return; }
  [ "$(call "$v" 'hasRole(bytes32,address)(bool)' "$KR" "$KEEPER")" = "true" ] && ok "keeper punya KEEPER_ROLE" || no "keeper TIDAK punya KEEPER_ROLE"
  local venue slip
  venue="$(call "$v" 'pruneVenue()(address)')"; slip="$(call "$v" 'pruneSlippageBps()(uint16)')"
  isaddr "$venue" && ok "pruneVenue = $venue" || no "pruneVenue belum diatur (ADMIN/timelock 48 jam harus setPruneVenue; butuh adapter DEX sungguhan)"
  [[ "$slip" =~ ^[0-9]+$ && "$slip" -gt 0 ]] && ok "pruneSlippageBps = $slip" || no "pruneSlippageBps belum diatur"
  verdict "KEEPER_MODE=live untuk $label"
}
check_cordon "${CORDON_VAULT_ADDRESS:-}" "cMAG7 (lane cordon)"
i=1
IFS=',' read -ra EX <<< "${EXTRA_CORDONS:-}"
for part in "${EX[@]}"; do part="${part// /}"; [ -n "$part" ] || continue; check_cordon "${part%%@*}" "extra #$i (lane cordon$i)"; i=$((i+1)); done
[ "$i" -ge 3 ] || warn "EXTRA_CORDONS belum berisi cCHIP dan cVOLT (urutan: cCHIP lalu cVOLT)"

check_round() { # nama alamat
  local name="$1" v="$2"
  isaddr "$v" || { echo "== $name: alamat kosong, lane dilewati (normal bila belum di-deploy)"; return; }
  echo "== $name ($v)"; lane_bad=0
  [ "$(call "$v" 'hasRole(bytes32,address)(bool)' "$KR" "$KEEPER")" = "true" ] && ok "keeper punya KEEPER_ROLE di vault" || no "keeper TIDAK punya KEEPER_ROLE di vault"
  local auc; auc="$(call "$v" 'AUCTION()(address)')"
  if isaddr "$auc"; then
    ok "HarvestAuction $auc"
    [ "$(call "$auc" 'hasRole(bytes32,address)(bool)' "$KR" "$KEEPER")" = "true" ] && ok "keeper punya KEEPER_ROLE di HarvestAuction" || no "keeper TIDAK punya KEEPER_ROLE di HarvestAuction"
    [ -z "${RFQ_AUCTION_ADDRESS:-}" ] || { [ "${RFQ_AUCTION_ADDRESS,,}" = "${auc,,}" ] && ok "RFQ_AUCTION_ADDRESS cocok" || no "RFQ_AUCTION_ADDRESS BEDA dengan AUCTION() vault"; }
  else no "AUCTION() tidak terbaca"; fi
  [ "$(call "$v" 'paused()(bool)')" = "false" ] && ok "vault tidak dijeda" || no "vault sedang dijeda"
  local P="${PICKER_ADDRESS:-}"
  if isaddr "$P" && isaddr "$auc"; then
    [ "$(call "$auc" 'isPicker(address)(bool)' "$P")" = "true" ] && ok "Picker terdaftar di HarvestAuction" || no "Picker TIDAK terdaftar di HarvestAuction (harus masuk pickers[] sebelum deploy)"
    local tok prem bal al
    tok="$(call "$v" 'PREMIUM()(address)')"; prem="${RFQ_PREMIUM_RAW:-0}"
    bal="$(call "$tok" 'balanceOf(address)(uint256)' "$P")"; al="$(call "$tok" 'allowance(address,address)(uint256)' "$P" "$auc")"
    [[ "$bal" =~ ^[0-9]+$ && "$prem" =~ ^[0-9]+$ && "$prem" -gt 0 && "$bal" -ge "$prem" ]] && ok "saldo USDG Picker $bal >= premi $prem" || no "saldo USDG Picker kurang / RFQ_PREMIUM_RAW kosong (saldo=$bal premi=$prem)"
    [[ "$al" =~ ^[0-9]+$ && "$prem" =~ ^[0-9]+$ && "$prem" -gt 0 && "$al" -ge "$prem" ]] && ok "allowance USDG ke HarvestAuction $al >= premi" || no "allowance USDG Picker ke HarvestAuction kurang (allowance=$al)"
    local pb; pb="$(cast balance "$P" --rpc-url "$RPC" 2>/dev/null || echo 0)"; [ "${#pb}" -ge 15 ] && ok "saldo ETH Picker cukup untuk klaim" || no "saldo ETH Picker rendah ($pb wei)"
  else warn "isi PICKER_ADDRESS=0x... (alamat dompet Picker) untuk memeriksa pendaftaran, USDG, dan allowance"; fi
  for k in RFQ_ALLOW_MAINNET RFQ_TOKEN RFQ_URL RFQ_PREMIUM_RAW RFQ_MAX_PREMIUM_RAW RFQ_MAX_NOTIONAL_RAW RFQ_PICKER_PRIVATE_KEY; do
    [ -n "${!k:-}" ] && ok "$k terisi" || no "$k kosong"
  done
  [ "${RFQ_ALLOW_MAINNET:-}" = "true" ] || no "RFQ_ALLOW_MAINNET harus true"
  verdict "${name%% *}_MODE=live"
}
check_round "Spur" "${SPUR_VAULT_ADDRESS:-}"
check_round "Graft" "${GRAFT_VAULT_ADDRESS:-}"

echo "== Cron dan indexer (butuh domain terisi)"
if [ -n "${NEXT_PUBLIC_SITE_URL:-}" ] && [ -n "${CRON_SECRET:-}" ] && command -v curl >/dev/null; then
  for p in "index?stream=cordon" "keeper?lane=cordon" "health"; do
    code="$(curl -s -o /dev/null -w '%{http_code}' -H "Authorization: Bearer $CRON_SECRET" "$NEXT_PUBLIC_SITE_URL/api/cron/$p" || echo 000)"
    [ "$code" = "200" ] && echo "    ok     /api/cron/$p = 200" || echo "    BELUM  /api/cron/$p = $code (cek env Vercel, redeploy, dan log route)"
  done
else echo "    dilewati: NEXT_PUBLIC_SITE_URL / CRON_SECRET kosong"; fi

echo
[ "$fail" = 0 ] && echo "SEMUA LANE SIAP." || echo "ADA YANG BELUM SIAP: jangan ubah mode itu ke live sebelum bagian BELUM beres."
exit "$fail"
