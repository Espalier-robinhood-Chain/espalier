import test from "node:test";
import assert from "node:assert/strict";
import { chunkRanges, toDecimal } from "../src/decimal.ts";
import { loadConfig } from "../src/config.ts";
import { bootstrap, snapshotNav, syncOnce } from "../src/sync.ts";
import type { Chain, NavReading, NavRow, PositionRow, Store, TransferLog, VaultMeta } from "../src/sync.ts";

const V = "0x" + "aa".repeat(20);
const A = "0x" + "a1".repeat(20), B = "0x" + "b2".repeat(20), Z = "0x" + "00".repeat(20);
const META: VaultMeta = { address: V.toUpperCase().replace("0X", "0x"), symbol: "cMAG7", name: "Espalier Cordon MAG7", decimals: 18, components: [{ token: "0x" + "C1".repeat(20), ticker: "NVDA", weightBps: 6000 }, { token: "0x" + "D2".repeat(20), ticker: "AAPL", weightBps: 4000 }] };
const CFG = { startBlock: 100n, confirmations: 5n, logChunk: 10n, balanceBatch: 2 };
const E18 = 10n ** 18n;

function fakeChain(o: { head: bigint; logs?: TransferLog[]; bal?: Record<string, bigint>; nav?: Partial<NavReading> }) {
  const calls = { transfers: [] as Array<[bigint, bigint]>, balanceAt: [] as bigint[], navAt: [] as bigint[] };
  const chain: Chain = {
    head: async () => o.head,
    blockTimestamp: async (b) => new Date(Date.UTC(2026, 9, 4, 0, 0, Number(b))),
    meta: async () => META,
    transfers: async (a, b) => { calls.transfers.push([a, b]); return (o.logs ?? []).filter((l) => l.block >= a && l.block <= b); },
    balances: async (accs, block) => { calls.balanceAt.push(block); return new Map(accs.filter((a) => o.bal && a in o.bal).map((a) => [a, o.bal![a]!])); },
    nav: async (b) => { calls.navAt.push(b); return { ok: true, totalValueE18: 2000n * E18, navPerShareE18: 2n * E18, totalSupply: 1000n * E18, ...o.nav }; },
  };
  return { chain, calls };
}
function fakeStore(failCursor = false) {
  const s = { cursor: null as bigint | null, positions: new Map<string, string>(), nav: [] as NavRow[], cordon: null as unknown, assets: [] as unknown[], deleted: [] as string[] };
  const store: Store = {
    getCursor: async () => s.cursor,
    setCursor: async (n) => { if (failCursor) throw new Error("db down"); s.cursor = n; },
    upsertCordon: async (v) => { s.cordon = v; return "cordon-1"; },
    replaceAssets: async (_id, rows) => { s.assets = rows; },
    upsertPositions: async (rows: PositionRow[]) => { for (const r of rows) s.positions.set(r.account, r.shares); },
    deletePositions: async (_c, accs) => { for (const a of accs) { s.positions.delete(a); s.deleted.push(a); } },
    upsertNav: async (r) => { s.nav.push(r); },
  };
  return { store, s };
}
const boot = { meta: META, cordonId: "cordon-1" };
const logs: TransferLog[] = [
  { from: Z, to: A, block: 105n }, // mint
  { from: A, to: B, block: 112n },
  { from: B, to: Z, block: 130n }, // burn
  { from: Z, to: A, block: 131n }, // mint lagi
];

test("bootstrap: alamat huruf kecil, komposisi tersimpan", async () => {
  const { store, s } = fakeStore();
  const r = await bootstrap(fakeChain({ head: 0n }).chain, store);
  assert.equal(r.cordonId, "cordon-1");
  assert.equal((s.cordon as { address: string }).address, V);
  assert.deepEqual(s.assets, [{ token: "0x" + "c1".repeat(20), ticker: "NVDA", target_weight_bps: 6000 }, { token: "0x" + "d2".repeat(20), ticker: "AAPL", target_weight_bps: 4000 }]);
});

test("syncOnce: posisi dari saldo absolut di blok aman, saldo nol dihapus, NAV ditulis, kursor maju", async () => {
  const { chain, calls } = fakeChain({ head: 140n, logs, bal: { [A]: 7n * E18 + 5n * 10n ** 17n, [B]: 0n } });
  const { store, s } = fakeStore();
  const r = await syncOnce(chain, store, CFG, boot);
  assert.deepEqual(r, { from: 100n, to: 135n, touched: 2, navWritten: true });
  assert.equal(s.positions.get(A), "7.5");
  assert.equal(s.positions.has(B), false);
  assert.deepEqual(s.deleted, [B]);
  assert.equal(s.cursor, 136n);
  assert.deepEqual(calls.balanceAt, [135n]); // tanpa node arsip: hanya blok aman terbaru
  assert.deepEqual(calls.navAt, [135n]);
  assert.deepEqual(s.nav, [{ cordon_id: "cordon-1", ts: new Date(Date.UTC(2026, 9, 4, 0, 0, 135)).toISOString(), nav_per_share: "2", total_supply: "1000", tvl_usd: "2000" }]);
});

