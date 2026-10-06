import test from "node:test";
import assert from "node:assert/strict";
import { createHttpQuoteSource, MAX_QUOTES, parseQuotes } from "../src/spur-adapters.ts";
import type { FeedReader, SpurSnapshot } from "../src/spur-plan.ts";
import { pickQuote, runSpurOnce, type Hex, type QuoteRequest, type QuoteSource, type RawQuote, type RoundTerms, type SpurCall, type SpurChain, type SpurExecutor, type SpurStore } from "../src/spur-run.ts";

const V = ("0x" + "ee".repeat(20)) as Hex, AU = ("0x" + "ac".repeat(20)) as Hex;
const P1 = ("0x" + "d1".repeat(20)) as Hex, P2 = ("0x" + "d2".repeat(20)) as Hex, P3 = ("0x" + "d3".repeat(20)) as Hex;
const ZERO = "0x" + "00".repeat(20);
const SIG = ("0x" + "11".repeat(65)) as Hex;
const NOW = BigInt(Date.parse("2026-10-05T14:00:00Z") / 1000);
const E18 = 10n ** 18n;
const TERMS: RoundTerms = { strikeE18: 154n * E18, expiry: NOW + 4n * 86_400n, notional: 40n * E18, minPremium: 1_000_000n, start: NOW };

const baseSnap = (o: Partial<SpurSnapshot>): SpurSnapshot => ({ now: NOW, paused: false, active: false, round: 0n, current: null, fillWindow: 21_600n, minDuration: 86_400n, maxDuration: 14n * 86_400n, settlementRecorded: false, ...o });
const unsold = { start: NOW, expiry: TERMS.expiry, picker: ZERO, outcome: 0 };
const sold = { ...unsold, picker: P1.toLowerCase() };

function fakeChain(snap: SpurSnapshot, o: { pickers?: Hex[]; feed?: FeedReader } = {}): SpurChain {
  return {
    vault: V, auction: AU, chainId: 46630,
    snapshot: async () => snap, roundTerms: async () => TERMS,
    isPicker: async (p) => (o.pickers ?? [P1, P2, P3]).includes(p),
    settlementContext: async () => ({ feed: o.feed!, maxPrintDelay: 7200n }),
  };
}
function fakeExec(mode: "dry-run" | "live", o: { sim?: (c: SpurCall) => string | null; sendFails?: boolean } = {}) {
  const st = { simulated: [] as SpurCall[], sent: [] as SpurCall[] };
  const exec: SpurExecutor = {
    mode,
    async simulate(c) { st.simulated.push(c); const r = o.sim?.(c) ?? null; return r ? { ok: false, reason: r } : { ok: true }; },
    async send(c) { if (o.sendFails) throw new Error("rpc timeout"); st.sent.push(c); return { txHash: "0xabc", at: new Date() }; },
  };
  return { exec, st };
}
function fakeStore() {
  const s = { runs: [] as Array<{ job: string; status: string; tx?: string; error?: string }> };
  const store: SpurStore = {
    startRun: async (job) => { s.runs.push({ job, status: "running" }); return s.runs.length - 1; },
    finishRun: async (id, r) => { Object.assign(s.runs[id]!, { status: r.status, tx: r.txHash, error: r.error }); },
  };
  return { store, s };
}
const quotes = (list: RawQuote[], seen?: QuoteRequest[]): QuoteSource => ({ fetch: async (r) => { seen?.push(r); return list; } });
const rq = (picker: Hex, premium: bigint, deadline = NOW + 600n): RawQuote => ({ picker, premium, deadline, signature: SIG });

test("roll: live mengirim dan mencatat keeper_runs ok; dry-run tidak mengirim dan tidak menulis apa pun", async () => {
  const live = fakeExec("live"), ls = fakeStore();
  const o = await runSpurOnce(fakeChain(baseSnap({})), live.exec, null, ls.store);
  assert.equal(o.kind, "sent");
  assert.equal(live.st.sent[0]!.fn, "rollRound");
  assert.deepEqual(ls.s.runs, [{ job: "spur:roll", status: "ok", tx: "0xabc", error: undefined }]);

  const dry = fakeExec("dry-run"), ds = fakeStore();
  const d = await runSpurOnce(fakeChain(baseSnap({})), dry.exec, null, ds.store);
  assert.equal(d.kind, "dry-run");
  assert.equal(dry.st.simulated.length, 1); assert.equal(dry.st.sent.length, 0); assert.equal(ds.s.runs.length, 0);
});

