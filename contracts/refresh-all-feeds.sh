#!/usr/bin/env bash
# Menyegarkan SEMUA feed mock (setRound) dalam satu perintah, tanpa cron dan tanpa skrip lain. Taruh di contracts/.
# Feed mock tidak update sendiri: setelah jendela staleness (15-60 menit) harga dianggap basi, lalu mint, NAV, rollRound gagal
# (PriceUnavailable(8)). Skrip ini menyegarkan feed cMAG7 (AAPL MSFT GOOGL AMZN NVDA META TSLA), cCHIP (AMD AVGO TSM),
# dan cVOLT (RIVN LCID NIO). Bagian cCHIP / cVOLT dilewati bila file deployments-nya tidak ada.
#
#   bash refresh-all-feeds.sh                      sekali
#   LOOP=600 bash refresh-all-feeds.sh             ulangi tiap 600 detik (Ctrl+C untuk berhenti)
#   PRICE_NVDA=270 bash refresh-all-feeds.sh       ubah satu harga (dolar, boleh desimal: PRICE_LCID=3.5)
#   REFRESH_ACCOUNT=espalier-testnet bash ...      akun penanda tangan (default espalier-owner); setRound terbuka untuk siapa saja
#   PASSWORD_FILE=<file> bash ...                  password dari file (hanya testnet, jangan di-commit); tanpa ini password ditanya SEKALI
# Harga bawaan: AAPL MSFT GOOGL AMZN NVDA META 250, TSLA 300, AMD 160, AVGO 310, TSM 200, RIVN 15, LCID 3, NIO 5.
# Catatan: NVDA dan TSLA dipakai bersama (cMAG7, Spur, Graft, cCHIP, cVOLT), jadi harganya ikut berubah di semuanya.
set -euo pipefail
cd "$(dirname "$0")"
[ -f .env ] || { echo ".env tidak ada di $(pwd)"; exit 1; }
set -a; source .env; set +a
R="${RH_RPC_TESTNET:?RH_RPC_TESTNET kosong}"
command -v jq   >/dev/null || { echo "jq belum terpasang: sudo apt install -y jq"; exit 1; }
command -v cast >/dev/null || { echo "cast (Foundry) belum terpasang"; exit 1; }
ACCOUNT="${REFRESH_ACCOUNT:-espalier-owner}"

B1=deployments/robinhood-testnet-mock-live.json
CH=deployments/cchip-testnet-mock.json
CV=deployments/cvolt-testnet-mock.json
[ -f "$B1" ] || { echo "tidak ada $B1"; exit 1; }

NAMES=(); ADDRS=(); USDS=()
add() { # nama, file, indeks di .feeds, harga bawaan (dolar)
  local name="$1" file="$2" idx="$3" dflt="$4" a p var="PRICE_$1"
  a="$(jq -r ".feeds[$idx] // empty" "$file")"
  [[ "$a" =~ ^0x[0-9a-fA-F]{40}$ ]] || { echo "alamat feed $name tidak valid di $file (indeks $idx): '$a'"; exit 1; }
  p="${!var:-$dflt}"
  [[ "$p" =~ ^[0-9]+(\.[0-9]{1,8})?$ ]] || { echo "$var harus angka dolar (mis. 250 atau 15.5), bukan '$p'"; exit 1; }
  NAMES+=("$name"); ADDRS+=("$a"); USDS+=("$p")
}
# Urutan feed di deploy B1: AAPL MSFT GOOGL AMZN NVDA META TSLA (indeks 0-6).
add AAPL "$B1" 0 250; add MSFT "$B1" 1 250; add GOOGL "$B1" 2 250; add AMZN "$B1" 3 250
add NVDA "$B1" 4 250; add META "$B1" 5 250; add TSLA  "$B1" 6 300
# cCHIP: indeks 0 = NVDA (sama dengan B1), 1-3 = AMD AVGO TSM. cVOLT: indeks 0 = TSLA (sama dengan B1), 1-3 = RIVN LCID NIO.
if [ -f "$CH" ]; then add AMD "$CH" 1 160; add AVGO "$CH" 2 310; add TSM "$CH" 3 200; else echo "(cCHIP dilewati: $CH tidak ada)"; fi
if [ -f "$CV" ]; then add RIVN "$CV" 1 15;  add LCID "$CV" 2 3;    add NIO "$CV" 3 5;   else echo "(cVOLT dilewati: $CV tidak ada)"; fi

# Password: sekali saja (disimpan di memori proses ini), atau dari PASSWORD_FILE.
PWARGS=()
if [ -n "${PASSWORD_FILE:-}" ]; then PWARGS=(--password-file "$PASSWORD_FILE")
else read -r -s -p "password keystore $ACCOUNT: " PW; echo; PWARGS=(--password "$PW"); fi

refresh() {
  local ok=0 i e8
  for i in "${!NAMES[@]}"; do
    e8="$(cast parse-units "${USDS[$i]}" 8)"
    if cast send "${ADDRS[$i]}" 'setRound(int256)' "$e8" --rpc-url "$R" --account "$ACCOUNT" "${PWARGS[@]}" >/dev/null 2>&1; then
      ok=$((ok + 1)); echo "$(date -u +%H:%M:%S) ok     ${NAMES[$i]} = \$${USDS[$i]}"
    else
      echo "$(date -u +%H:%M:%S) GAGAL  ${NAMES[$i]} ${ADDRS[$i]} (cek password, dan saldo gas akun $ACCOUNT)"
    fi
  done
  echo "$ok/${#NAMES[@]} feed disegarkan."
}

refresh
while [ -n "${LOOP:-}" ]; do sleep "$LOOP"; refresh; done