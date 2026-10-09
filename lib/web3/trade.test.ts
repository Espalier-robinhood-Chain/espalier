import test from "node:test";
import assert from "node:assert/strict";
import { cordonErrorMessage, formatAmount, isUserRejection, parseAmount, pendingApprovals, USDG_PRICE_UNAVAILABLE } from "./trade.ts";

test("parseAmount: desimal valid ke satuan terkecil", () => {
  assert.equal(parseAmount("1", 18), 10n ** 18n);
  assert.equal(parseAmount("12.5", 18), 125n * 10n ** 17n);
  assert.equal(parseAmount(".5", 6), 500_000n);
  assert.equal(parseAmount("5.", 6), 5_000_000n);
  assert.equal(parseAmount(" 0.000001 ", 6), 1n);
});

test("parseAmount: menolak nol, kosong, tanda, notasi ilmiah, dan digit melebihi desimal (tanpa pembulatan diam-diam)", () => {
  for (const bad of ["", " ", ".", "0", "0.0", "-1", "+1", "1e3", "1,5", "abc", "1.2.3", "0.0000001"]) assert.equal(parseAmount(bad, 6), null, bad);
  assert.equal(parseAmount("1.5", 0), null);
  assert.equal(parseAmount("7", 0), 7n);
});

test("formatAmount: tanpa nol buntut, memotong, dan menandai sisa kecil", () => {
  assert.equal(formatAmount(10n ** 18n, 18), "1");
  assert.equal(formatAmount(125n * 10n ** 17n, 18), "12.5");
  assert.equal(formatAmount(1_234_567_890n, 6), "1234.56789");
  assert.equal(formatAmount(1_234_567_890_123n, 9, 3), "1234.567");
  assert.equal(formatAmount(0n, 18), "0");
  assert.equal(formatAmount(1n, 18), "<0.000001");
  assert.equal(formatAmount(-5_000_000n, 6), "-5");
});

test("parseAmount dan formatAmount saling membalik", () => {
  for (const s of ["1", "0.25", "123456.789", "0.000001"]) assert.equal(formatAmount(parseAmount(s, 6)!, 6), s);
});

test("isUserRejection: nama, kode 4001, dan di dalam rantai cause", () => {
  assert.equal(isUserRejection({ name: "UserRejectedRequestError" }), true);
  assert.equal(isUserRejection({ code: 4001 }), true);
  assert.equal(isUserRejection({ name: "TransactionExecutionError", cause: { name: "X", cause: { code: 4001 } } }), true);
  assert.equal(isUserRejection(new Error("boom")), false);
  assert.equal(isUserRejection(null), false);
  assert.equal(isUserRejection("4001"), false);
  const loop: { cause?: unknown } = {}; loop.cause = loop;
  assert.equal(isUserRejection(loop), false); // siklus tidak menggantung
});

test("cordonErrorMessage: menyebut token lewat indeks, dan jatuh ke pesan umum untuk Unknown", () => {
  assert.match(cordonErrorMessage({ name: "SlippageExceeded", index: 1 }, ["AAPL", "NVDA"]), /NVDA/);
  assert.match(cordonErrorMessage({ name: "PriceUnavailable", index: 5 }, ["AAPL"]), /component #6/);
  assert.match(cordonErrorMessage({ name: "AssetPaused" }), /Redeeming in-kind still works/);
  assert.match(cordonErrorMessage({ name: "Unknown" }), /Nothing was sent/);
  assert.match(cordonErrorMessage({ name: "ERC20InsufficientAllowance" }), /Approve/);
});

test("pendingApprovals: hanya komponen dengan kebutuhan > 0 dan allowance kurang", () => {
  assert.deepEqual(pendingApprovals([0n, 10n, 5n, 0n], [3n, 10n, 6n, 0n]), [0, 2]);
  assert.deepEqual(pendingApprovals([], []), []);
  assert.deepEqual(pendingApprovals([100n], [100n]), []);
});

test("cordonErrorMessage: galat redeem ke USDG punya pesan sendiri", () => {
  assert.match(cordonErrorMessage({ name: "VenueNotSet" }), /not enabled.*Redeem in-kind/);
  assert.match(cordonErrorMessage({ name: "UsdgSlippage" }), /USDG payout fell below your slippage limit/);
  assert.match(USDG_PRICE_UNAVAILABLE, /Redeem in-kind instead/);
});
