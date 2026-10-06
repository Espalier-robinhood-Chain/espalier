import test from "node:test";
import assert from "node:assert/strict";
import { loadConfig } from "../src/config.ts";
import { applyEvents, ledgerFromJson, ledgerToJson, MAG, newLedger, WAD, type SpurEvent } from "../src/spur-ledger.ts";
import { bootstrapSpur, roundRow, syncSpurOnce } from "../src/spur-sync.ts";
import type { HarvestRow, OnchainRound, RoundRow, SpurChain, SpurMeta, SpurStore } from "../src/spur-sync.ts";
import type { PositionRow } from "../src/sync.ts";

const V = "0x" + "ee".repeat(20);
const A = "0x" + "a1".repeat(20), B = "0x" + "b2".repeat(20), C = "0x" + "c3".repeat(20), P = "0x" + "d4".repeat(20);
const ZERO = "0x" + "00".repeat(20);
const META: SpurMeta = { address: V.toUpperCase().replace("0X", "0x"), assetSymbol: "NVDA", assetDecimals: 18, premiumDecimals: 6, shareDecimals: 18 };
const CFG = { startBlock: 100n, confirmations: 5n, logChunk: 10n, balanceBatch: 2 };
const ts = (b: bigint) => new Date(Date.UTC(2026, 9, 4, 0, 0, Number(b)));
const EXPIRY = 1_800_000_000n;

let li = 0;
const at = (block: bigint) => ({ block, logIndex: li++ });
const dep = (block: bigint, account: string, amount: bigint): SpurEvent => ({ ...at(block), type: "Deposited", account, amount });
const wd = (block: bigint, account: string, shares: bigint): SpurEvent => ({ ...at(block), type: "WithdrawRequested", account, shares });
const started = (block: bigint, round: number, ppsStart: bigint, totalShares: bigint): SpurEvent => ({ ...at(block), type: "RoundStarted", round, ppsStart, totalShares });
const sold = (block: bigint, round: number, premium: bigint): SpurEvent => ({ ...at(block), type: "RoundSold", round, picker: P, premium });
const settled = (block: bigint, round: number): SpurEvent => ({ ...at(block), type: "RoundSettled", round });
const claimed = (block: bigint, account: string, amount: bigint): SpurEvent => ({ ...at(block), type: "PremiumClaimed", account, amount });

const roundOf = (o: Partial<OnchainRound>): OnchainRound => ({
  start: 0n, expiry: EXPIRY, strikeE18: 110n * WAD, startPriceE18: 100n * WAD, notional: 40n * WAD, minPremium: 0n, picker: ZERO,
  premium: 0n, settlePriceE18: 0n, payout: 0n, outcome: 0, ...o,
});

function fakeChain(o: { head: bigint; events?: SpurEvent[]; rounds?: Record<number, OnchainRound>; shares?: Record<string, bigint> }) {
  const st = { head: o.head, events: o.events ?? [], rounds: o.rounds ?? {}, shares: o.shares ?? {}, ranges: [] as Array<[bigint, bigint]> };
  const chain: SpurChain = {
    head: async () => st.head,
    blockTimestamp: async (b) => ts(b),
    meta: async () => META,
    events: async (a, b) => { st.ranges.push([a, b]); return st.events.filter((e) => e.block >= a && e.block <= b); },
    round: async (n) => st.rounds[n] ?? roundOf({ expiry: 0n }),
    sharesOf: async (accs) => new Map(accs.filter((a) => a in st.shares).map((a) => [a, st.shares[a]!])),
  };
  return { chain, st };
}
function fakeStore() {
  const s = { cursor: null as bigint | null, state: null as unknown, rounds: new Map<number, RoundRow>(), harvests: new Map<string, HarvestRow>(), positions: new Map<string, string>(), vault: null as unknown, failSnapshot: false, writes: 0 };
  const store: SpurStore = {
    getCursor: async () => s.cursor,
    loadState: async () => JSON.parse(JSON.stringify(s.state)),
    saveSnapshot: async (c, st) => { if (s.failSnapshot) throw new Error("db down"); s.cursor = c; s.state = JSON.parse(JSON.stringify(st)); },
    upsertVault: async (v) => { s.vault = v; return "vault-1"; },
    upsertRounds: async (_id, rows) => { s.writes++; for (const r of rows) s.rounds.set(r.round_no, r); },
    upsertPositions: async (rows: PositionRow[]) => { s.writes++; for (const r of rows) s.positions.set(r.account, r.shares); },
    deletePositions: async (_c, accs) => { s.writes++; for (const a of accs) s.positions.delete(a); },
    upsertHarvests: async (_id, rows) => { s.writes++; for (const r of rows) s.harvests.set(`${r.account}|${r.round_no}`, r); },
  };
  return { store, s };
}
const boot = { meta: META, vaultId: "vault-1" };

