import test from "node:test";
import assert from "node:assert/strict";
import { decide, maxDriftBps, planTrades, valueE18, type Holding } from "../src/plan.ts";
import { runOnce, type Executor, type KeeperChain, type KeeperStore } from "../src/run.ts";
import { loadConfig } from "../src/config.ts";

const E18 = 10n ** 18n;
const h = (ticker: string, balance: bigint, price: number, targetBps: number, decimals = 18): Holding =>
  ({ token: `0x${ticker.padEnd(40, "0")}`, ticker, decimals, balance, priceE18: BigInt(price) * E18, targetBps });
const CFG = { slippageBps: 50, minTradeUsdE18: 10n * E18, maxTrades: 16, thresholdBps: 100, minIntervalDays: 30 };

test("maxDriftBps: 0 saat seimbang, selisih terbesar saat melenceng, 0 saat kosong", () => {
  assert.equal(maxDriftBps([h("A", 50n * E18, 10, 5000), h("B", 5n * E18, 100, 5000)]), 0); // 500 vs 500
  assert.equal(maxDriftBps([h("A", 70n * E18, 10, 5000), h("B", 3n * E18, 100, 5000)]), 2000); // 700 vs 300 -> 70% vs 30%
  assert.equal(maxDriftBps([h("A", 0n, 10, 5000), h("B", 0n, 100, 5000)]), 0);
});

test("planTrades: seimbang = tanpa trade; melenceng = jual yang berlebih, beli yang kurang, nilai terjaga", () => {
  assert.deepEqual(planTrades([h("A", 50n * E18, 10, 5000), h("B", 5n * E18, 100, 5000)], CFG), []);
  const hs = [h("A", 70n * E18, 10, 5000), h("B", 3n * E18, 100, 5000)]; // A $700, B $300
  const t = planTrades(hs, CFG);
  assert.equal(t.length, 1);
  assert.equal(t[0]!.tokenIn, hs[0]!.token);
  assert.equal(t[0]!.tokenOut, hs[1]!.token);
  assert.equal(t[0]!.usdE18, 200n * E18);
  assert.equal(t[0]!.amountIn, 20n * E18); // $200 / $10
  assert.equal(t[0]!.expectedOut, 2n * E18); // $200 / $100
  assert.equal(t[0]!.minOut, (2n * E18 * 9950n) / 10000n); // slippage 0,5%
});

test("planTrades: tiga aset, semua nilai terjual = nilai terbeli, tidak menjual melebihi saldo", () => {
  const hs = [h("A", 60n * E18, 10, 3000), h("B", 2n * E18, 100, 3000), h("C", 4n * E18, 50, 4000)]; // 600/200/200 dari 1000
  const t = planTrades(hs, CFG);
  const byTok = new Map(hs.map((x) => [x.token, x]));
  assert.equal(t.reduce((a, x) => a + x.usdE18, 0n), 300n * E18); // A jual 300, B beli 100, C beli 200
  for (const x of t) assert.ok(x.amountIn <= byTok.get(x.tokenIn)!.balance);
  const sold = new Set(t.map((x) => x.tokenIn));
  assert.deepEqual([...sold], [hs[0]!.token]);
});

test("planTrades: debu dilewati, desimal token berbeda, batas jumlah trade, input salah ditolak", () => {
  assert.deepEqual(planTrades([h("A", 5_100_000n, 1, 5000, 6), h("B", 4_900_000n, 1, 5000, 6)], { ...CFG, minTradeUsdE18: 10n * E18 }), []); // selisih $0,1 < $10
  const t = planTrades([h("A", 80_000_000n, 1, 5000, 6), h("B", 20n * E18, 1, 5000, 18)], CFG); // $80 vs $20
  assert.equal(t[0]!.amountIn, 30_000_000n); // 6 desimal
  assert.equal(t[0]!.expectedOut, 30n * E18); // 18 desimal
  assert.equal(planTrades([h("A", 90n * E18, 1, 2500), h("B", 5n * E18, 1, 2500), h("C", 3n * E18, 1, 2500), h("D", 2n * E18, 1, 2500)], { ...CFG, maxTrades: 1 }).length, 1);
  assert.throws(() => planTrades([h("A", E18, 1, 5000), h("B", E18, 1, 4000)], CFG), /10000/);
  assert.throws(() => planTrades([{ ...h("A", E18, 1, 5000), priceE18: 0n }, h("B", E18, 1, 5000)], CFG), /harga/);
  assert.throws(() => planTrades([h("A", E18, 1, 10000)], { ...CFG, slippageBps: 10_001 }), RangeError);
  assert.equal(valueE18(h("A", 3n * E18, 7, 10000)), 21n * E18);
});

test("decide: pasar tutup, interval bulanan, ambang drift", () => {
  const now = new Date("2026-10-15T15:00:00Z");
  const base = { now, lastPruningAt: null, pricesLive: true, driftBps: 500, thresholdBps: 100, minIntervalDays: 30 };
  assert.deepEqual(decide(base), { action: "prune" });
  assert.equal(decide({ ...base, pricesLive: false }).action, "skip");
  assert.match((decide({ ...base, lastPruningAt: new Date("2026-10-01T00:00:00Z") }) as { reason: string }).reason, /days ago/);
  assert.equal(decide({ ...base, lastPruningAt: new Date("2026-09-01T00:00:00Z") }).action, "prune");
  assert.match((decide({ ...base, driftBps: 99 }) as { reason: string }).reason, /below threshold/);
});

