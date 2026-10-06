import test from "node:test";
import assert from "node:assert/strict";
import { canTransition, nextRoundAction, strikeFor } from "../src/rounds.ts";

const E18 = 10n ** 18n;

test("strikeFor: spur naik dan dibulatkan ke atas, graft turun dan dibulatkan ke bawah", () => {
  assert.equal(strikeFor("spur", 100n * E18, 500, E18 / 100n), 105n * E18); // +5%, tick $0,01
  assert.equal(strikeFor("graft", 100n * E18, 500, E18 / 100n), 95n * E18);
  assert.equal(strikeFor("spur", 123_456n * E18 / 1000n, 300, E18), 128n * E18); // 127.159.. -> ke atas ke $1
  assert.equal(strikeFor("graft", 123_456n * E18 / 1000n, 300, E18), 119n * E18); // 119.75.. -> ke bawah ke $1
  assert.ok(strikeFor("spur", 100n * E18, 0, E18) >= 100n * E18); // 0% OTM = ATM, tidak pernah di bawah harga
  assert.ok(strikeFor("graft", 100n * E18, 0, 1n) <= 100n * E18);
});

test("strikeFor: input salah ditolak", () => {
  assert.throws(() => strikeFor("spur", 0n, 500, 1n), RangeError);
  assert.throws(() => strikeFor("spur", E18, -1, 1n), RangeError);
  assert.throws(() => strikeFor("spur", E18, 5001, 1n), RangeError);
  assert.throws(() => strikeFor("spur", E18, 500, 0n), RangeError);
  assert.throws(() => strikeFor("graft", E18 / 2n, 500, E18), RangeError); // strike jadi 0
});

test("canTransition: open->auctioned->settled; terminal tidak bisa pindah; tidak boleh loncat", () => {
  assert.ok(canTransition("open", "auctioned") && canTransition("auctioned", "settled") && canTransition("open", "cancelled"));
  assert.ok(!canTransition("open", "settled") && !canTransition("settled", "open") && !canTransition("cancelled", "open") && !canTransition("auctioned", "cancelled"));
});

const FRI = new Date("2026-10-09T20:00:00Z"); // Jumat 16:00 EDT
test("nextRoundAction: roll ke Jumat 16:00 ET berikutnya bila tidak ada round aktif dan harga live", () => {
  const now = new Date("2026-10-05T14:00:00Z"); // Senin
  const a = nextRoundAction({ now, latest: null, settlementRecorded: false, pricesLive: true });
  assert.deepEqual(a, { action: "roll", expiry: FRI, roundNo: 1 });
  const b = nextRoundAction({ now, latest: { roundNo: 4, status: "settled", expiry: new Date("2026-10-02T20:00:00Z") }, settlementRecorded: true, pricesLive: true });
  assert.deepEqual(b, { action: "roll", expiry: FRI, roundNo: 5 });
  assert.equal(nextRoundAction({ now, latest: null, settlementRecorded: false, pricesLive: false }).action, "wait");
});

test("nextRoundAction: round berjalan = tunggu; lewat expiry = settle hanya bila harga settlement tercatat", () => {
  const live = { roundNo: 2, status: "auctioned" as const, expiry: FRI };
  assert.equal(nextRoundAction({ now: new Date("2026-10-07T00:00:00Z"), latest: live, settlementRecorded: false, pricesLive: true }).action, "wait");
  const after = new Date("2026-10-09T20:30:00Z");
  assert.equal(nextRoundAction({ now: after, latest: live, settlementRecorded: false, pricesLive: true }).action, "wait");
  assert.deepEqual(nextRoundAction({ now: after, latest: live, settlementRecorded: true, pricesLive: true }), { action: "settle", roundNo: 2 });
  assert.match((nextRoundAction({ now: after, latest: { ...live, status: "open" }, settlementRecorded: true, pricesLive: true }) as { reason: string }).reason, /without a Picker/);
});
