import type { SupabaseClient } from "@supabase/supabase-js";
import { createPublicClient } from "@/lib/supabase/public";
import { changePct, computeStreak, latestHarvest, realizedApy, roundYield, withWeights } from "./derive";
import { buildHome, type RoundIn } from "./home-derive";
import { liveCurrentRound } from "./live-round";

type Cordon = { id: string; address: string; symbol: string; name: string; is_demo: boolean };
type Vault = { id: string; address: string; kind: "spur" | "graft"; underlying: string; symbol: string; is_demo: boolean };
type Nav = { ts: string; nav_per_share: number; tvl_usd: number; total_supply: number };
type Round = { vault_id: string; round_no: number; strike: number; expiry: string; notional: number; premium_usdg: number | null; spot_start: number | null; picker: string | null; settlement_price: number | null; settled_at: string | null; status: string };

async function rows<T>(q: PromiseLike<{ data: unknown; error: { message: string } | null }>): Promise<T[]> {
  const { data, error } = await q;
  if (error) throw new Error(error.message);
  return (data ?? []) as T[];
}
const recentNav = (db: SupabaseClient, id: string, n: number) =>
  rows<Nav>(db.from("nav_points").select("ts,nav_per_share,tvl_usd,total_supply").eq("cordon_id", id).order("ts", { ascending: false }).limit(n));
const cordonBy = async (db: SupabaseClient, col: string, v: string) =>
  (await rows<Cordon>(db.from("cordons").select("id,address,symbol,name,is_demo").eq(col, v).limit(1)))[0] ?? null;
const vaultBy = async (db: SupabaseClient, symbol: string) =>
  (await rows<Vault>(db.from("vaults").select("id,address,kind,underlying,symbol,is_demo").eq("symbol", symbol).limit(1)))[0] ?? null;
const ROUND_COLS = "vault_id,round_no,strike,expiry,notional,premium_usdg,spot_start,picker,settlement_price,settled_at,status";

export async function listCordons() {
  const db = createPublicClient();
  const cordons = await rows<Cordon>(db.from("cordons").select("id,address,symbol,name,is_demo").order("symbol"));
  const assets = await rows<{ cordon_id: string; ticker: string; target_weight_bps: number }>(db.from("cordon_assets").select("cordon_id,ticker,target_weight_bps"));
  return Promise.all(cordons.map(async (c) => {
    const [a, b] = await recentNav(db, c.id, 2);
    const mine = assets.filter((x) => x.cordon_id === c.id);
    // composition: field tambahan (additive) untuk halaman /cordons; urut dari bobot terbesar.
    const composition = mine.map((x) => ({ ticker: x.ticker, weightBps: x.target_weight_bps })).sort((p, q) => q.weightBps - p.weightBps || p.ticker.localeCompare(q.ticker));
    return { symbol: c.symbol, name: c.name, address: c.address, isDemo: c.is_demo, assets: mine.length, composition,
      navPerShare: a ? Number(a.nav_per_share) : null, tvlUsd: a ? Number(a.tvl_usd) : null, change: changePct(a && Number(a.nav_per_share), b && Number(b.nav_per_share)) };
  }));
}
async function loadCordon(symbol: string) {
  const db = createPublicClient();
  const c = await cordonBy(db, "symbol", symbol);
  if (!c) return null;
  const assets = await rows<{ token: string; ticker: string; target_weight_bps: number }>(db.from("cordon_assets").select("token,ticker,target_weight_bps").eq("cordon_id", c.id).order("target_weight_bps", { ascending: false }));
  const [a] = await recentNav(db, c.id, 1);
  return { id: c.id, totalSupply: a ? Number(a.total_supply) : null, view: { symbol: c.symbol, name: c.name, address: c.address, isDemo: c.is_demo,
    navPerShare: a ? Number(a.nav_per_share) : null, tvlUsd: a ? Number(a.tvl_usd) : null,
    assets: assets.map((x) => ({ token: x.token, ticker: x.ticker, weightBps: x.target_weight_bps })) } };
}
export async function getCordon(symbol: string) {
  const r = await loadCordon(symbol);
  return r ? r.view : null; // tanpa id: id internal tidak masuk kontrak API publik (/api/cordons/[symbol])
}
// Untuk Page C: id internal dibutuhkan sebagai filter Supabase Realtime (nav_points.cordon_id).
export async function getCordonPage(symbol: string) {
  const r = await loadCordon(symbol);
  return r ? { ...r.view, id: r.id, totalSupply: r.totalSupply } : null;
}
type Pruning = { ts: string; drift_before_bps: number; drift_after_bps: number; trades: number };
// Riwayat pruning terbaru untuk detail Cordon. `limit` kecil: tabel ini hanya cuplikan.
export async function getPrunings(symbol: string, limit = 12) {
  const db = createPublicClient();
  const c = await cordonBy(db, "symbol", symbol);
  if (!c) return null;
  const rs = await rows<Pruning>(db.from("prunings").select("ts,drift_before_bps,drift_after_bps,trades").eq("cordon_id", c.id).order("ts", { ascending: false }).limit(limit));
  return rs.map((r) => ({ ts: r.ts, driftBeforePct: r.drift_before_bps / 100, driftAfterPct: r.drift_after_bps / 100, trades: r.trades }));
}
export async function getNav(symbol: string, days: number) {
  const db = createPublicClient();
  const c = await cordonBy(db, "symbol", symbol);
  if (!c) return null;
  const since = new Date(Date.now() - days * 86400000).toISOString();
  const pts = await rows<Nav>(db.from("nav_points").select("ts,nav_per_share,tvl_usd").eq("cordon_id", c.id).gte("ts", since).order("ts", { ascending: true }));
  return { symbol: c.symbol, isDemo: c.is_demo, points: pts.map((p) => ({ ts: new Date(p.ts).getTime(), nav: Number(p.nav_per_share) })) };
}
export async function listVaults() {
  const db = createPublicClient();
  const vaults = await rows<Vault>(db.from("vaults").select("id,address,kind,underlying,symbol,is_demo").order("symbol"));
  const rounds = await rows<Round>(db.from("rounds").select(ROUND_COLS).order("round_no", { ascending: false }));
  // Round berjalan dibaca langsung dari kontrak (tanpa menunggu indexer). undefined = tidak diketahui -> pakai database.
  const live = await Promise.all(vaults.map((v) => liveCurrentRound(v)));
  return vaults.map((v, i) => {
    const mine = rounds.filter((r) => r.vault_id === v.id);
    const cur = live[i] === undefined ? mine.find((r) => r.status === "open" || r.status === "auctioned") : live[i];
    return { symbol: v.symbol, kind: v.kind, underlying: v.underlying, address: v.address, isDemo: v.is_demo,
      realizedApy: realizedApy(mine, v.kind), currentRound: cur ? { no: cur.round_no, strike: Number(cur.strike), expiry: cur.expiry, status: cur.status } : null };
  });
}
const roundOut = (r: Round) => ({ no: r.round_no, strike: Number(r.strike), expiry: r.expiry, notional: Number(r.notional),
  premiumUsdg: r.premium_usdg === null ? null : Number(r.premium_usdg), settlementPrice: r.settlement_price === null ? null : Number(r.settlement_price),
  settledAt: r.settled_at, picker: r.picker, status: r.status });
