#!/usr/bin/env bash
# Verifikasi ON-CHAIN alamat di config mainnet (hanya membaca). Jalankan dari folder contracts/:
#   RH_RPC_MAINNET=https://... bash script/verify-addresses.sh [script/config/robinhood-mainnet.json]
# Memeriksa (assets + routerAssets): chain id 4663, kode di tiap token/feed/USDG, symbol & decimals token, decimals/description/harga feed,
# umur harga (updatedAt), uiMultiplier() dan oraclePaused() token. Ubah addressesVerified ke true HANYA bila semua "ok".
set -euo pipefail
CFG="${1:-script/config/robinhood-mainnet.json}"
RPC="${RH_RPC_MAINNET:?isi RH_RPC_MAINNET}"
command -v cast >/dev/null && command -v jq >/dev/null || { echo "butuh cast (Foundry) dan jq"; exit 1; }
fail=0; ok(){ printf '  ok    %s\n' "$1"; }; bad(){ printf '  GAGAL %s\n' "$1"; fail=1; }
[[ "$(cast chain-id --rpc-url "$RPC")" == "4663" ]] && ok "chain id 4663" || { bad "chain id bukan 4663"; exit 1; }
hascode(){ [[ "$(cast code "$1" --rpc-url "$RPC")" != "0x" ]]; }
USDG="$(jq -r .spur.premiumToken "$CFG")"
hascode "$USDG" && ok "USDG punya kode" || bad "USDG tanpa kode"
[[ "$(cast call "$USDG" 'decimals()(uint8)' --rpc-url "$RPC")" == "6" ]] && ok "USDG decimals 6" || bad "USDG decimals bukan 6"
NOW="$(date +%s)"
while read -r SYM TOKEN FEED; do
  echo "== $SYM"
  hascode "$TOKEN" && ok "token punya kode" || { bad "token tanpa kode ($TOKEN)"; continue; }
  hascode "$FEED"  && ok "feed punya kode"  || { bad "feed tanpa kode ($FEED)"; continue; }
  S="$(cast call "$TOKEN" 'symbol()(string)' --rpc-url "$RPC" | tr -d '"')"
  [[ "$S" == "$SYM" ]] && ok "symbol $S" || bad "symbol token '$S' != $SYM"
  [[ "$(cast call "$TOKEN" 'decimals()(uint8)' --rpc-url "$RPC")" == "18" ]] && ok "decimals 18" || bad "decimals bukan 18"
  [[ "$(cast call "$FEED" 'decimals()(uint8)' --rpc-url "$RPC")" == "8" ]] && ok "feed decimals 8" || bad "feed decimals bukan 8"
  echo "      feed: $(cast call "$FEED" 'description()(string)' --rpc-url "$RPC")"
  R="$(cast call "$FEED" 'latestRoundData()(uint80,int256,uint256,uint256,uint80)' --rpc-url "$RPC")"
  ANS="$(echo "$R" | sed -n 2p | awk '{print $1}')"; UPD="$(echo "$R" | sed -n 4p | awk '{print $1}')"
  [[ "$ANS" =~ ^[0-9]+$ && "$ANS" -gt 0 ]] && ok "harga positif ($ANS, 8 desimal)" || bad "harga tidak valid ($ANS)"
  echo "      umur harga: $((NOW-UPD)) detik"
  echo "      uiMultiplier: $(cast call "$TOKEN" 'uiMultiplier()(uint256)' --rpc-url "$RPC")  oraclePaused: $(cast call "$TOKEN" 'oraclePaused()(bool)' --rpc-url "$RPC")"
done < <(jq -r '(.assets + (.routerAssets // []))[] | "\(.symbol) \(.token) \(.feed)"' "$CFG")
# Config Cordon (cCHIP, cVOLT): tiap aset harus sama persis (token + feed) dengan config utama (assets + routerAssets), bobot = 10000.
UNION="$(jq -c '[.assets[], (.routerAssets // [])[]] | map({key: .symbol, value: {token: .token, feed: .feed}}) | from_entries' "$CFG")"
CDIR="$(dirname "$CFG")"
for C in "$CDIR/cchip-mainnet.json" "$CDIR/cvolt-mainnet.json"; do
  [ -f "$C" ] || continue
  echo "== Cordon: $C"
  while read -r SYM TOKEN FEED; do
    E="$(echo "$UNION" | jq -r --arg s "$SYM" '.[$s] | if . == null then "" else "\(.token) \(.feed)" end')"
    [[ -n "$E" && "${E,,}" == "${TOKEN,,} ${FEED,,}" ]] && ok "$SYM sama dengan config utama" || bad "$SYM tidak cocok / tidak ada di config utama ($E)"
  done < <(jq -r '.assets[] | "\(.symbol) \(.token) \(.feed)"' "$C")
  W="$(jq '[.assets[].targetBps] | add' "$C")"
  [[ "$W" == "10000" ]] && ok "jumlah bobot 10000" || bad "jumlah bobot $W bukan 10000"
done
[[ $fail == 0 ]] && echo "SEMUA OK" || { echo "ADA YANG GAGAL"; exit 1; }
