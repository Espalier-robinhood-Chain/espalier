import { test } from "node:test";
import assert from "node:assert/strict";
import { maxWithSlippage, minWithSlippage, fullMask } from "../src/cordon.ts";
import { parseDeployment } from "../src/deployments.ts";

test("maxWithSlippage membulatkan ke atas, 0 tetap 0", () => {
  assert.deepEqual(maxWithSlippage([1000n, 1n, 0n], 50), [1005n, 2n, 0n]);
  assert.deepEqual(maxWithSlippage([123n], 0), [123n]);
});
test("minWithSlippage membulatkan ke bawah", () => {
  assert.deepEqual(minWithSlippage([1000n, 1n, 0n], 50), [995n, 0n, 0n]);
  assert.deepEqual(minWithSlippage([999n], 10_000), [0n]);
});
test("slippage di luar 0..10000 ditolak", () => {
  assert.throws(() => maxWithSlippage([1n], -1), RangeError);
  assert.throws(() => minWithSlippage([1n], 10_001), RangeError);
  assert.throws(() => maxWithSlippage([1n], 1.5), RangeError);
});
test("fullMask 1..16", () => {
  assert.equal(fullMask(1), 1n);
  assert.equal(fullMask(7), 127n);
  assert.equal(fullMask(16), 65535n);
  assert.throws(() => fullMask(0), RangeError);
  assert.throws(() => fullMask(17), RangeError);
});

const A = "0x" + "11".repeat(20);
const good = { name: "x", chainId: 46630, mocks: false, deployedAt: 1, deployer: A, admin: A, timelock: A, sequencerFeed: A, marketSession: A, oracleRouter: A, settlementOracle: A, cordonVault: A, tokens: [A], feeds: [A] };
test("parseDeployment menerima bentuk Deploy.s.sol dan menolak yang rusak", () => {
  assert.equal(parseDeployment(good).chainId, 46630);
  assert.throws(() => parseDeployment({ ...good, cordonVault: "0xabc" }), /cordonVault/);
  assert.throws(() => parseDeployment({ ...good, feeds: [] }), /beda panjang/);
  assert.throws(() => parseDeployment({ ...good, cordonVault: "0x" + "00".repeat(20) }), /alamat nol/);
  assert.throws(() => parseDeployment(null), /bukan objek/);
  assert.throws(() => parseDeployment({ ...good, mocks: "no" }), /mocks/);
});

test("parseDeployment: spurVault/graftVault/harvestAuction opsional tapi divalidasi", () => {
  const B = "0x" + "22".repeat(20);
  const d = parseDeployment({ ...good, graftVault: B, harvestAuction: B });
  assert.equal(d.graftVault?.toLowerCase(), B);
  assert.equal(d.spurVault, undefined);
  assert.throws(() => parseDeployment({ ...good, graftVault: "0xabc" }), /graftVault/);
});
