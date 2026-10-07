import test from "node:test";
import assert from "node:assert/strict";
import { liveRoundRow, toNumber, type OnchainRound } from "./live-round-map.ts";

// Nilai nyata round 2 gNVDA di testnet: strike 225, harga awal 250, notional 1,7777... NVDA, expiry 9 Okt 2026 20:00 UTC.
const base: OnchainRound = {
  expiry: 1791576000n, strikeE18: 225000000000000000000n, startPriceE18: 250000000000000000000n,
  notional: 1777777777777777777n, picker: "0x0000000000000000000000000000000000000000", premium: 0n, outcome: 0,
};

test("toNumber: skala 18, 6, dan 0", () => {
  assert.equal(toNumber(225000000000000000000n, 18), 225);
  assert.equal(toNumber(1500000n, 6), 1.5);
  assert.equal(toNumber(5n, 0), 5);
  assert.equal(toNumber(1n, 18), 1e-18);
});

test("round berjalan belum terjual = open, tanpa premium dan picker", () => {
  const r = liveRoundRow(base, 2, "v1", 18, 6);
  assert.ok(r);
  assert.equal(r.status, "open");
  assert.equal(r.round_no, 2);
  assert.equal(r.vault_id, "v1");
  assert.equal(r.strike, 225);
  assert.equal(r.spot_start, 250);
  assert.ok(Math.abs(r.notional - 1.7777777777777777) < 1e-12);
  assert.equal(r.expiry, "2026-10-09T20:00:00.000Z");
  assert.equal(r.premium_usdg, null);
  assert.equal(r.picker, null);
});

test("round dengan picker = auctioned, premium memakai desimal USDG", () => {
  const picker = "0xE0bf53F10B12bcd19A979C698809750f34512f47";
  const r = liveRoundRow({ ...base, picker, premium: 12_500_000n }, 3, "v1", 18, 6);
  assert.ok(r);
  assert.equal(r.status, "auctioned");
  assert.equal(r.premium_usdg, 12.5);
  assert.equal(r.picker, picker.toLowerCase());
});

test("bukan round berjalan: expiry 0 (dilewati) atau outcome bukan Pending", () => {
  assert.equal(liveRoundRow({ ...base, expiry: 0n }, 1, "v1", 18, 6), null);
  assert.equal(liveRoundRow({ ...base, outcome: 1 }, 1, "v1", 18, 6), null);
  assert.equal(liveRoundRow({ ...base, outcome: 2 }, 1, "v1", 18, 6), null);
});