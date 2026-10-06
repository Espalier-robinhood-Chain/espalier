import test from "node:test";
import assert from "node:assert/strict";
import { marketState, nextChange } from "./market.ts";

const s = (iso: string) => marketState(new Date(iso));
test("sesi ET (EDT)", () => {
  assert.equal(s("2026-10-07T14:00:00Z"), "regular"); // Rabu 10:00
  assert.equal(s("2026-10-07T10:00:00Z"), "extended"); // Rabu 06:00
  assert.equal(s("2026-10-09T22:00:00Z"), "extended"); // Jumat 18:00
  assert.equal(s("2026-10-09T06:00:00Z"), "overnight"); // Jumat 02:00
  assert.equal(s("2026-10-05T00:30:00Z"), "overnight"); // Minggu 20:30
});
test("akhir pekan tutup", () => {
  assert.equal(s("2026-10-10T00:00:00Z"), "closed"); // Jumat 20:00
  assert.equal(s("2026-10-03T12:00:00Z"), "closed"); // Sabtu
  assert.equal(s("2026-10-04T23:30:00Z"), "closed"); // Minggu 19:30
});
test("nextChange: Sabtu → Minggu 20:00 ET", () => assert.equal(nextChange(new Date("2026-10-03T12:00:00Z")), "2026-10-05T00:00:00.000Z"));