// Siklus pertama: A=10, B=30 setor; round 1 (pps 1) terjual 4 USDG, settle, A klaim.
const cycle1 = (): SpurEvent[] => [
  dep(105n, A, 10n * WAD), dep(106n, B, 30n * WAD), started(110n, 1, WAD, 40n * WAD),
  sold(112n, 1, 4_000_000n), settled(120n, 1), claimed(125n, A, 999_999n),
];
const round1Settled = roundOf({ picker: P, premium: 4_000_000n, settlePriceE18: 105n * WAD, outcome: 1 });

test("bootstrapSpur: alamat huruf kecil, simbol default s<aset>, override dihormati", async () => {
  const { store, s } = fakeStore();
  const b = await bootstrapSpur(fakeChain({ head: 0n }).chain, store, null);
  assert.equal(b.vaultId, "vault-1");
  assert.deepEqual(s.vault, { address: V, symbol: "sNVDA", underlying: "NVDA" });
  await bootstrapSpur(fakeChain({ head: 0n }).chain, store, "sNVDA2");
  assert.equal((s.vault as { symbol: string }).symbol, "sNVDA2");
});

test("siklus penuh: round settled, harvest per akun dengan pembulatan kontrak, klaim menandai claimed_at, posisi dari share", async () => {
  li = 0;
  const { chain } = fakeChain({ head: 140n, events: cycle1(), rounds: { 1: round1Settled }, shares: { [A]: 10n * WAD, [B]: 30n * WAD } });
  const { store, s } = fakeStore();
  const r = await syncSpurOnce(chain, store, CFG, boot);
  assert.deepEqual(r, { from: 100n, to: 135n, events: 6, rounds: 1, harvests: 2, positions: 2 });
  assert.deepEqual(s.rounds.get(1), {
    round_no: 1, strike: "110", expiry: new Date(Number(EXPIRY) * 1000).toISOString(), notional: "40", premium_usdg: "4", spot_start: "100",
    picker: P, settlement_price: "105", settled_at: ts(120n).toISOString(), status: "settled",
  });
  // floor(floor(4e6*2^128/40e18) * share / 2^128): 999999 untuk A, 2999999 untuk B (sama dengan kontrak, bukan 1.0 / 3.0)
  assert.deepEqual(s.harvests.get(`${A}|1`), { account: A, round_no: 1, premium_usdg: "0.999999", claimed_at: ts(125n).toISOString() });
  assert.deepEqual(s.harvests.get(`${B}|1`), { account: B, round_no: 1, premium_usdg: "2.999999", claimed_at: null });
  assert.equal(s.positions.get(A), "10");
  assert.equal(s.positions.get(B), "30");
  assert.equal(s.cursor, 136n);
});