test("syncOnce: rentang dipecah per logChunk dan alamat nol tidak dihitung sebagai akun", async () => {
  const { chain, calls } = fakeChain({ head: 140n, logs, bal: { [A]: E18, [B]: E18 } });
  const { store } = fakeStore();
  await syncOnce(chain, store, CFG, boot);
  assert.deepEqual(calls.transfers, [[100n, 109n], [110n, 119n], [120n, 129n], [130n, 135n]]);
  assert.deepEqual(chunkRanges(5n, 5n, 10n), [[5n, 5n]]);
  assert.deepEqual(chunkRanges(6n, 5n, 10n), []);
});

test("syncOnce: belum ada blok aman baru = tidak melakukan apa-apa; ulang aman", async () => {
  const { chain } = fakeChain({ head: 140n, logs, bal: { [A]: E18, [B]: E18 } });
  const { store, s } = fakeStore();
  await syncOnce(chain, store, CFG, boot);
  assert.equal(await syncOnce(chain, store, CFG, boot), null); // kursor 136 > safe 135
  assert.equal(s.nav.length, 1);
  assert.equal(await syncOnce(fakeChain({ head: 103n }).chain, fakeStore().store, CFG, boot), null); // head - conf < startBlock
});

test("syncOnce: crash sebelum kursor maju -> diproses ulang dan hasilnya sama (tanpa penggandaan)", async () => {
  const world = { head: 140n, logs, bal: { [A]: 3n * E18, [B]: 0n } };
  const f = fakeStore(true);
  await assert.rejects(syncOnce(fakeChain(world).chain, f.store, CFG, boot), /db down/);
  assert.equal(f.s.cursor, null);
  assert.equal(f.s.positions.get(A), "3");
  const g = fakeStore();
  g.s.positions = f.s.positions; // data setengah jadi dari percobaan pertama
  await syncOnce(fakeChain(world).chain, g.store, CFG, boot);
  assert.equal(g.s.positions.get(A), "3");
  assert.equal(g.s.positions.size, 1);
});

test("syncOnce: harga tidak valid -> NAV dilewati tetapi posisi dan kursor tetap maju", async () => {
  const { chain } = fakeChain({ head: 140n, logs, bal: { [A]: E18, [B]: E18 }, nav: { ok: false } });
  const { store, s } = fakeStore();
  const r = await syncOnce(chain, store, CFG, boot);
  assert.equal(r?.navWritten, false);
  assert.equal(s.nav.length, 0);
  assert.equal(s.cursor, 136n);
});

test("syncOnce: saldo yang tidak dikembalikan = galat, kursor tidak maju", async () => {
  const { chain } = fakeChain({ head: 140n, logs, bal: { [A]: E18 } }); // B hilang
  const { store, s } = fakeStore();
  await assert.rejects(syncOnce(chain, store, CFG, boot), /tidak dikembalikan/);
  assert.equal(s.cursor, null);
});

test("snapshotNav: menulis titik NAV tanpa menyentuh kursor", async () => {
  const { chain } = fakeChain({ head: 200n });
  const { store, s } = fakeStore();
  assert.equal(await snapshotNav(chain, store, CFG, boot), true);
  assert.equal(s.cursor, null);
  assert.equal(s.nav.length, 1);
  assert.equal(await snapshotNav(fakeChain({ head: 200n, nav: { ok: false } }).chain, store, CFG, boot), false);
});

test("toDecimal: eksak, tanpa nol buntut", () => {
  assert.equal(toDecimal(0n, 18), "0");
  assert.equal(toDecimal(1n, 18), "0.000000000000000001");
  assert.equal(toDecimal(1_500_000n, 6), "1.5");
  assert.equal(toDecimal(123n * 10n ** 18n, 18), "123");
  assert.equal(toDecimal(42n, 0), "42");
  assert.equal(toDecimal(-5n * 10n ** 17n, 18), "-0.5");
  assert.throws(() => toDecimal(1n, -1), RangeError);
});

const ENV = { INDEXER_RPC_URL: "http://x", CORDON_VAULT_ADDRESS: V, SUPABASE_URL: "https://p.supabase.co", SUPABASE_SERVICE_ROLE_KEY: "k", START_BLOCK: "123" };
test("loadConfig: default masuk akal dan semua wajib diperiksa", () => {
  const c = loadConfig(ENV);
  assert.equal(c.startBlock, 123n); assert.equal(c.chainId, 46630); assert.equal(c.confirmations, 5n); assert.equal(c.logChunk, 2000n);
  for (const k of ["INDEXER_RPC_URL", "CORDON_VAULT_ADDRESS", "SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY", "START_BLOCK"]) {
    assert.throws(() => loadConfig({ ...ENV, [k]: " " }), new RegExp(k), k);
  }
  assert.throws(() => loadConfig({ ...ENV, CORDON_VAULT_ADDRESS: "0x" + "0".repeat(40) }), /alamat/);
  assert.throws(() => loadConfig({ ...ENV, START_BLOCK: "-1" }), /START_BLOCK/);
  assert.throws(() => loadConfig({ ...ENV, LOG_CHUNK: "0" }), /LOG_CHUNK/);
  assert.throws(() => loadConfig({ ...ENV, SUPABASE_URL: "p.supabase.co" }), /http/);
});
