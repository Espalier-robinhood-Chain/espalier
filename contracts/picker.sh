#!/usr/bin/env bash
# Picker manual untuk SpurVault / GraftVault di testnet (menggantikan layanan RFQ sementara).
# Taruh di contracts/ lalu jalankan dari sana.
#
#   bash picker.sh status <spur|graft>             keadaan round, jendela penjualan, saldo dan izin Picker
#   bash picker.sh fill   <spur|graft> <premi>     tanda tangan quote EIP-712 + fill (premi dalam USDG, mis. 5 atau 12.5)
#   bash picker.sh close  <spur|graft>             closeUnsold (setelah jendela penjualan habis, round tidak laku)
#   bash picker.sh print  <spur|graft> [harga]     setelah expiry: catat print harga (feed mock) lalu SettlementOracle.settle
#   bash picker.sh finish <spur|graft>             settleRound() lalu claimPickerPayout() bila ada
#
# Picker = keystore PICKER_ACCOUNT (default espalier-owner), yang sudah di-whitelist di HarvestAuction oleh deploy.
# Picker memanggil `fill` sendiri, jadi KEEPER_ROLE tidak diperlukan.
set -euo pipefail
cd "$(dirname "$0")"
[ -f .env ] || { echo ".env tidak ada di $(pwd)"; exit 1; }
set -a; source .env; set +a
R="${RH_RPC_TESTNET:?RH_RPC_TESTNET kosong}"
PICKER_ACCOUNT="${PICKER_ACCOUNT:-espalier-owner}"
FEED_ACCOUNT="${FEED_ACCOUNT:-espalier-testnet}"   # siapa saja boleh memanggil setRound pada feed mock

SPUR=0xAc0f403c12C2EfB83C5e6141cDea7984Ec78070A
GRAFT=0x2821622d360Ded342648178db155bF3F1b637695
ROUTER=0x7918Be51162b742DE19d666B88AB5Af134B6Cd0e
ZERO=0x0000000000000000000000000000000000000000
RSIG="rounds(uint64)(uint64,uint64,uint256,uint256,uint256,uint256,address,uint256,uint256,uint256,uint256,uint256,uint8)"

cmd="${1:-}"; which="${2:-}"
case "$which" in spur) V=$SPUR ;; graft) V=$GRAFT ;; *) echo "pakai: bash picker.sh <status|fill|close|print|finish> <spur|graft> [argumen]"; exit 1 ;; esac

c() { cast call "$@" --rpc-url "$R"; }
first() { awk 'NR==1{print $1}'; }
now() { cast block latest --field timestamp --rpc-url "$R"; }

explain() { # terjemahkan selector error kustom ke nama
  local out="$1" e sel
  for e in "BadSignature()" "PickerNotAllowed()" "QuoteExpired()" "WrongAuction()" "AlreadyFilled()" "NotAuthorized()" \
           "NotActive()" "RoundMismatch()" "AlreadySold()" "FillWindowClosed()" "FillWindowOpen()" "PremiumBelowFloor()" \
           "PremiumNotReceived()" "NotAuction()" "NotExpired()" "AlreadySettled()" "RoundBeforeExpiry()" "PrintTooLate()" \
           "NotFirstRoundAfterExpiry()" "PrintWindowOpen()" "SettlementUnavailable()" "InvalidAnswer()" "OraclePaused()" "AssetPaused()"; do
    sel="$(cast sig "$e" 2>/dev/null || true)"
    [ -n "$sel" ] && grep -qi "${sel#0x}" <<<"$out" && echo "  -> penyebab: $e"
  done
}

load_round() {
  ACTIVE=$(c "$V" "active()(bool)")
  RND=$(c "$V" "round()(uint64)" | first)
  mapfile -t RD < <(c "$V" "$RSIG" "$RND" | awk '{print $1}')
  START=${RD[0]}; EXPIRY=${RD[1]}; STRIKE=${RD[2]}; NOTIONAL=${RD[4]}; MINPREM=${RD[5]}; SOLD_TO=${RD[6]}; PREMIUM=${RD[7]}; OUTCOME=${RD[12]}
  AUCTION=$(c "$V" "AUCTION()(address)"); USDG=$(c "$V" "PREMIUM()(address)")
  WINDOW=$(c "$V" "FILL_WINDOW()(uint32)" | first)
  USDG_DEC=$(c "$USDG" "decimals()(uint8)" | first)
}