async function roundsOf(db: SupabaseClient, vaultId: string) {
  return rows<Round>(db.from("rounds").select(ROUND_COLS).eq("vault_id", vaultId).order("round_no", { ascending: false }));
}
export async function getRounds(symbol: string) {
  const db = createPublicClient();
  const v = await vaultBy(db, symbol);
  if (!v) return null;
  const rs = await roundsOf(db, v.id);
  return { symbol: v.symbol, isDemo: v.is_demo, rounds: rs.map(roundOut) };
}
// Detail satu vault untuk Page E: jenis, round aktif, riwayat, realized APY, dan premium untuk simulator.
export async function getVault(symbol: string) {
  const db = createPublicClient();
  const v = await vaultBy(db, symbol);
  if (!v) return null;
  const rs = await roundsOf(db, v.id);
  const lv = await liveCurrentRound(v); // round berjalan dari kontrak; undefined = tidak diketahui -> pakai database
  const cur = lv === undefined ? rs.find((r) => r.status === "open" || r.status === "auctioned") : lv;
  // Round yang baru dibuka belum tentu sudah ada di database: tampilkan di riwayat supaya konsisten dengan kartu.
  const shown = lv && !rs.some((r) => r.round_no === lv.round_no) ? [lv, ...rs] : rs;
  const lastSettled = rs.find((r) => r.status === "settled" && roundYield(r, v.kind) !== null);
  const own = cur ? roundYield(cur, v.kind) : null, last = lastSettled ? roundYield(lastSettled, v.kind) : null;
  // Premium mingguan (% dari basis) untuk UpsideSimulator: premium round aktif jika sudah dilelang, kalau belum, round settled terakhir.
  const premiumHint = own !== null ? { pct: own * 100, source: "round" as const } : last !== null ? { pct: last * 100, source: "last" as const } : null;
  return {
    id: v.id, // untuk filter Supabase Realtime (rounds.vault_id); getVault hanya dipakai Page E, bukan API
    symbol: v.symbol, kind: v.kind, underlying: v.underlying, address: v.address, isDemo: v.is_demo,
    realizedApy: realizedApy(rs, v.kind), settledRounds: rs.filter((r) => r.status === "settled").length,
    currentRound: cur ? { ...roundOut(cur), spotStart: cur.spot_start === null ? null : Number(cur.spot_start) } : null,
    premiumHint, rounds: shown.map(roundOut),
  };
}
// `db` = klien milik penonton (cookie sesi) bila ada; RLS (migrasi 0004) hanya mengembalikan posisi dan Harvest
// untuk Wall publik atau milik penonton sendiri. Pemanggil tetap memeriksa akses lebih dulu (lib/auth/server.ts).
export async function getWall(address: string, db: SupabaseClient = createPublicClient()) {
  const positions = await rows<{ contract: string; shares: number; cost_basis_usd: number | null; is_demo: boolean }>(db.from("positions").select("contract,shares,cost_basis_usd,is_demo").eq("account", address));
  const harvests = await rows<{ vault_id: string; round_no: number; premium_usdg: number }>(db.from("harvests").select("vault_id,round_no,premium_usdg").eq("account", address));
  const cordons = await rows<Cordon>(db.from("cordons").select("id,address,symbol,name,is_demo"));
  const vaults = await rows<Vault>(db.from("vaults").select("id,address,kind,underlying,symbol,is_demo"));
  const items = await Promise.all(positions.map(async (p) => {
    const c = cordons.find((x) => x.address === p.contract), v = vaults.find((x) => x.address === p.contract);
    const nav = c ? (await recentNav(db, c.id, 1))[0] : undefined; // Cordon: shares × NAV; vault: cost basis (belum ada harga share)
    const valueUsd = nav ? Number(p.shares) * Number(nav.nav_per_share) : Number(p.cost_basis_usd ?? 0);
    return { id: c?.symbol ?? v?.symbol ?? p.contract, contract: p.contract, shares: Number(p.shares), valueUsd, valueBasis: nav ? "nav" : "cost" };
  }));
  const ids = [...new Set(harvests.map((h) => h.vault_id))];
  const hRounds = ids.length ? (await rows<Round>(db.from("rounds").select(ROUND_COLS).in("vault_id", ids))).flatMap((r) => {
    const h = harvests.find((x) => x.vault_id === r.vault_id && x.round_no === r.round_no);
    return h ? [{ expiry: r.expiry, round_no: r.round_no, premium_usdg: Number(h.premium_usdg) }] : [];
  }) : [];
  const weighted = withWeights(items), total = items.reduce((a, b) => a + b.valueUsd, 0), streak = computeStreak(hRounds.map((r) => r.expiry));
  // lastHarvest: field tambahan (additive) untuk Harvest Card di /wall; null jika belum ada Harvest.
  return { address, isDemo: positions.some((p) => p.is_demo), totalValueUsd: total, positions: weighted, harvests: harvests.length, streak, lastHarvest: latestHarvest(hRounds, total),
    tree: { address, totalValueUsd: total, positions: weighted.map((p) => ({ id: p.id, weightBps: p.weightBps })), harvests: harvests.length, streak } };
}

