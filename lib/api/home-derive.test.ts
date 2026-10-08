import test from "node:test";
import assert from "node:assert/strict";
import { buildHome, roundValueUsd, type RoundIn, type VaultIn } from "./home-derive.ts";

const NOW = new Date("2026-10-08T00:00:00Z");
const W = 7 * 86400000;
const round = (o: Partial<RoundIn>): RoundIn => ({ round_no: 1, strike: 138, expiry: "2026-10-09T20:00:00Z", notional: 10, premium_usdg: null, spot_start: 125, picker: null, settlement_price: null, settled_at: null, status: "open", ...o });
const settled = (no: number, weeksAgo: number, o: Partial<RoundIn> = {}) => {
  const e = new Date(NOW.getTime() - weeksAgo * W).toISOString();
  return round({ round_no: no, status: "settled", expiry: e, settled_at: e, premium_usdg: 12.5, settlement_price: 130, ...o });
};
const spur = (o: Partial<VaultIn> = {}): VaultIn => ({ symbol: "sNVDA", kind: "spur", underlying: "NVDA", address: "0x" + "2".repeat(40), rounds: [], current: null, ...o });
const none = { cordons: [], vaults: [], prunings: [] };

test("tanpa data: semua nol/kosong, bukan angka karangan", () => {
  const h = buildHome(none, NOW);
  assert.deepEqual(h.stats, { valueUsd: 0, products: 0, harvests: 0, premiumUsdg: 0 });
  assert.equal(h.feed.length, 0); assert.equal(h.nextRound, null); assert.equal(h.sim, null);
  assert.equal(h.garden.positions.length, 0);
});

test("nilai round: Spur pakai harga awal, Graft pakai strike, null jika belum ada basis", () => {
  assert.equal(roundValueUsd(round({}), "spur"), 1250);
  assert.equal(roundValueUsd(round({}), "graft"), 1380);
  assert.equal(roundValueUsd(round({ spot_start: null }), "spur"), 0);
  assert.equal(roundValueUsd(null, "spur"), 0);
});

test("statistik dan pohon dari Cordon + round berjalan; bobot dijumlah 100%", () => {
  const h = buildHome({
    cordons: [{ symbol: "cMAG7", address: "0x" + "1".repeat(40), navPerShare: 101, tvlUsd: 3750 }],
    vaults: [spur({ current: round({}), rounds: [settled(1, 1), settled(2, 2)] })], prunings: [],
  }, NOW);
  assert.equal(h.stats.valueUsd, 5000);
  assert.equal(h.stats.products, 2);
  assert.equal(h.stats.harvests, 2);
  assert.equal(h.stats.premiumUsdg, 25);
  assert.deepEqual(h.garden.positions, [{ id: "cMAG7", weightBps: 7500 }, { id: "sNVDA", weightBps: 2500 }]);
  assert.equal(h.garden.streak, 2);
  assert.equal(h.garden.harvests, 2);
});

test("produk tanpa nilai tidak jadi cabang pohon", () => {
  const h = buildHome({ cordons: [{ symbol: "cMAG7", address: "0x1", navPerShare: null, tvlUsd: null }], vaults: [spur()], prunings: [] }, NOW);
  assert.equal(h.garden.positions.length, 0);
  assert.equal(h.stats.products, 2);
});

test("hitung mundur memakai expiry terdekat yang belum lewat", () => {
  const past = round({ round_no: 3, expiry: "2026-10-07T00:00:00Z" });
  const a = spur({ symbol: "sNVDA", current: round({ round_no: 5, expiry: "2026-10-16T20:00:00Z" }) });
  const b = spur({ symbol: "sTSLA", underlying: "TSLA", current: round({ round_no: 2, expiry: "2026-10-09T20:00:00Z" }) });
  assert.deepEqual(buildHome({ ...none, vaults: [a, b] }, NOW).nextRound, { symbol: "sTSLA", no: 2, expiry: "2026-10-09T20:00:00Z" });
  assert.equal(buildHome({ ...none, vaults: [spur({ current: past })] }, NOW).nextRound, null);
});

test("simulator: premium dari round ini, lalu dari round settled terakhir, lalu hanya batas", () => {
  const own = buildHome({ ...none, vaults: [spur({ current: round({ premium_usdg: 11.25, status: "auctioned", picker: "0xabc" }) })] }, NOW).sim;
  assert.equal(own?.source, "round"); assert.equal(own?.premiumPct.toFixed(2), "0.90"); assert.equal(own?.spot, 125); assert.equal(own?.strike, 138);
  const last = buildHome({ ...none, vaults: [spur({ current: round({}), rounds: [settled(1, 1, { premium_usdg: 12.5, spot_start: 125 })] })] }, NOW).sim;
  assert.equal(last?.source, "last"); assert.equal(last?.premiumPct, 1);
  const cap = buildHome({ ...none, vaults: [spur({ current: round({}) })] }, NOW).sim;
  assert.equal(cap?.source, null); assert.equal(cap?.premiumPct, 0);
  assert.equal(buildHome({ ...none, vaults: [spur({ kind: "graft", current: round({}) })] }, NOW).sim, null); // Graft tidak punya batas upside
  assert.equal(buildHome({ ...none, vaults: [spur()] }, NOW).sim, null); // tanpa round berjalan
});

test("feed: round berjalan dulu, lalu settled/pruning terbaru; maksimal 8; tanpa kata \"demo\"", () => {
  const v = spur({ current: round({ round_no: 9, status: "auctioned", picker: "0x9d1f000000000000000000000000000000007a2" }), rounds: [settled(8, 1), settled(7, 2), settled(6, 3), settled(5, 4)] });
  const h = buildHome({ ...none, vaults: [v], prunings: [{ symbol: "cMAG7", ts: new Date(NOW.getTime() - 3600_000).toISOString(), driftAfterBps: 42 }] }, NOW);
  assert.equal(h.feed[0].a, "sNVDA #9"); assert.equal(h.feed[0].b, "filled by Picker");
  assert.equal(h.feed[1].a, "cMAG7"); assert.equal(h.feed[1].c, "0.4% of target");
  assert.equal(h.feed.length, 5); // 1 berjalan + 3 settled terbaru + 1 pruning
  assert.doesNotMatch(JSON.stringify(h.feed), /demo/i);
  const many = buildHome({ ...none, vaults: [v, { ...v, symbol: "sTSLA" }, { ...v, symbol: "sAMD" }] }, NOW);
  assert.equal(many.feed.length, 8);
});

test("APY realized per vault dan strike round berjalan", () => {
  const h = buildHome({ ...none, vaults: [spur({ current: round({ strike: 140 }), rounds: [settled(1, 1, { premium_usdg: 12.5 })] })] }, NOW);
  assert.equal(h.vaults[0].strike, 140);
  assert.equal(h.vaults[0].apy, 52); // 12.5 / (10 × 125) = 1%/minggu
  assert.equal(h.vaults[0].round?.no, 1);
});