test("inkremental: snapshot dipakai lagi; setoran dikonversi pada pps baru; penarik tidak dapat premium round itu; posisi nol dihapus", async () => {
  li = 0;
  const f = fakeChain({ head: 140n, events: cycle1(), rounds: { 1: round1Settled }, shares: { [A]: 10n * WAD, [B]: 30n * WAD } });
  const { store, s } = fakeStore();
  await syncSpurOnce(f.chain, store, CFG, boot);

  // Round 2: pps 1.1. C setor 22 -> 20 share. B minta tarik 30 share. Total = A10 + C20 = 30.
  f.st.events.push(dep(150n, C, 22n * WAD), wd(151n, B, 30n * WAD), started(155n, 2, 11n * 10n ** 17n, 30n * WAD), sold(157n, 2, 3_000_000n), settled(160n, 2));
  f.st.rounds[2] = roundOf({ picker: P, premium: 3_000_000n, settlePriceE18: 90n * WAD, outcome: 1 });
  f.st.shares = { [B]: 0n, [C]: 20n * WAD };
  f.st.head = 180n; f.st.ranges.length = 0;
  const r = await syncSpurOnce(f.chain, store, CFG, boot);

  assert.equal(f.st.ranges[0]![0], 136n, "mulai dari kursor, bukan START_BLOCK");
  assert.deepEqual(r, { from: 136n, to: 175n, events: 5, rounds: 1, harvests: 2, positions: 2 });
  assert.equal(s.positions.has(B), false, "B keluar penuh");
  assert.equal(s.positions.get(C), "20");
  assert.equal(s.harvests.get(`${C}|2`)!.premium_usdg, "1.999999");
  assert.equal(s.harvests.get(`${A}|2`)!.premium_usdg, "0.999999");
  assert.equal(s.harvests.has(`${B}|2`), false, "B tidak berhak atas premium round 2");
  assert.equal(s.harvests.get(`${A}|1`)!.claimed_at, ts(125n).toISOString(), "klaim lama tidak tertimpa");
  assert.equal(s.cursor, 176n);
});

test("round RoundSkipped: tanpa opsi, tidak ada baris rounds, antrean tetap diproses", async () => {
  li = 0;
  const { chain } = fakeChain({ head: 140n, events: [dep(105n, A, 5n * WAD), { ...at(110n), type: "RoundSkipped", round: 1, ppsStart: WAD }], shares: { [A]: 5n * WAD } });
  const { store, s } = fakeStore();
  const r = await syncSpurOnce(chain, store, CFG, boot);
  assert.equal(r!.rounds, 0);
  assert.equal(s.rounds.size, 0);
  assert.equal(s.positions.get(A), "5");
});

test("status round dari state kontrak: open, auctioned, cancelled; settled tanpa RoundSettled = galat", () => {
  assert.equal(roundRow(roundOf({}), META, 1, undefined)!.status, "open");
  const a = roundRow(roundOf({ picker: P, premium: 1_500_000n }), META, 1, undefined)!;
  assert.equal(a.status, "auctioned"); assert.equal(a.premium_usdg, "1.5"); assert.equal(a.settlement_price, null);
  const c = roundRow(roundOf({ outcome: 2 }), META, 1, undefined)!;
  assert.equal(c.status, "cancelled"); assert.equal(c.premium_usdg, null); assert.equal(c.picker, null);
  assert.throws(() => roundRow(roundOf({ outcome: 1, picker: P }), META, 1, undefined), /RoundSettled/);
  assert.throws(() => roundRow(roundOf({ outcome: 9 }), META, 1, undefined), /tidak dikenal/);
});

test("pagar integritas: share ledger beda dari kontrak = galat, tidak ada tulisan, kursor tidak maju", async () => {
  li = 0;
  const { chain } = fakeChain({ head: 140n, events: cycle1(), rounds: { 1: round1Settled }, shares: { [A]: 10n * WAD, [B]: 29n * WAD } });
  const { store, s } = fakeStore();
  await assert.rejects(syncSpurOnce(chain, store, CFG, boot), /ledger .* != kontrak/);
  assert.equal(s.cursor, null); assert.equal(s.writes, 0);
});

test("crash sebelum snapshot: dijalankan ulang menghasilkan data yang sama (idempoten)", async () => {
  li = 0;
  const { chain } = fakeChain({ head: 140n, events: cycle1(), rounds: { 1: round1Settled }, shares: { [A]: 10n * WAD, [B]: 30n * WAD } });
  const { store, s } = fakeStore();
  s.failSnapshot = true;
  await assert.rejects(syncSpurOnce(chain, store, CFG, boot), /db down/);
  assert.equal(s.cursor, null);
  const before = JSON.stringify([...s.harvests]);
  s.failSnapshot = false;
  await syncSpurOnce(chain, store, CFG, boot);
  assert.equal(JSON.stringify([...s.harvests]), before);
  assert.equal(s.harvests.size, 2); assert.equal(s.rounds.size, 1); assert.equal(s.cursor, 136n);
});

test("belum ada blok aman: tidak melakukan apa pun", async () => {
  const { chain } = fakeChain({ head: 103n });
  const { store, s } = fakeStore();
  assert.equal(await syncSpurOnce(chain, store, CFG, boot), null);
  assert.equal(s.writes, 0);
});

