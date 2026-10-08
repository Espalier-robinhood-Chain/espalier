// Ringkasan data nyata untuk halaman Home. Murni (tanpa Supabase/viem) supaya bisa dites dengan `node --test`.
// Hanya baris non-demo yang boleh masuk ke sini: pemanggil (queries.ts getHomeData) sudah menyaring is_demo.
import { shortAddr, usd } from "../format.ts";
import { computeStreak, realizedApy, roundYield } from "./derive.ts";

export type RoundIn = {
  round_no: number; strike: number; expiry: string; notional: number; premium_usdg: number | null; spot_start: number | null;
  picker: string | null; settlement_price: number | null; settled_at: string | null; status: string;
};
export type CordonIn = { symbol: string; address: string; navPerShare: number | null; tvlUsd: number | null };
export type VaultIn = { symbol: string; kind: "spur" | "graft"; underlying: string; address: string; rounds: RoundIn[]; current: RoundIn | null };
export type PruningIn = { symbol: string; ts: string; driftAfterBps: number };

export type FeedItem = { a: string; b: string; c: string };
export type HomeData = {
  stats: { valueUsd: number; products: number; harvests: number; premiumUsdg: number };
  feed: FeedItem[];
  garden: { address: string; totalValueUsd: number; harvests: number; streak: number; positions: { id: string; weightBps: number }[] };
  cordons: { symbol: string; navPerShare: number | null; tvlUsd: number | null }[];
  vaults: { symbol: string; kind: "spur" | "graft"; apy: number | null; strike: number | null; round: { no: number; status: string; expiry: string } | null }[];
  nextRound: { symbol: string; no: number; expiry: string } | null;
  sim: { symbol: string; spot: number; strike: number; premiumPct: number; source: "round" | "last" | null } | null;
};

export const FEED_MAX = 8;

// Nilai yang sedang ditanam di round berjalan: notional × harga acuan (Spur = harga awal round, Graft = strike; sama dengan roundYield).
export function roundValueUsd(r: RoundIn | null, kind: "spur" | "graft"): number {
  if (!r) return 0;
  const basis = kind === "graft" ? r.strike : r.spot_start;
  return basis ? Number(r.notional) * Number(basis) : 0;
}

export function buildHome(input: { cordons: CordonIn[]; vaults: VaultIn[]; prunings: PruningIn[] }, now: Date): HomeData {
  const { cordons, vaults, prunings } = input;
  const nowMs = now.getTime();

  // Posisi pohon = produk yang punya nilai. Cordon: total value (NAV terbaru); vault: nilai round berjalan.
  const values = [
    ...cordons.map((c) => ({ id: c.symbol, usd: c.tvlUsd ?? 0 })),
    ...vaults.map((v) => ({ id: v.symbol, usd: roundValueUsd(v.current, v.kind) })),
  ].filter((x) => x.usd > 0);
  const valueUsd = values.reduce((a, b) => a + b.usd, 0);
  const positions = values.map((x) => ({ id: x.id, weightBps: Math.round((x.usd / valueUsd) * 10000) }));

  const settled = vaults.flatMap((v) => v.rounds.filter((r) => r.status === "settled"));
  const premiumUsdg = settled.reduce((a, r) => a + Number(r.premium_usdg ?? 0), 0);

  // Jam di vault yang round-nya masih berjalan, urut paling dekat expiry. Round yang expiry-nya lewat tidak dihitung.
  const upcoming = vaults.flatMap((v) => (v.current && new Date(v.current.expiry).getTime() > nowMs ? [{ symbol: v.symbol, no: v.current.round_no, expiry: v.current.expiry }] : []))
    .sort((a, b) => new Date(a.expiry).getTime() - new Date(b.expiry).getTime());

  // Feed: hanya kejadian yang tercatat di data. Round berjalan dianggap "sekarang"; round settled memakai settled_at.
  const events: (FeedItem & { ts: number })[] = [];
  for (const v of vaults) {
    const label = (r: RoundIn) => `${v.symbol} #${r.round_no}`;
    if (v.current) {
      const r = v.current;
      events.push(r.status === "auctioned" && r.picker
        ? { a: label(r), b: "filled by Picker", c: shortAddr(r.picker), ts: nowMs }
        : { a: label(r), b: "opened at strike", c: usd(r.strike), ts: nowMs });
    }
    for (const r of v.rounds.filter((x) => x.status === "settled").slice(0, 3)) {
      events.push({ a: label(r), b: r.settlement_price ? "settled at" : "settled", c: r.settlement_price ? usd(Number(r.settlement_price)) : "", ts: new Date(r.settled_at ?? r.expiry).getTime() });
    }
  }
  for (const p of prunings) events.push({ a: p.symbol, b: "pruned back to within", c: `${(p.driftAfterBps / 100).toFixed(1)}% of target`, ts: new Date(p.ts).getTime() });
  const feed = events.sort((x, y) => y.ts - x.ts).slice(0, FEED_MAX).map(({ a, b, c }) => ({ a, b, c }));

  // Simulator: Spur pertama yang punya round berjalan dengan harga awal. Premium: round ini bila sudah dilelang, kalau belum round settled terakhir.
  let sim: HomeData["sim"] = null;
  for (const v of vaults) {
    const cur = v.current;
    if (v.kind !== "spur" || !cur || !cur.spot_start || !(cur.strike > 0)) continue;
    const own = roundYield(cur, "spur");
    const lastSettled = v.rounds.find((r) => r.status === "settled" && roundYield(r, "spur") !== null);
    const last = lastSettled ? roundYield(lastSettled, "spur") : null;
    sim = { symbol: v.underlying, spot: Number(cur.spot_start), strike: Number(cur.strike),
      premiumPct: own !== null ? own * 100 : last !== null ? last * 100 : 0, source: own !== null ? "round" : last !== null ? "last" : null };
    break;
  }

  return {
    stats: { valueUsd, products: cordons.length + vaults.length, harvests: settled.length, premiumUsdg },
    feed,
    garden: {
      address: cordons[0]?.address ?? vaults[0]?.address ?? "espalier",
      totalValueUsd: valueUsd, harvests: settled.length, streak: computeStreak(settled.map((r) => r.expiry)), positions,
    },
    cordons: cordons.map((c) => ({ symbol: c.symbol, navPerShare: c.navPerShare, tvlUsd: c.tvlUsd })),
    vaults: vaults.map((v) => ({ symbol: v.symbol, kind: v.kind, apy: realizedApy(v.rounds, v.kind),
      strike: v.current ? Number(v.current.strike) : null, round: v.current ? { no: v.current.round_no, status: v.current.status, expiry: v.current.expiry } : null })),
    nextRound: upcoming[0] ?? null,
    sim,
  };
}
