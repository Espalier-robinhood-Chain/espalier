import test from "node:test";
import assert from "node:assert/strict";
import { changePct, computeStreak, latestHarvest, realizedApy, roundYield, withWeights } from "./derive.ts";

const W = 7 * 86400000, T0 = 2900 * W;
const iso = (w: number) => new Date(T0 + w * W + 1000).toISOString();
test("streak: berurutan, terputus, kosong", () => {
  assert.equal(computeStreak([iso(5), iso(4), iso(3)]), 3);
  assert.equal(computeStreak([iso(5), iso(4), iso(2)]), 2);
  assert.equal(computeStreak([iso(5), iso(5)]), 1);
  assert.equal(computeStreak([]), 0);
});
test("realized APY hanya dari round settled", () => {
  const r = { notional: 10, spot_start: 100, premium_usdg: 10, status: "settled" }; // 1%/minggu
  assert.equal(realizedApy([r, { ...r, status: "open" }]), 52);
  assert.equal(realizedApy([{ ...r, status: "open" }]), null);
});
test("realized APY Graft memakai collateral (strike × notional), bukan harga awal", () => {
  const r = { notional: 10, spot_start: 100, strike: 120, premium_usdg: 12, status: "settled" };
  assert.equal(realizedApy([r], "graft"), 52); // 12 / (10 × 120) = 1%/minggu
  assert.equal(realizedApy([r], "spur")?.toFixed(1), "62.4"); // 12 / (10 × 100) = 1,2%/minggu
  assert.equal(realizedApy([{ ...r, strike: null }], "graft"), null); // tanpa strike tidak ada basis
});
test("roundYield: null jika premium atau basis belum ada", () => {
  const r = { notional: 10, spot_start: 100, premium_usdg: 10, status: "open" };
  assert.equal(roundYield(r), 0.01);
  assert.equal(roundYield({ ...r, premium_usdg: null }), null);
  assert.equal(roundYield({ ...r, spot_start: null }), null);
});
test("changePct dan bobot", () => {
  assert.equal(changePct(101, 100)?.toFixed(2), "1.00");
  assert.equal(changePct(101, undefined), null);
  assert.deepEqual(withWeights([{ valueUsd: 3 }, { valueUsd: 1 }]).map((x) => x.weightBps), [7500, 2500]);
});

test("latestHarvest: jumlahkan premium minggu terbaru, bagi nilai total", () => {
  const rows = [
    { expiry: iso(4), round_no: 4, premium_usdg: 3 },
    { expiry: iso(4), round_no: 2, premium_usdg: 1 },
    { expiry: iso(3), round_no: 3, premium_usdg: 50 },
  ];
  const h = latestHarvest(rows, 1000);
  assert.equal(h?.round, 4);
  assert.equal(h?.premiumUsdg, 4);
  assert.equal(h?.pct, 0.4);
});
test("latestHarvest: null tanpa Harvest atau tanpa nilai", () => {
  assert.equal(latestHarvest([], 1000), null);
  assert.equal(latestHarvest([{ expiry: iso(1), round_no: 1, premium_usdg: 1 }], 0), null);
});