test("simulasi gagal = 'blocked': tidak mengirim, tidak menulis keeper_runs (poll berkala tidak menumpuk baris)", async () => {
  const { exec, st } = fakeExec("live", { sim: () => "revert MarketClosed" });
  const { store, s } = fakeStore();
  const o = await runSpurOnce(fakeChain(baseSnap({})), exec, null, store);
  assert.deepEqual(o, { kind: "blocked", job: "spur:roll", reason: "revert MarketClosed" });
  assert.equal(st.sent.length, 0); assert.equal(s.runs.length, 0);
});

test("kirim gagal setelah lolos simulasi: keeper_runs berstatus failed dengan galatnya", async () => {
  const { exec } = fakeExec("live", { sendFails: true });
  const { store, s } = fakeStore();
  const o = await runSpurOnce(fakeChain(baseSnap({})), exec, null, store);
  assert.equal(o.kind, "failed");
  assert.deepEqual(s.runs, [{ job: "spur:roll", status: "failed", tx: undefined, error: "rpc timeout" }]);
});

test("closeUnsold dan settleRound dipanggil pada waktunya", async () => {
  const c1 = fakeExec("live");
  await runSpurOnce(fakeChain(baseSnap({ active: true, round: 2n, current: unsold, now: NOW + 21_601n })), c1.exec, null, fakeStore().store);
  assert.equal(c1.st.sent[0]!.fn, "closeUnsold");
  const c2 = fakeExec("live");
  await runSpurOnce(fakeChain(baseSnap({ active: true, round: 2n, current: sold, now: TERMS.expiry + 10n, settlementRecorded: true })), c2.exec, null, fakeStore().store);
  assert.equal(c2.st.sent[0]!.fn, "settleRound");
});

test("fill: tanpa sumber RFQ menunggu; quote kosong menunggu; quote dipilih premium tertinggi yang lolos simulasi", async () => {
  const snap = baseSnap({ active: true, round: 2n, current: unsold });
  const none = await runSpurOnce(fakeChain(snap), fakeExec("live").exec, null, fakeStore().store);
  assert.equal(none.kind, "waiting");
  const empty = await runSpurOnce(fakeChain(snap), fakeExec("live").exec, quotes([]), fakeStore().store);
  assert.equal(empty.kind, "waiting");

  const seen: QuoteRequest[] = [];
  // P2 tertinggi tapi simulasi gagal; P3 dibuang karena bukan picker; P1 terpilih.
  const { exec, st } = fakeExec("live", { sim: (c) => (c.fn === "fill" && c.quote.picker === P2 ? "revert InsufficientAllowance" : null) });
  const chain = fakeChain(snap, { pickers: [P1, P2] });
  const o = await runSpurOnce(chain, exec, quotes([rq(P1, 3_000_000n), rq(P2, 5_000_000n), rq(P3, 9_000_000n)], seen), fakeStore().store);
  assert.equal(o.kind, "sent");
  const sent = st.sent[0] as Extract<SpurCall, { fn: "fill" }>;
  assert.equal(sent.quote.picker, P1);
  assert.equal(sent.quote.premium, 3_000_000n);
  // Isi quote disusun keeper dari state onchain, bukan dari balasan RFQ.
  assert.deepEqual({ ...sent.quote, picker: undefined, premium: undefined, deadline: undefined }, { vault: V, picker: undefined, round: 2n, strikeE18: TERMS.strikeE18, expiry: TERMS.expiry, notional: TERMS.notional, premium: undefined, deadline: undefined });
  assert.equal(seen[0]!.minPremium, TERMS.minPremium);
});

test("pickQuote: menolak premium di bawah lantai, deadline mepet, picker tak sah; semua ditolak = null dengan alasan", async () => {
  const { exec } = fakeExec("live");
  const r = await pickQuote([rq(P1, 500_000n), rq(P1, 2_000_000n, NOW + 5n), rq(P3, 2_000_000n), rq(P2, 0n)], TERMS, 2n, V, NOW, async (p) => p !== P3, exec);
  assert.equal(r.call, null);
  assert.equal(r.rejected.length, 4);
  assert.match(r.rejected.join("|"), /below floor/); assert.match(r.rejected.join("|"), /deadline/); assert.match(r.rejected.join("|"), /not an allowed picker/);
});

test("fill: RFQ gagal = blocked (tidak menulis keeper_runs)", async () => {
  const snap = baseSnap({ active: true, round: 2n, current: unsold });
  const failing: QuoteSource = { fetch: async () => { throw new Error("RFQ HTTP 502"); } };
  const { store, s } = fakeStore();
  const o = await runSpurOnce(fakeChain(snap), fakeExec("live").exec, failing, store);
  assert.equal(o.kind, "blocked"); assert.equal(s.runs.length, 0);
});

