import test from "node:test";
import assert from "node:assert/strict";
import { navDue } from "../src/nav-due.ts";

const EVERY = 300_000; // 5 menit
test("navDue: tepat sekali per jendela 5 menit saat dipanggil tiap menit", () => {
  const base = 1_791_000_000_000 - (1_791_000_000_000 % EVERY);
  const hits = [0, 1, 2, 3, 4].map((m) => navDue(base + m * 60_000 + 7_000, EVERY));
  assert.deepEqual(hits, [true, false, false, false, false]);
  assert.equal(navDue(base + 5 * 60_000 + 7_000, EVERY), true);
});
test("navDue: periode tidak default dan batas tepat", () => {
  assert.equal(navDue(EVERY, EVERY, 60_000), true);
  assert.equal(navDue(EVERY - 1, EVERY, 60_000), false);
  assert.equal(navDue(EVERY + 59_999, EVERY, 60_000), true);
  assert.equal(navDue(EVERY + 60_000, EVERY, 60_000), false);
});
