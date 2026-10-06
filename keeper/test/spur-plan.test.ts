import test from "node:test";
import assert from "node:assert/strict";
import { findSettlementRound, nextSpurAction, rollExpiry, type FeedReader, type SpurSnapshot } from "../src/spur-plan.ts";

const DAY = 86_400n;
const P = "0x" + "d4".repeat(20), ZERO = "0x" + "00".repeat(20);
const sec = (iso: string) => BigInt(Date.parse(iso) / 1000);
const FRI = sec("2026-10-09T20:00:00Z"); // Jumat 16:00 EDT
const FRI2 = sec("2026-10-16T20:00:00Z");

const snap = (o: Partial<SpurSnapshot>): SpurSnapshot => ({
  now: sec("2026-10-05T14:00:00Z"), paused: false, active: false, round: 0n, current: null, fillWindow: 21_600n,
  minDuration: DAY, maxDuration: 14n * DAY, settlementRecorded: false, ...o,
});
const rnd = (o: Partial<{ start: bigint; expiry: bigint; picker: string; outcome: number }> = {}) => ({ start: sec("2026-10-05T14:00:00Z"), expiry: FRI, picker: ZERO, outcome: 0, ...o });

test("rollExpiry: Jumat 16:00 ET berikutnya; bila kurang dari 1 hari + margin, loncat ke Jumat sesudahnya", () => {
  assert.equal(rollExpiry(sec("2026-10-05T14:00:00Z"), DAY, 14n * DAY), FRI);
  assert.equal(rollExpiry(sec("2026-10-08T21:00:00Z"), DAY, 14n * DAY), FRI2, "Kamis 17:00 EDT: Jumat tinggal 23 jam");
  assert.equal(rollExpiry(sec("2026-10-09T20:30:00Z"), DAY, 14n * DAY), FRI2, "sesaat setelah expiry");
  assert.equal(rollExpiry(sec("2026-10-05T14:00:00Z"), DAY, 3n * DAY), null, "di luar batas maksimum: jangan memaksa");
});

test("rollExpiry: DST (Jumat sebelum dan sesudah pergantian) tetap 16:00 ET", () => {
  assert.equal(rollExpiry(sec("2026-10-28T12:00:00Z"), DAY, 14n * DAY), sec("2026-10-30T20:00:00Z")); // masih EDT
  assert.equal(rollExpiry(sec("2026-11-02T12:00:00Z"), DAY, 14n * DAY), sec("2026-11-06T21:00:00Z")); // EST
});

test("nextSpurAction: tidak aktif -> roll; paused -> tunggu", () => {
  assert.deepEqual(nextSpurAction(snap({})), { action: "roll", expiry: FRI });
  assert.equal(nextSpurAction(snap({ paused: true })).action, "wait");
});

test("nextSpurAction: aktif belum terjual -> fill sampai start+fillWindow, sesudahnya closeUnsold", () => {
  const start = sec("2026-10-05T14:00:00Z");
  const base = { active: true, round: 3n, current: rnd({ start }) };
  assert.deepEqual(nextSpurAction(snap({ ...base, now: start + 21_600n })), { action: "fill", round: 3n });
  assert.deepEqual(nextSpurAction(snap({ ...base, now: start + 21_601n })), { action: "closeUnsold" });
});

test("nextSpurAction: terjual -> tunggu sampai expiry; lalu catat settlement; lalu settleRound", () => {
  const cur = rnd({ picker: P });
  assert.equal(nextSpurAction(snap({ active: true, round: 3n, current: cur, now: FRI - 1n })).action, "wait");
  assert.deepEqual(nextSpurAction(snap({ active: true, round: 3n, current: cur, now: FRI })), { action: "recordSettlement" });
  assert.deepEqual(nextSpurAction(snap({ active: true, round: 3n, current: cur, now: FRI + 60n, settlementRecorded: true })), { action: "settleRound" });
});

// ---- findSettlementRound ----
const PH = 2n << 64n; // fase 2
function feed(rounds: Record<string, bigint>, latestNo: bigint, calls?: string[]): FeedReader {
  return {
    latest: async () => ({ id: PH | latestNo, updatedAt: rounds[String(latestNo)]! }),
    round: async (id) => { calls?.push(String(id & ((1n << 64n) - 1n))); const u = rounds[String(id & ((1n << 64n) - 1n))]; return u === undefined ? null : { updatedAt: u }; },
  };
}
const E = 1_000_000n, D = 7_200n;

test("settlement: print = round pertama >= expiry (pencarian biner, tidak memindai semua round)", async () => {
  const rounds: Record<string, bigint> = {};
  for (let n = 1n; n <= 200n; n++) rounds[String(n)] = n < 120n ? E - 1000n + n : E + 100n + n; // 120 = pertama >= expiry? 120 -> E+220
  // pastikan monoton: n=119 -> E-881 (< E), n=120 -> E+220
  const calls: string[] = [];
  const r = await findSettlementRound(feed(rounds, 200n, calls), E, D, E + 5000n);
  assert.deepEqual(r, { kind: "print", roundId: PH | 120n });
  assert.ok(calls.length <= 10, `terlalu banyak pembacaan: ${calls.length}`);
});

test("settlement: belum ada update setelah expiry -> tunggu selama jendela print, fallback sesudahnya (round terbaru)", async () => {
  const f = feed({ "1": E - 500n, "2": E - 400n }, 2n);
  assert.equal((await findSettlementRound(f, E, D, E + D)).kind, "wait"); // tepat di batas jendela masih terbuka
  assert.deepEqual(await findSettlementRound(f, E, D, E + D + 1n), { kind: "fallback", roundId: PH | 2n });
});

test("settlement: print terlambat (> maxPrintDelay) -> fallback ke round tepat sebelum print", async () => {
  const f = feed({ "1": E - 900n, "2": E - 500n, "3": E + D + 50n }, 3n);
  assert.deepEqual(await findSettlementRound(f, E, D, E + D + 100n), { kind: "fallback", roundId: PH | 2n });
});

test("settlement: print tepat di batas maxPrintDelay masih print", async () => {
  const f = feed({ "1": E - 900n, "2": E - 500n, "3": E + D }, 3n);
  assert.deepEqual(await findSettlementRound(f, E, D, E + D + 100n), { kind: "print", roundId: PH | 3n });
});

test("settlement: round pertama fase (nomor 1) setelah expiry = stuck (PhaseBoundary), bukan ditebak", async () => {
  const f = feed({ "1": E + 10n, "2": E + 20n }, 2n);
  assert.equal((await findSettlementRound(f, E, D, E + 100n)).kind, "stuck");
});

test("settlement: lubang data di dalam fase = stuck, galat jaringan dilempar (bukan dianggap 'tidak ada')", async () => {
  const holey: FeedReader = { latest: async () => ({ id: PH | 10n, updatedAt: E + 5n }), round: async () => null };
  assert.equal((await findSettlementRound(holey, E, D, E + 100n)).kind, "stuck");
  const broken: FeedReader = { latest: async () => ({ id: PH | 10n, updatedAt: E + 5n }), round: async () => { throw new Error("rpc down"); } };
  await assert.rejects(findSettlementRound(broken, E, D, E + 100n), /rpc down/);
});
