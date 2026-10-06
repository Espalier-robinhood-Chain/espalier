import test from "node:test";
import assert from "node:assert/strict";
import { UINT256_MAX, capRoom, checkDeposit, planWithdraw, queuedDeposit, queuedWithdrawShares, sharesToAssets, spurErrorMessage, withdrawableShares } from "./spur.ts";

const E18 = 10n ** 18n;
const base = {
  round: 3n, active: true, paused: false, totalShares: 200n * E18, managedAssets: 200n * E18, pendingDeposits: 0n,
  shares: 100n * E18, assets: 100n * E18, depositRound: 0n, depositAmount: 0n, withdrawRound: 0n, withdrawShares: 0n,
  assetBalance: 50n * E18, assetAllowance: 0n,
};
const info = { minDeposit: 10n ** 12n, depositCap: UINT256_MAX, assetDecimals: 18 };

test("setoran antre: hanya receipt untuk round BERIKUTNYA yang bisa dibatalkan", () => {
  assert.equal(queuedDeposit(base), 0n);
  assert.equal(queuedDeposit({ ...base, depositRound: 4n, depositAmount: 7n }), 7n); // round 3 berjalan, receipt untuk round 4
  assert.equal(queuedDeposit({ ...base, depositRound: 3n, depositAmount: 7n }), 0n, "sudah diproses roll 3");
  assert.equal(queuedDeposit({ ...base, depositRound: 2n, depositAmount: 7n }), 0n, "receipt lama belum disinkron");
});

test("penarikan antre dan share yang masih bebas", () => {
  assert.equal(queuedWithdrawShares({ ...base, withdrawRound: 4n, withdrawShares: 30n * E18 }), 30n * E18);
  assert.equal(queuedWithdrawShares({ ...base, withdrawRound: 3n, withdrawShares: 30n * E18 }), 0n);
  assert.equal(withdrawableShares({ ...base, withdrawRound: 4n, withdrawShares: 30n * E18 }), 70n * E18);
  assert.equal(withdrawableShares({ ...base, withdrawRound: 4n, withdrawShares: 100n * E18 }), 0n);
  assert.equal(withdrawableShares({ ...base, withdrawRound: 4n, withdrawShares: 150n * E18 }), 0n, "tidak pernah negatif");
});

test("batas setoran: tanpa batas, sisa ruang, dan sudah penuh", () => {
  assert.equal(capRoom(info, base), null);
  assert.equal(capRoom({ depositCap: 250n * E18 }, { managedAssets: 200n * E18, pendingDeposits: 20n * E18 }), 30n * E18);
  assert.equal(capRoom({ depositCap: 100n * E18 }, { managedAssets: 200n * E18, pendingDeposits: 0n }), 0n);
});

test("sharesToAssets: dibulatkan ke bawah seperti kontrak; vault kosong = 0", () => {
  assert.equal(sharesToAssets(10n, { totalShares: 3n, managedAssets: 10n }), 33n); // 10*10/3 = 33,33
  assert.equal(sharesToAssets(10n, { totalShares: 0n, managedAssets: 0n }), 0n);
});

test("withdraw: jumlah sama dengan nilai seluruh share bebas = tarik semua", () => {
  const p = planWithdraw(100n * E18, base);
  assert.deepEqual(p, { ok: true, shares: 100n * E18, all: true, estAssets: 100n * E18 });
});

test("withdraw: sebagian, dibulatkan ke bawah, tidak pernah melebihi share bebas", () => {
  const p = planWithdraw(40n * E18, base);
  assert.ok(p.ok && !p.all && p.shares === 40n * E18);
  // Harga per share 1,5 (managed 300, total 200): 10 token = 6,666... share, dibulatkan ke bawah.
  const s = { ...base, managedAssets: 300n * E18, shares: 100n * E18 };
  const q = planWithdraw(10n * E18, s);
  assert.ok(q.ok && q.shares === (10n * E18 * 200n * E18) / (300n * E18));
  if (q.ok) assert.ok(q.estAssets <= 10n * E18);
});

test("withdraw: lebih dari yang dimiliki, tanpa share, atau terlalu kecil ditolak", () => {
  assert.deepEqual(planWithdraw(100n * E18 + 1n, base), { ok: false, reason: "tooMuch" });
  assert.deepEqual(planWithdraw(1n, { ...base, shares: 0n }), { ok: false, reason: "noShares" });
  // Share yang sudah antre dikurangi dari yang bebas.
  assert.deepEqual(planWithdraw(1n, { ...base, withdrawRound: 4n, withdrawShares: 100n * E18 }), { ok: false, reason: "noShares" });
  assert.deepEqual(planWithdraw(80n * E18, { ...base, withdrawRound: 4n, withdrawShares: 30n * E18 }), { ok: false, reason: "tooMuch" });
  // Harga per share sangat tinggi: 1 wei token < 1 share.
  assert.deepEqual(planWithdraw(1n, { ...base, totalShares: 10n, managedAssets: 1000n, shares: 10n }), { ok: false, reason: "tooSmall" });
});

test("deposit: urutan pemeriksaan dan kebutuhan approve", () => {
  assert.deepEqual(checkDeposit(E18, info, { ...base, paused: true }), { ok: false, reason: "paused" });
  assert.deepEqual(checkDeposit(1n, info, base), { ok: false, reason: "tooSmall" });
  assert.deepEqual(checkDeposit(51n * E18, info, base), { ok: false, reason: "overBalance" });
  assert.deepEqual(checkDeposit(E18, { ...info, depositCap: 200n * E18 }, base), { ok: false, reason: "overCap" });
  assert.deepEqual(checkDeposit(E18, info, base), { ok: true, needsApproval: true });
  assert.deepEqual(checkDeposit(E18, info, { ...base, assetAllowance: E18 }), { ok: true, needsApproval: false });
  assert.deepEqual(checkDeposit(E18, info, { ...base, assetAllowance: E18 - 1n }), { ok: true, needsApproval: true });
  // Antrean setoran ikut dihitung terhadap batas.
  assert.deepEqual(checkDeposit(10n * E18, { ...info, depositCap: 205n * E18 }, { ...base, pendingDeposits: 0n }), { ok: false, reason: "overCap" });
  assert.deepEqual(checkDeposit(5n * E18, { ...info, depositCap: 205n * E18 }, base), { ok: true, needsApproval: true });
});

test("pesan error: setoran minimum menyebut angkanya; error tak dikenal tidak membocorkan detail", () => {
  assert.match(spurErrorMessage({ name: "DepositTooSmall" }, { minDeposit: 5n * 10n ** 17n, assetDecimals: 18, assetSymbol: "NVDA" }), /0\.5 NVDA/);
  assert.match(spurErrorMessage({ name: "EnforcedPause" }), /paused/i);
  assert.match(spurErrorMessage({ name: "NothingToCancel" }), /already been processed/);
  assert.match(spurErrorMessage({ name: "Unknown" }), /would fail on-chain/);
  assert.match(spurErrorMessage({ name: "NotAuction" }), /would fail on-chain/);
});
