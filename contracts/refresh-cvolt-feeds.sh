#!/usr/bin/env bash
# Feed mock tidak update sendiri: setelah jendela staleness (15 menit di sesi Regular) harga dianggap basi dan
# mint / NAV gagal (PriceUnavailable(8)). Skrip ini menyegarkan feed TSLA, RIVN, LCID, NIO dengan setRound(int256).
# Catatan: feed TSLA dipakai bersama cMAG7, jadi harga TSLA ikut berubah di sana (default 300 = harga di config cMAG7).
# Pakai (dari contracts/):  bash refresh-cvolt-feeds.sh           -> sekali
#                           LOOP=600 bash refresh-cvolt-feeds.sh -> ulangi tiap 600 detik (Ctrl+C untuk berhenti)
# Harga bisa diubah lewat env, mis. PRICE_RIVN=18 (dolar bulat, bukan e8).
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
CV=deployments/cvolt-testnet-mock.json
[ -f "$B1" ] && [ -f "$CV" ] || { echo "butuh $B1 dan $CV"; exit 1; }

# Urutan feed: TSLA = indeks 6 di deploy B1; di cVOLT indeks 0 = TSLA (sama dengan B1), RIVN, LCID, NIO = indeks 1, 2, 3.
FEED_TSLA="$(jq -r '.feeds[6]' "$B1")"
FEED_RIVN="$(jq -r '.feeds[1]' "$CV")"
FEED_LCID="$(jq -r '.feeds[2]' "$CV")"
FEED_NIO="$(jq -r '.feeds[3]' "$CV")"
for v in FEED_TSLA FEED_RIVN FEED_LCID FEED_NIO; do
  [[ "${!v}" =~ ^0x[0-9a-fA-F]{40}$ ]] || { echo "$v tidak valid: ${!v}"; exit 1; }
done
PRICE_TSLA="${PRICE_TSLA:-300}"; PRICE_RIVN="${PRICE_RIVN:-15}"; PRICE_LCID="${PRICE_LCID:-3}"; PRICE_NIO="${PRICE_NIO:-5}"

refresh() {
  for t in TSLA RIVN LCID NIO; do
    feed="FEED_$t"; price="PRICE_$t"
    e8=$(( ${!price} * 100000000 ))
    pw=(); [ -n "${PASSWORD_FILE:-}" ] && pw=(--password-file "$PASSWORD_FILE")
    cast send "${!feed}" 'setRound(int256)' "$e8" --rpc-url "$RH_RPC_TESTNET" --account "${REFRESH_ACCOUNT:-espalier-owner}" "${pw[@]}" >/dev/null
    echo "$(date -u +%H:%M:%S) $t = \$${!price}"
  done
}

refresh
while [ -n "${LOOP:-}" ]; do sleep "$LOOP"; refresh; done
