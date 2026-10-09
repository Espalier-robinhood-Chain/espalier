#!/usr/bin/env bash
# Feed mock tidak update sendiri: setelah jendela staleness (15 menit di sesi Regular) harga dianggap basi dan
# mint / NAV gagal (PriceUnavailable(8)). Skrip ini menyegarkan feed AAPL, MSFT, GOOGL, AMZN, NVDA, META, TSLA (7 aset cMAG7)
# dengan setRound(int256).
# Catatan: feed NVDA dipakai bersama cCHIP, Spur, dan Graft; feed TSLA dipakai bersama cVOLT. Default NVDA = 250 dan
# TSLA = 300 sama dengan refresh-cchip-feeds.sh dan refresh-cvolt-feeds.sh, jadi tidak saling menimpa dengan harga lain.
# Pakai (dari contracts/):  bash refresh-cmag7-feeds.sh           -> sekali
#                           LOOP=600 bash refresh-cmag7-feeds.sh -> ulangi tiap 600 detik (Ctrl+C untuk berhenti)
# Harga bisa diubah lewat env, mis. PRICE_AAPL=260 (dolar bulat, bukan e8).
# setRound di feed mock tidak butuh izin, jadi akun pengirim bebas: REFRESH_ACCOUNT=<nama keystore> (default espalier-owner).
# Tiap transaksi meminta password keystore. Untuk mode LOOP di TESTNET, boleh PASSWORD_FILE=<file berisi password>
# (jangan dipakai untuk kunci bernilai, dan jangan di-commit).
set -euo pipefail
cd "$(dirname "$0")"
[ -f .env ] || { echo ".env tidak ada di $(pwd)"; exit 1; }
set -a; source .env; set +a
: "${RH_RPC_TESTNET:?RH_RPC_TESTNET kosong}"
command -v jq >/dev/null || { echo "jq belum terpasang: sudo apt install -y jq"; exit 1; }

B1=deployments/robinhood-testnet-mock-live.json
[ -f "$B1" ] || { echo "butuh $B1"; exit 1; }

# Urutan feed di deploy B1 (sama dengan urutan aset): AAPL, MSFT, GOOGL, AMZN, NVDA, META, TSLA = indeks 0..6.
FEED_AAPL="$(jq -r '.feeds[0]' "$B1")"; FEED_MSFT="$(jq -r '.feeds[1]' "$B1")"; FEED_GOOGL="$(jq -r '.feeds[2]' "$B1")"
FEED_AMZN="$(jq -r '.feeds[3]' "$B1")"; FEED_NVDA="$(jq -r '.feeds[4]' "$B1")"; FEED_META="$(jq -r '.feeds[5]' "$B1")"
FEED_TSLA="$(jq -r '.feeds[6]' "$B1")"
for v in FEED_AAPL FEED_MSFT FEED_GOOGL FEED_AMZN FEED_NVDA FEED_META FEED_TSLA; do
  [[ "${!v}" =~ ^0x[0-9a-fA-F]{40}$ ]] || { echo "$v tidak valid di $B1: ${!v} (struktur file berbeda dari dugaan, berhenti)"; exit 1; }
done
PRICE_AAPL="${PRICE_AAPL:-250}"; PRICE_MSFT="${PRICE_MSFT:-450}"; PRICE_GOOGL="${PRICE_GOOGL:-180}"; PRICE_AMZN="${PRICE_AMZN:-220}"
PRICE_NVDA="${PRICE_NVDA:-250}"; PRICE_META="${PRICE_META:-650}"; PRICE_TSLA="${PRICE_TSLA:-300}"

refresh() {
  for t in AAPL MSFT GOOGL AMZN NVDA META TSLA; do
    feed="FEED_$t"; price="PRICE_$t"
    e8=$(( ${!price} * 100000000 ))
    pw=(); [ -n "${PASSWORD_FILE:-}" ] && pw=(--password-file "$PASSWORD_FILE")
    cast send "${!feed}" 'setRound(int256)' "$e8" --rpc-url "$RH_RPC_TESTNET" --account "${REFRESH_ACCOUNT:-espalier-owner}" "${pw[@]}" >/dev/null
    echo "$(date -u +%H:%M:%S) $t = \$${!price}"
  done
}

refresh
while [ -n "${LOOP:-}" ]; do sleep "$LOOP"; refresh; done