test("ledger menolak urutan mustahil: round terlewat, batal melebihi antrean, total share menyimpang, klaim tak cocok, event tak terurut", () => {
  const tsOf = ts;
  li = 0; assert.throws(() => applyEvents(newLedger(), [started(110n, 2, WAD, 0n)], tsOf), /round 2 datang setelah 0/);
  li = 0; assert.throws(() => applyEvents(newLedger(), [{ ...at(105n), type: "DepositCancelled", account: A, amount: 1n }], tsOf), /batal setoran/);
  li = 0; assert.throws(() => applyEvents(newLedger(), [dep(105n, A, 10n * WAD), started(110n, 1, WAD, 11n * WAD)], tsOf), /total share/);
  li = 0; assert.throws(() => applyEvents(newLedger(), [dep(105n, A, 10n * WAD), started(110n, 1, WAD, 10n * WAD), sold(112n, 1, 4_000_000n), claimed(113n, A, 9_000_000n)], tsOf), /klaim premium/);
  li = 0; const e = [dep(106n, A, 1n), dep(105n, B, 1n)];
  assert.throws(() => applyEvents(newLedger(), e, tsOf), /tidak terurut/);
  li = 0; assert.throws(() => applyEvents(newLedger(), [sold(112n, 1, 1n)], tsOf), /tanpa round aktif/);
});

test("ledger: batal setoran sebelum roll tidak menghasilkan share; premium tidak dibagi ke akun tanpa share", () => {
  li = 0;
  const l = newLedger();
  const fx = applyEvents(l, [dep(105n, A, 10n * WAD), dep(106n, B, 5n * WAD), { ...at(107n), type: "DepositCancelled", account: B, amount: 5n * WAD }, started(110n, 1, WAD, 10n * WAD), sold(112n, 1, 2_000_000n)], ts);
  assert.equal(l.accounts.get(B)!.shares, 0n);
  assert.deepEqual([...fx.harvests.keys()], [`${A}|1`]);
  assert.equal(fx.harvests.get(`${A}|1`)!.amount, ((2_000_000n * MAG) / (10n * WAD) * (10n * WAD)) / MAG);
});

test("serialisasi ledger bolak-balik tanpa kehilangan bigint, akun kosong dibuang", () => {
  li = 0;
  const l = newLedger();
  applyEvents(l, [dep(105n, A, 10n * WAD), dep(106n, B, 1n), { ...at(107n), type: "DepositCancelled", account: B, amount: 1n }, started(110n, 1, WAD, 10n * WAD), sold(112n, 1, 2_000_000n)], ts);
  const j = JSON.parse(JSON.stringify(ledgerToJson(l)));
  assert.equal(Object.keys(j.accounts).length, 1);
  const back = ledgerFromJson(j);
  assert.deepEqual(ledgerToJson(back), ledgerToJson(l));
  assert.throws(() => ledgerFromJson({ v: 2 }), /rusak/);
});

test("config: Spur opsional; bila diisi divalidasi", () => {
  const base = { INDEXER_RPC_URL: "http://x", CORDON_VAULT_ADDRESS: "0x" + "11".repeat(20), START_BLOCK: "1", SUPABASE_URL: "http://s", SUPABASE_SERVICE_ROLE_KEY: "k" };
  assert.equal(loadConfig(base).spur, null);
  const ok = loadConfig({ ...base, SPUR_VAULT_ADDRESS: V, SPUR_START_BLOCK: "42", SPUR_VAULT_SYMBOL: "sNVDA" });
  assert.deepEqual(ok.spur, { vault: V, startBlock: 42n, symbol: "sNVDA" });
  assert.throws(() => loadConfig({ ...base, SPUR_VAULT_ADDRESS: V }), /SPUR_START_BLOCK/);
  assert.throws(() => loadConfig({ ...base, SPUR_VAULT_ADDRESS: "0x123", SPUR_START_BLOCK: "1" }), /SPUR_VAULT_ADDRESS/);
  assert.throws(() => loadConfig({ ...base, SPUR_VAULT_ADDRESS: V, SPUR_START_BLOCK: "1", SPUR_VAULT_SYMBOL: "bad symbol!" }), /SPUR_VAULT_SYMBOL/);
});