test("recordSettlement: memilih settle (print) atau settleFallback; stuck = blocked; belum waktunya = waiting", async () => {
  const PH = 1n << 64n;
  const mk = (rounds: Record<string, bigint>, latest: bigint): FeedReader => ({
    latest: async () => ({ id: PH | latest, updatedAt: rounds[String(latest)]! }),
    round: async (id) => { const u = rounds[String(id & ((1n << 64n) - 1n))]; return u === undefined ? null : { updatedAt: u }; },
  });
  const E = TERMS.expiry;
  const snapAfter = (dt: bigint) => baseSnap({ active: true, round: 2n, current: sold, now: E + dt });

  const a = fakeExec("live");
  await runSpurOnce(fakeChain(snapAfter(60n), { feed: mk({ "1": E - 90n, "2": E - 30n, "3": E + 20n }, 3n) }), a.exec, null, fakeStore().store);
  assert.deepEqual(a.st.sent[0], { fn: "settle", roundId: PH | 3n });

  const b = fakeExec("live");
  await runSpurOnce(fakeChain(snapAfter(7201n), { feed: mk({ "1": E - 90n, "2": E - 30n }, 2n) }), b.exec, null, fakeStore().store);
  assert.deepEqual(b.st.sent[0], { fn: "settleFallback", roundId: PH | 2n });

  const w = await runSpurOnce(fakeChain(snapAfter(60n), { feed: mk({ "1": E - 90n }, 1n) }), fakeExec("live").exec, null, fakeStore().store);
  assert.equal(w.kind, "waiting");

  const s = await runSpurOnce(fakeChain(snapAfter(60n), { feed: mk({ "1": E + 5n, "2": E + 9n }, 2n) }), fakeExec("live").exec, null, fakeStore().store);
  assert.equal(s.kind, "blocked");
});

test("parseQuotes: validasi ketat balasan RFQ", () => {
  const ok = { quotes: [{ picker: P1.toLowerCase(), premium: "3000000", deadline: "1800000000", signature: SIG }] };
  const [q] = parseQuotes(ok);
  assert.equal(q!.premium, 3_000_000n); assert.equal(q!.deadline, 1_800_000_000n);
  assert.match(q!.picker, /^0x[0-9a-fA-F]{40}$/);
  assert.throws(() => parseQuotes({}), /array/);
  assert.throws(() => parseQuotes({ quotes: Array(MAX_QUOTES + 1).fill(ok.quotes[0]) }), /lebih dari/);
  const bad = (patch: object) => parseQuotes({ quotes: [{ ...ok.quotes[0], ...patch }] });
  assert.throws(() => bad({ picker: "0x123" }), /picker/);
  assert.throws(() => bad({ premium: "-1" }), /premium/);
  assert.throws(() => bad({ premium: "1.5" }), /premium/);
  assert.throws(() => bad({ deadline: (1n << 64n).toString() }), /uint64/);
  assert.throws(() => bad({ signature: "0xzz" }), /signature/);
  assert.throws(() => bad({ signature: "0x" + "ab".repeat(5000) }), /signature/);
});

test("createHttpQuoteSource: mengirim permintaan JSON (bigint sebagai string) dan token; HTTP non-2xx = galat", async () => {
  const realFetch = globalThis.fetch;
  let captured: { url: string; init: RequestInit } | null = null;
  globalThis.fetch = (async (url: string, init: RequestInit) => { captured = { url, init }; return new Response(JSON.stringify({ quotes: [] }), { status: 200 }); }) as typeof fetch;
  try {
    const src = createHttpQuoteSource("https://rfq.example/q", "tok", 1000);
    await src.fetch({ chainId: 46630, auction: AU, vault: V, round: 2n, strikeE18: TERMS.strikeE18, expiry: TERMS.expiry, notional: TERMS.notional, minPremium: 1n });
    const body = JSON.parse(captured!.init.body as string);
    assert.equal(body.strikeE18, TERMS.strikeE18.toString()); assert.equal(body.round, "2");
    assert.equal((captured!.init.headers as Record<string, string>).authorization, "Bearer tok");
    globalThis.fetch = (async () => new Response("no", { status: 502 })) as typeof fetch;
    await assert.rejects(src.fetch({ chainId: 1, auction: AU, vault: V, round: 1n, strikeE18: 1n, expiry: 1n, notional: 1n, minPremium: 0n }), /HTTP 502/);
  } finally { globalThis.fetch = realFetch; }
});