status() {
  ask_pw "$PICKER_ACCOUNT"
  load_round
  local n; n=$(now)
  local picker; picker=$(cast wallet address --account "$PICKER_ACCOUNT" --password "$PW")
  echo "vault $which $V"
  echo "  active=$ACTIVE round=$RND outcome=$OUTCOME (0 berjalan, 1 settled, 2 ditutup tanpa jual)"
  echo "  strikeE18=$STRIKE notional=$NOTIONAL minPremium=$MINPREM"
  echo "  expiry=$EXPIRY ($(date -u -d "@$EXPIRY" '+%F %T') UTC)"
  if [ "$SOLD_TO" = "$ZERO" ]; then
    local left=$(( START + WINDOW - n ))
    if [ "$left" -gt 0 ]; then echo "  belum terjual; jendela penjualan sisa ${left}s"; else echo "  belum terjual; jendela penjualan SUDAH habis (${left#-}s lalu): pakai 'close'"; fi
  else
    echo "  terjual ke $SOLD_TO premium(raw)=$PREMIUM"
  fi
  echo "picker $picker"
  echo "  isPicker=$(c "$AUCTION" "isPicker(address)(bool)" "$picker")  USDG=$(c "$USDG" "balanceOf(address)(uint256)" "$picker" | first)  izin ke auction=$(c "$USDG" "allowance(address,address)(uint256)" "$picker" "$AUCTION" | first)"
}

ask_pw() { if [ -z "${PW:-}" ]; then read -r -s -p "password keystore $1: " PW; echo; fi; }

fill() {
  local prem_h="${3:?isi premi dalam USDG, mis. 5}"
  ask_pw "$PICKER_ACCOUNT"
  load_round
  [ "$ACTIVE" = "true" ] || { echo "round tidak aktif (belum ada rollRound)"; exit 1; }
  [ "$SOLD_TO" = "$ZERO" ] || { echo "round $RND sudah terjual"; exit 1; }
  local n; n=$(now)
  [ "$n" -le $(( START + WINDOW )) ] || { echo "jendela penjualan sudah habis; jalankan: bash picker.sh close $which"; exit 1; }
  local picker premium deadline chain tmp sig
  picker=$(cast wallet address --account "$PICKER_ACCOUNT" --password "$PW")
  [ "$(c "$AUCTION" "isPicker(address)(bool)" "$picker")" = "true" ] || { echo "$picker belum di-whitelist di HarvestAuction"; exit 1; }
  premium=$(cast parse-units "$prem_h" "$USDG_DEC")
  deadline=$(( n + 900 ))
  chain=$(cast chain-id --rpc-url "$R")

  # 1. izin USDG ke HarvestAuction (sebesar premi saja)
  echo "approve USDG ke auction..."
  cast send "$USDG" "approve(address,uint256)" "$AUCTION" "$premium" --rpc-url "$R" --account "$PICKER_ACCOUNT" --password "$PW" | grep -E "^status"

  # 2. tanda tangan EIP-712 (domain EspalierHarvestAuction v1)
  tmp=$(mktemp); trap 'rm -f "$tmp"' EXIT
  cat > "$tmp" <<JSON
{"types":{"EIP712Domain":[{"name":"name","type":"string"},{"name":"version","type":"string"},{"name":"chainId","type":"uint256"},{"name":"verifyingContract","type":"address"}],
"Quote":[{"name":"vault","type":"address"},{"name":"picker","type":"address"},{"name":"round","type":"uint64"},{"name":"strikeE18","type":"uint256"},{"name":"expiry","type":"uint64"},{"name":"notional","type":"uint256"},{"name":"premium","type":"uint256"},{"name":"deadline","type":"uint64"}]},
"primaryType":"Quote",
"domain":{"name":"EspalierHarvestAuction","version":"1","chainId":$chain,"verifyingContract":"$AUCTION"},
"message":{"vault":"$V","picker":"$picker","round":"$RND","strikeE18":"$STRIKE","expiry":"$EXPIRY","notional":"$NOTIONAL","premium":"$premium","deadline":"$deadline"}}
JSON
  sig=$(cast wallet sign --data --from-file "$tmp" --account "$PICKER_ACCOUNT" --password "$PW")
  echo "quote ditandatangani (round $RND, premi $prem_h USDG, berlaku 15 menit)"

  # 3. simulasi dulu supaya galat terbaca, lalu kirim
  local quote="($V,$picker,$RND,$STRIKE,$EXPIRY,$NOTIONAL,$premium,$deadline)"
  local fsig="fill((address,address,uint64,uint256,uint64,uint256,uint256,uint64),bytes)"
  if ! out=$(cast call --from "$picker" "$AUCTION" "$fsig" "$quote" "$sig" --rpc-url "$R" 2>&1); then
    echo "simulasi fill GAGAL:"; echo "$out" | head -5; explain "$out"; exit 1
  fi
  cast send "$AUCTION" "$fsig" "$quote" "$sig" --rpc-url "$R" --account "$PICKER_ACCOUNT" --password "$PW" | grep -E "^(status|transactionHash)"
  echo "selesai. cek: bash picker.sh status $which"
}

