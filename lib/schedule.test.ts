import test from "node:test";
import assert from "node:assert/strict";
import { nextHarvestClose, splitDuration, whenLabels } from "./schedule.ts";

const next = (iso: string) => nextHarvestClose(new Date(iso)).toISOString();

test("Jumat 16:00 EDT = 20:00 UTC", () => {
  assert.equal(next("2026-10-07T14:00:00Z"), "2026-10-09T20:00:00.000Z"); // Rabu
  assert.equal(next("2026-10-09T19:59:59Z"), "2026-10-09T20:00:00.000Z"); // 1 detik sebelum
});

test("tepat atau sesudah target: mundur ke Jumat minggu depan", () => {
  assert.equal(next("2026-10-09T20:00:00Z"), "2026-10-16T20:00:00.000Z");
  assert.equal(next("2026-10-09T23:00:00Z"), "2026-10-16T20:00:00.000Z");
  assert.equal(next("2026-10-10T12:00:00Z"), "2026-10-16T20:00:00.000Z"); // Sabtu
  assert.equal(next("2026-10-11T12:00:00Z"), "2026-10-16T20:00:00.000Z"); // Minggu
});

test("Jumat 16:00 EST = 21:00 UTC (musim dingin)", () => {
  assert.equal(next("2026-12-02T10:00:00Z"), "2026-12-04T21:00:00.000Z");
});

test("melintasi pergantian jam musim panas", () => {
  // DST berakhir Minggu 1 Nov 2026: Jumat 30 Okt masih EDT, Jumat 6 Nov sudah EST.
  assert.equal(next("2026-10-31T00:00:00Z"), "2026-11-06T21:00:00.000Z"); // Jumat 20:00 EDT, sudah lewat
  assert.equal(next("2026-10-28T12:00:00Z"), "2026-10-30T20:00:00.000Z");
  // DST mulai Minggu 8 Mar 2026: Jumat 6 Mar masih EST, Jumat 13 Mar sudah EDT.
  assert.equal(next("2026-03-05T12:00:00Z"), "2026-03-06T21:00:00.000Z");
  assert.equal(next("2026-03-09T12:00:00Z"), "2026-03-13T20:00:00.000Z");
});

test("melintasi akhir bulan dan tahun", () => {
  assert.equal(next("2026-12-29T12:00:00Z"), "2027-01-01T21:00:00.000Z"); // Jumat 1 Jan 2027, EST
  assert.equal(next("2026-04-29T12:00:00Z"), "2026-05-01T20:00:00.000Z");
});

test("label WIB", () => {
  const t = new Date("2026-10-09T20:00:00Z");
  assert.deepEqual(whenLabels(t), { et: "Friday 16:00 ET", wib: "Saturday 03:00 WIB" });
  assert.equal(whenLabels(new Date("2026-12-04T21:00:00Z")).wib, "Saturday 04:00 WIB");
});

test("splitDuration", () => {
  assert.deepEqual(splitDuration(2 * 86400 + 3 * 3600 + 4 * 60 + 5), { d: 2, h: 3, m: 4, s: 5 });
  assert.deepEqual(splitDuration(-5), { d: 0, h: 0, m: 0, s: 0 });
});