function world(opts: { live?: boolean; afterLive?: boolean; last?: Date | null; mode?: "dry-run" | "live"; execFail?: boolean }) {
  const before = [h("A", 70n * E18, 10, 5000), h("B", 3n * E18, 100, 5000)];
  const after = [h("A", 50n * E18, 10, 5000), h("B", 5n * E18, 100, 5000)];
  let snaps = 0;
  const chain: KeeperChain = { snapshot: async () => (snaps++ === 0 ? { holdings: before, pricesLive: opts.live ?? true } : { holdings: after, pricesLive: opts.afterLive ?? true }) };
  const exec: Executor = { mode: opts.mode ?? "live", execute: async () => { if (opts.execFail) throw new Error("revert: SlippageExceeded"); return { txHash: "0x" + "ab".repeat(32), at: new Date("2026-10-15T15:01:00Z") }; } };
  const log = { runs: [] as unknown[], finished: [] as unknown[], prunings: [] as unknown[], started: 0 };
  const store: KeeperStore = {
    lastPruningAt: async () => opts.last ?? null,
    startRun: async () => { log.started++; return 7; },
    finishRun: async (id, r) => { log.finished.push({ id, ...r }); },
    recordPruning: async (p) => { log.prunings.push(p); },
  };
  return { chain, exec, store, log };
}
const NOW = new Date("2026-10-15T15:00:00Z");

test("runOnce: pasar tutup / belum waktunya = lewati tanpa menyentuh database", async () => {
  const w = world({ live: false });
  assert.equal((await runOnce(w.chain, w.exec, w.store, CFG, NOW)).kind, "skipped");
  const w2 = world({ last: new Date("2026-10-10T00:00:00Z") });
  assert.equal((await runOnce(w2.chain, w2.exec, w2.store, CFG, NOW)).kind, "skipped");
  assert.equal(w.log.started + w2.log.started, 0);
});

test("runOnce dry-run: mengembalikan rencana, TIDAK menulis prunings maupun keeper_runs", async () => {
  const w = world({ mode: "dry-run" });
  const o = await runOnce(w.chain, w.exec, w.store, CFG, NOW);
  assert.equal(o.kind, "dry-run");
  assert.equal(w.log.started, 0);
  assert.deepEqual(w.log.prunings, []);
});

test("runOnce live: menulis prunings dengan drift sesudah yang dibaca ulang dari chain, run ok", async () => {
  const w = world({});
  const o = await runOnce(w.chain, w.exec, w.store, CFG, NOW);
  assert.deepEqual(o, { kind: "pruned", txHash: "0x" + "ab".repeat(32), before: 2000, after: 0, trades: 1 });
  assert.deepEqual(w.log.prunings, [{ ts: "2026-10-15T15:01:00.000Z", driftBeforeBps: 2000, driftAfterBps: 0, trades: 1, txHash: "0x" + "ab".repeat(32) }]);
  assert.deepEqual(w.log.finished, [{ id: 7, status: "ok", txHash: "0x" + "ab".repeat(32) }]);
});

test("runOnce live: transaksi gagal -> run failed, tidak ada baris prunings", async () => {
  const w = world({ execFail: true });
  const o = await runOnce(w.chain, w.exec, w.store, CFG, NOW);
  assert.equal(o.kind, "failed");
  assert.deepEqual(w.log.prunings, []);
  assert.equal((w.log.finished[0] as { status: string }).status, "failed");
});

test("runOnce live: harga tidak live sesudah transaksi -> tidak mengarang drift, gagal dengan hash", async () => {
  const w = world({ afterLive: false });
  const o = await runOnce(w.chain, w.exec, w.store, CFG, NOW);
  assert.equal(o.kind, "failed");
  assert.deepEqual(w.log.prunings, []);
  assert.equal((w.log.finished[0] as { txHash: string }).txHash, "0x" + "ab".repeat(32));
});

const ENV = { KEEPER_RPC_URL: "http://x", CORDON_VAULT_ADDRESS: "0x" + "aa".repeat(20), SUPABASE_URL: "https://p.supabase.co", SUPABASE_SERVICE_ROLE_KEY: "k" };
test("loadConfig: default, wajib, dan mode live ditolak", () => {
  const c = loadConfig(ENV);
  assert.equal(c.mode, "dry-run"); assert.equal(c.thresholdBps, 100); assert.equal(c.minIntervalDays, 30);
  assert.throws(() => loadConfig({ ...ENV, KEEPER_MODE: "live" }), /belum didukung/);
  assert.throws(() => loadConfig({ ...ENV, KEEPER_RPC_URL: "" }), /KEEPER_RPC_URL/);
  assert.throws(() => loadConfig({ ...ENV, SLIPPAGE_BPS: "10001" }), /SLIPPAGE_BPS/);
  assert.throws(() => loadConfig({ ...ENV, MAX_TRADES: "0" }), /MAX_TRADES/);
});
