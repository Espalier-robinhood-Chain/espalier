import test from "node:test";
import assert from "node:assert/strict";
import { graftResult, holdResult, spurResult } from "./payoff.ts";

const spur = { start: 100, strike: 110, premiumPct: 0.9 };
const graft = { start: 100, strike: 90, premiumPct: 0.9 };

test("spur: di bawah strike = harga + premium; di atas strike = terkunci di batas", () => {
  assert.equal(holdResult(105, 100), 5);
  assert.ok(Math.abs(spurResult(105, spur) - 5.9) < 1e-9);
  assert.ok(Math.abs(spurResult(110, spur) - 10.9) < 1e-9);
  assert.ok(Math.abs(spurResult(140, spur) - 10.9) < 1e-9);
  assert.ok(Math.abs(spurResult(90, spur) - -9.1) < 1e-9);
});

test("spur: premium tidak pernah menutup seluruh kerugian saat harga turun", () => {
  assert.ok(spurResult(80, spur) < 0);
  assert.ok(spurResult(80, spur) > holdResult(80, 100));
});

test("graft: di atas strike = hanya premium; di bawah strike = rugi dari strike ke bawah", () => {
  assert.equal(graftResult(100, graft), 0.9);
  assert.equal(graftResult(90, graft), 0.9);
  assert.ok(Math.abs(graftResult(80, graft) - -9.1) < 1e-9);
  assert.ok(graftResult(60, graft) < graftResult(80, graft));
});
