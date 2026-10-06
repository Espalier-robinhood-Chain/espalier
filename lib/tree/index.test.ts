import test from "node:test";
import assert from "node:assert/strict";
import { generateTree, MAX_FRUITS, treeSvg, type TreeInput } from "./index.ts";

const base: TreeInput = {
  address: "0xAbC0000000000000000000000000000000000001", totalValueUsd: 12_500,
  positions: [{ id: "cMAG7", weightBps: 6000 }, { id: "sNVDA", weightBps: 4000 }], harvests: 9, streak: 4,
};

test("input sama → pohon identik", () => assert.deepEqual(generateTree(base), generateTree({ ...base })));
test("huruf besar/kecil alamat tidak mengubah hasil", () =>
  assert.deepEqual(generateTree(base), generateTree({ ...base, address: base.address.toLowerCase() })));
test("alamat berbeda → bentuk bisa berbeda, keempat bentuk tercapai", () => {
  const shapes = new Set(Array.from({ length: 64 }, (_, i) => generateTree({ ...base, address: `0x${i}` }).shape));
  assert.equal(shapes.size, 4);
});
test("maks. 52 buah terlihat, sisanya diringkas", () => {
  const t = generateTree({ ...base, harvests: 80 });
  assert.equal(t.branches.reduce((a, b) => a + b.fruits.length, 0), MAX_FRUITS);
  assert.equal(t.hiddenFruits, 28);
});
test("tanpa posisi → hanya batang, tidak error", () => assert.equal(generateTree({ ...base, positions: [] }).branches.length, 0));

const pal = { bark: "#5a4636", leaf: "#2f4a3a", fruit: "#c9a227" };
test("treeSvg: deterministik, tanpa var(--) dan tanpa <text>", () => {
  const a = treeSvg(generateTree(base), pal);
  assert.equal(a, treeSvg(generateTree({ ...base }), pal));
  assert.doesNotMatch(a, /var\(|<text/);
  assert.match(a, /^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg" viewBox="0 0 300 300"/);
});
test("treeSvg: memuat semua path, buah, dan daun dari pohon", () => {
  const t = generateTree(base), svg = treeSvg(t, pal);
  for (const d of [t.trunk, ...t.branches.map((b) => b.d)]) assert.ok(svg.includes(`d="${d}"`), d);
  assert.equal(svg.match(/<circle /g)?.length ?? 0, t.branches.reduce((n, b) => n + b.fruits.length, 0));
  assert.equal(svg.match(/<ellipse /g)?.length ?? 0, t.branches.reduce((n, b) => n + b.leaves.length, 0));
});
test("treeSvg: tanpa posisi hanya batang", () => {
  const svg = treeSvg(generateTree({ ...base, positions: [] }), pal);
  assert.equal(svg.match(/<path /g)?.length, 1);
});