close_unsold() {
  ask_pw "$PICKER_ACCOUNT"
  cast send "$V" "closeUnsold()" --rpc-url "$R" --account "$PICKER_ACCOUNT" --password "$PW" | grep -E "^(status|transactionHash)"
}

# Token yang dipakai router/oracle: ASSET untuk Spur, UNDERLYING untuk Graft.
token_of() { if [ "$which" = graft ]; then c "$V" "UNDERLYING()(address)"; else c "$V" "ASSET()(address)"; fi; }

print_and_settle() {
  local price_arg="${3:-}"
  load_round
  local n; n=$(now)
  [ "$n" -ge "$EXPIRY" ] || { echo "belum expiry (sisa $(( EXPIRY - n ))s)"; exit 1; }
  local token feed oracle maxdelay
  token=$(token_of); feed=$(c "$ROUTER" "feedOf(address)(address,bool)" "$token" | first)
  oracle=$(c "$V" "SETTLEMENT()(address)"); maxdelay=$(c "$oracle" "MAX_PRINT_DELAY()(uint32)" | first)
  echo "token=$token feed=$feed oracle=$oracle maxPrintDelay=${maxdelay}s"

  # round terbaru; bila belum ada print setelah expiry, buat satu (hanya feed mock)
  local latest upd
  latest=$(c "$feed" "latestRoundData()(uint80,int256,uint256,uint256,uint80)" | sed -n 1p | awk '{print $1}')
  upd=$(c "$feed" "getRoundData(uint80)(uint80,int256,uint256,uint256,uint80)" "$latest" | sed -n 4p | awk '{print $1}')
  if [ "$upd" -lt "$EXPIRY" ]; then
    local price; price="${price_arg:-$(c "$feed" "latestRoundData()(uint80,int256,uint256,uint256,uint80)" | sed -n 2p | awk '{print $1}')}"
    echo "belum ada round setelah expiry; mencatat print baru dengan harga $price (feed mock, 8 desimal)"
    ask_pw "$FEED_ACCOUNT"
    cast send "$feed" "setRound(int256)" "$price" --rpc-url "$R" --account "$FEED_ACCOUNT" --password "$PW" | grep -E "^status"
    latest=$(c "$feed" "latestRoundData()(uint80,int256,uint256,uint256,uint80)" | sed -n 1p | awk '{print $1}')
  fi
  # cari round PERTAMA dengan updatedAt >= expiry
  local id="$latest" prev u
  for _ in $(seq 1 400); do
    prev=$(( id - 1 ))
    u=$(c "$feed" "getRoundData(uint80)(uint80,int256,uint256,uint256,uint80)" "$prev" 2>/dev/null | sed -n 4p | awk '{print $1}' || true)
    [ -n "$u" ] && [ "$u" -ge "$EXPIRY" ] || break
    id="$prev"
  done
  u=$(c "$feed" "getRoundData(uint80)(uint80,int256,uint256,uint256,uint80)" "$id" | sed -n 4p | awk '{print $1}')
  echo "round pertama setelah expiry: id=$id updatedAt=$u (selisih $(( u - EXPIRY ))s)"
  [ $(( u - EXPIRY )) -le "$maxdelay" ] || { echo "print terlambat (> ${maxdelay}s). Gunakan settleFallback dengan round terakhir sebelum expiry."; exit 1; }
  ask_pw "$PICKER_ACCOUNT"
  if ! out=$(cast send "$oracle" "settle(address,uint64,uint80)" "$token" "$EXPIRY" "$id" --rpc-url "$R" --account "$PICKER_ACCOUNT" --password "$PW" 2>&1); then
    echo "$out" | head -5; explain "$out"; exit 1
  fi
  echo "$out" | grep -E "^(status|transactionHash)"
  echo "settle tercatat. Lanjut: bash picker.sh finish $which"
}

finish() {
  ask_pw "$PICKER_ACCOUNT"
  echo "settleRound()..."
  if ! out=$(cast send "$V" "settleRound()" --rpc-url "$R" --account "$PICKER_ACCOUNT" --password "$PW" 2>&1); then
    echo "$out" | head -5; explain "$out"; exit 1
  fi
  echo "$out" | grep -E "^(status|transactionHash)"
  echo "claimPickerPayout() (hanya berisi bila harga settle melewati strike)..."
  cast send "$V" "claimPickerPayout()" --rpc-url "$R" --account "$PICKER_ACCOUNT" --password "$PW" 2>&1 | grep -E "^(status|transactionHash)|revert|Error" || true
  echo "Pemegang share mengklaim premi lewat panel vault di web (Claim premium), atau claimPremium() dari wallet mereka."
}

case "$cmd" in
  status) status ;;
  fill)   fill "$@" ;;
  close)  close_unsold ;;
  print)  print_and_settle "$@" ;;
  finish) finish ;;
  *) echo "perintah tidak dikenal: $cmd"; exit 1 ;;
esac