export const changePct = (latest?: number, prev?: number) => (latest !== undefined && prev ? (latest / prev - 1) * 100 : null);

type RoundLike = { premium_usdg: number | null; notional: number; spot_start: number | null; status: string; strike?: number | null };
// Yield satu round (pecahan, bukan persen) = premium / (notional × basis).
// Basis: Spur = harga awal round (spot_start); Graft = strike, karena collateral put = strike × amount (brief §5.2).
export function roundYield(r: RoundLike, kind: "spur" | "graft" = "spur"): number | null {
  const basis = kind === "graft" ? r.strike : r.spot_start;
  return r.premium_usdg !== null && basis ? Number(r.premium_usdg) / (Number(r.notional) * Number(basis)) : null;
}
// Realized APY sederhana: rata-rata yield mingguan round settled × 52. null jika belum ada datanya.
export function realizedApy(rounds: RoundLike[], kind: "spur" | "graft" = "spur"): number | null {
  const ys = rounds.filter((r) => r.status === "settled").map((r) => roundYield(r, kind)).filter((y): y is number => y !== null);
  return ys.length ? (ys.reduce((a, b) => a + b, 0) / ys.length) * 52 * 100 : null;
}
// Streak = jumlah minggu berurutan (bucket 7 hari epoch) dengan Harvest, dihitung mundur dari yang terbaru.
export function computeStreak(expiries: string[]): number {
  const weeks = [...new Set(expiries.map((e) => Math.floor(new Date(e).getTime() / (7 * 86400000))))].sort((a, b) => b - a);
  let n = weeks.length ? 1 : 0;
  for (let i = 1; i < weeks.length && weeks[i - 1] - weeks[i] === 1; i++) n++;
  return n;
}
export function withWeights<T extends { valueUsd: number }>(items: T[]) {
  const total = items.reduce((a, b) => a + b.valueUsd, 0);
  return items.map((i) => ({ ...i, weightBps: total ? Math.round((i.valueUsd / total) * 10000) : 0 }));
}

type HarvestRow = { expiry: string; round_no: number; premium_usdg: number };
// Harvest terbaru untuk Harvest Card: minggu (bucket 7 hari epoch, sama dengan computeStreak) dari round dengan expiry terbaru,
// premium semua Harvest di minggu itu dijumlah, lalu dibagi nilai total posisi. Realized, bukan proyeksi. null jika tak ada Harvest atau nilai 0.
export function latestHarvest(rows: HarvestRow[], totalValueUsd: number): { round: number; premiumUsdg: number; pct: number } | null {
  if (!rows.length || !(totalValueUsd > 0)) return null;
  const week = (e: string) => Math.floor(new Date(e).getTime() / (7 * 86400000));
  const last = rows.reduce((a, b) => (new Date(b.expiry) > new Date(a.expiry) ? b : a));
  const premiumUsdg = rows.filter((r) => week(r.expiry) === week(last.expiry)).reduce((a, r) => a + Number(r.premium_usdg), 0);
  return { round: last.round_no, premiumUsdg, pct: (premiumUsdg / totalValueUsd) * 100 };
}