const roundIn = (r: Round): RoundIn => ({ round_no: r.round_no, strike: Number(r.strike), expiry: r.expiry, notional: Number(r.notional),
  premium_usdg: r.premium_usdg === null ? null : Number(r.premium_usdg), spot_start: r.spot_start === null ? null : Number(r.spot_start),
  picker: r.picker, settlement_price: r.settlement_price === null ? null : Number(r.settlement_price), settled_at: r.settled_at, status: r.status });

// Data untuk halaman Home. Hanya produk NON-demo (is_demo = false): baris demo tidak pernah ikut dihitung, jadi tidak ada angka karangan.
// Round berjalan dibaca dari kontrak lebih dulu (sama dengan listVaults), database sebagai cadangan.
export async function getHomeData(now = new Date()) {
  const db = createPublicClient();
  const [cordons, vaults] = await Promise.all([
    rows<Cordon>(db.from("cordons").select("id,address,symbol,name,is_demo").eq("is_demo", false).order("symbol")),
    rows<Vault>(db.from("vaults").select("id,address,kind,underlying,symbol,is_demo").eq("is_demo", false).order("symbol")),
  ]);
  const cIds = cordons.map((c) => c.id), vIds = vaults.map((v) => v.id);
  const [navs, rounds, prunings, live] = await Promise.all([
    Promise.all(cordons.map((c) => recentNav(db, c.id, 1))),
    vIds.length ? rows<Round>(db.from("rounds").select(ROUND_COLS).in("vault_id", vIds).order("round_no", { ascending: false })) : Promise.resolve([] as Round[]),
    cIds.length ? rows<{ cordon_id: string; ts: string; drift_after_bps: number }>(db.from("prunings").select("cordon_id,ts,drift_after_bps").in("cordon_id", cIds).order("ts", { ascending: false }).limit(3)) : Promise.resolve([]),
    Promise.all(vaults.map((v) => liveCurrentRound(v))),
  ]);
  return buildHome({
    cordons: cordons.map((c, i) => ({ symbol: c.symbol, address: c.address, navPerShare: navs[i][0] ? Number(navs[i][0].nav_per_share) : null, tvlUsd: navs[i][0] ? Number(navs[i][0].tvl_usd) : null })),
    vaults: vaults.map((v, i) => {
      const mine = rounds.filter((r) => r.vault_id === v.id);
      const cur = live[i] === undefined ? mine.find((r) => r.status === "open" || r.status === "auctioned") : live[i];
      return { symbol: v.symbol, kind: v.kind, underlying: v.underlying, address: v.address, rounds: mine.map(roundIn), current: cur ? roundIn(cur as Round) : null };
    }),
    prunings: prunings.flatMap((p) => { const c = cordons.find((x) => x.id === p.cordon_id); return c ? [{ symbol: c.symbol, ts: p.ts, driftAfterBps: p.drift_after_bps }] : []; }),
  }, now);
}
