#!/usr/bin/env bash
# Mencetak nilai env FEED_ADDRESSES (alamat=harga dolar) untuk Vercel, dari file deployments/.
# Taruh di contracts/ lalu: bash cron-feed-env.sh   (butuh jq: sudo apt install -y jq)
# Urutan feed: B1 = AAPL MSFT GOOGL AMZN NVDA META TSLA (indeks 0-6); cCHIP = NVDA AMD AVGO TSM; cVOLT = TSLA RIVN LCID NIO.
# NVDA dan TSLA dipakai bersama, jadi hanya dicetak sekali (dari B1). Ubah harga: PRICE_AMD=170 bash cron-feed-env.sh
set -euo pipefail
cd "$(dirname "$0")"
command -v jq >/dev/null || { echo "jq belum terpasang: sudo apt install -y jq" >&2; exit 1; }
B1=deployments/robinhood-testnet-mock-live.json
CH=deployments/cchip-testnet-mock.json
CV=deployments/cvolt-testnet-mock.json
[ -f "$B1" ] || { echo "tidak ada $B1" >&2; exit 1; }

out=()
add() { # $1 = nama (untuk pesan), $2 = file, $3 = indeks, $4 = harga dolar
  local a; a="$(jq -r ".feeds[$3] // empty" "$2")"
  [[ "$a" =~ ^0x[0-9a-fA-F]{40}$ ]] || { echo "alamat feed $1 tidak valid di $2 (indeks $3)" >&2; exit 1; }
  out+=("$a=$4")
}
add AAPL  "$B1" 0 "${PRICE_AAPL:-250}"
add MSFT  "$B1" 1 "${PRICE_MSFT:-250}"
add GOOGL "$B1" 2 "${PRICE_GOOGL:-250}"
add AMZN  "$B1" 3 "${PRICE_AMZN:-250}"
add NVDA  "$B1" 4 "${PRICE_NVDA:-250}"
add META  "$B1" 5 "${PRICE_META:-250}"
add TSLA  "$B1" 6 "${PRICE_TSLA:-300}"
if [ -f "$CH" ]; then
  add AMD  "$CH" 1 "${PRICE_AMD:-160}"; add AVGO "$CH" 2 "${PRICE_AVGO:-310}"; add TSM "$CH" 3 "${PRICE_TSM:-200}"
else echo "(lewati cCHIP: $CH tidak ada)" >&2; fi
if [ -f "$CV" ]; then
  add RIVN "$CV" 1 "${PRICE_RIVN:-15}"; add LCID "$CV" 2 "${PRICE_LCID:-3}"; add NIO "$CV" 3 "${PRICE_NIO:-5}"
else echo "(lewati cVOLT: $CV tidak ada)" >&2; fi

echo "${#out[@]} feed" >&2
echo "FEED_ADDRESSES=$(IFS=,; echo "${out[*]}")"
