// Perencana pruning (murni, bigint, tanpa jaringan). Pruning = mengembalikan komposisi vault ke bobot target
// (docs: "On a schedule, and only while prices are live, the basket trades back to its target weights.
// Each trade is checked against the oracle price with a slippage limit").
// Semua nilai USD memakai 18 desimal; harga oracle = USD per 1 token utuh, 18 desimal.

export interface Holding { token: string; ticker: string; decimals: number; balance: bigint; priceE18: bigint; targetBps: number }
export interface Trade { tokenIn: string; tokenOut: string; amountIn: bigint; expectedOut: bigint; minOut: bigint; usdE18: bigint }
export interface PlanConfig { slippageBps: number; minTradeUsdE18: bigint; maxTrades: number }

const BPS = 10_000n;
const pow10 = (n: number) => 10n ** BigInt(n);
export const valueE18 = (h: Holding) => (h.balance * h.priceE18) / pow10(h.decimals);

/** Selisih terbesar (bps) antara bobot sebenarnya dan bobot target di antara semua komponen. 0 bila vault kosong. */
export function maxDriftBps(hs: readonly Holding[]): number {
  const vals = hs.map(valueE18);
  const total = vals.reduce((a, b) => a + b, 0n);
  if (total === 0n) return 0;
  let max = 0n;
  hs.forEach((h, i) => {
    const w = (vals[i]! * BPS * 2n + total) / (total * 2n); // dibulatkan ke terdekat
    const d = w > BigInt(h.targetBps) ? w - BigInt(h.targetBps) : BigInt(h.targetBps) - w;
    if (d > max) max = d;
  });
  return Number(max);
}

export function planTrades(hs: readonly Holding[], cfg: PlanConfig): Trade[] {
  if (!Number.isInteger(cfg.slippageBps) || cfg.slippageBps < 0 || cfg.slippageBps > 10_000) throw new RangeError("slippageBps 0..10000");
  const sumT = hs.reduce((a, h) => a + h.targetBps, 0);
  if (sumT !== 10_000) throw new Error(`bobot target berjumlah ${sumT}, harus 10000`);
  if (hs.some((h) => h.priceE18 <= 0n)) throw new Error("harga komponen tidak valid");
  const vals = hs.map(valueE18);
  const total = vals.reduce((a, b) => a + b, 0n);
  if (total === 0n) return [];

  const sells: { i: number; usd: bigint }[] = [];
  const buys: { i: number; usd: bigint }[] = [];
  hs.forEach((h, i) => {
    const delta = vals[i]! - (total * BigInt(h.targetBps)) / BPS;
    if (delta > 0n) sells.push({ i, usd: delta }); else if (delta < 0n) buys.push({ i, usd: -delta });
  });
  sells.sort((a, b) => (b.usd > a.usd ? 1 : b.usd < a.usd ? -1 : a.i - b.i));
  buys.sort((a, b) => (b.usd > a.usd ? 1 : b.usd < a.usd ? -1 : a.i - b.i));

  const trades: Trade[] = [];
  let s = 0, b = 0;
  while (s < sells.length && b < buys.length) {
    const sell = sells[s]!, buy = buys[b]!;
    const usd = sell.usd < buy.usd ? sell.usd : buy.usd;
    sell.usd -= usd; buy.usd -= usd;
    if (sell.usd === 0n) s++;
    if (buy.usd === 0n) b++;
    if (usd < cfg.minTradeUsdE18) continue; // debu: biaya dan slippage lebih besar dari manfaatnya
    const hin = hs[sell.i]!, hout = hs[buy.i]!;
    let amountIn = (usd * pow10(hin.decimals)) / hin.priceE18;
    if (amountIn > hin.balance) amountIn = hin.balance; // pembulatan tidak boleh menjual lebih dari yang dimiliki
    if (amountIn === 0n) continue;
    const expectedOut = (usd * pow10(hout.decimals)) / hout.priceE18;
    trades.push({ tokenIn: hin.token, tokenOut: hout.token, amountIn, expectedOut, minOut: (expectedOut * (BPS - BigInt(cfg.slippageBps))) / BPS, usdE18: usd });
  }
  return trades.slice(0, cfg.maxTrades);
}

export interface DecideInput { now: Date; lastPruningAt: Date | null; pricesLive: boolean; driftBps: number; thresholdBps: number; minIntervalDays: number }
export type Decision = { action: "prune" } | { action: "skip"; reason: string };

/** Kapan keeper boleh bertindak: harga live, sudah lewat interval bulanan, dan drift melewati ambang. */
export function decide(i: DecideInput): Decision {
  if (!i.pricesLive) return { action: "skip", reason: "market closed or a price is not live" };
  if (i.lastPruningAt) {
    const days = (i.now.getTime() - i.lastPruningAt.getTime()) / 86_400_000;
    if (days < i.minIntervalDays) return { action: "skip", reason: `last pruning ${days.toFixed(1)} days ago (< ${i.minIntervalDays})` };
  }
  if (i.driftBps < i.thresholdBps) return { action: "skip", reason: `drift ${i.driftBps} bps below threshold ${i.thresholdBps}` };
  return { action: "prune" };
}
