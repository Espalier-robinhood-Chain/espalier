#!/usr/bin/env bash
# Feed mock tidak update sendiri: setelah jendela staleness (15 menit di sesi Regular) harga dianggap basi dan
# mint / NAV gagal (PriceUnavailable(8)). Skrip ini menyegarkan feed NVDA, AMD, AVGO, TSM dengan setRound(int256).
# Catatan: feed NVDA dipakai bersama cMAG7, Spur, dan Graft, jadi harga NVDA ikut berubah untuk semuanya.
# Pakai (dari contracts/):  bash refresh-cchip-feeds.sh           -> sekali
#                           LOOP=600 bash refresh-cchip-feeds.sh -> ulangi tiap 600 detik (Ctrl+C untuk berhenti)
# Harga bisa diubah lewat env, mis. PRICE_AMD=170 (dolar, bukan e8).
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
CH=deployments/cchip-testnet-mock.json
[ -f "$B1" ] && [ -f "$CH" ] || { echo "butuh $B1 dan $CH"; exit 1; }

# Urutan feed: NVDA = indeks 4 di deploy B1; AMD, AVGO, TSM = indeks 1, 2, 3 di cCHIP (indeks 0 = NVDA, sama dengan B1).
FEED_NVDA="$(jq -r '.feeds[4]' "$B1")"
FEED_AMD="$(jq -r '.feeds[1]' "$CH")"
FEED_AVGO="$(jq -r '.feeds[2]' "$CH")"
FEED_TSM="$(jq -r '.feeds[3]' "$CH")"
PRICE_NVDA="${PRICE_NVDA:-250}"; PRICE_AMD="${PRICE_AMD:-160}"; PRICE_AVGO="${PRICE_AVGO:-310}"; PRICE_TSM="${PRICE_TSM:-200}"

refresh() {
  for t in NVDA AMD AVGO TSM; do
    feed="FEED_$t"; price="PRICE_$t"
    e8=$(( ${!price} * 100000000 ))
    pw=(); [ -n "${PASSWORD_FILE:-}" ] && pw=(--password-file "$PASSWORD_FILE")
    cast send "${!feed}" 'setRound(int256)' "$e8" --rpc-url "$RH_RPC_TESTNET" --account "${REFRESH_ACCOUNT:-espalier-owner}" "${pw[@]}" >/dev/null
    echo "$(date -u +%H:%M:%S) $t = \$${!price}"
  done
}

refresh
while [ -n "${LOOP:-}" ]; do sleep "$LOOP"; refresh; done
