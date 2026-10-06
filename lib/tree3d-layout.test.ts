import test from "node:test";
import assert from "node:assert/strict";
import { generateTree, type TreeInput } from "./tree/index.ts";
import { layoutTree3D, MAX_CORDONS_3D } from "./tree3d-layout.ts";

const base: TreeInput = {
  address: "0x0000000000000000000000000000000000000003", totalValueUsd: 1_000_000, harvests: 14, streak: 5,
  positions: [{ id: "cMAG7", weightBps: 5500 }, { id: "sNVDA", weightBps: 3000 }, { id: "gNVDA", weightBps: 1500 }],
};

test("satu cordon per posisi, bergantian kanan-kiri, naik per dua cordon", () => {
  const l = layoutTree3D(base);
  assert.deepEqual(l.cordons.map((c) => c.id), ["cMAG7", "sNVDA", "gNVDA"]);
  assert.deepEqual(l.cordons.map((c) => c.dir), [1, -1, 1]);
  assert.equal(l.tierYs.length, 2);
  assert.equal(l.cordons[0].y, l.cordons[1].y);
  assert.ok(l.cordons[2].y > l.cordons[0].y);
});

test("jumlah buah sama dengan pohon SVG dan tidak melebihi Harvest", () => {
  const l = layoutTree3D(base);
  const svg = generateTree(base);
  assert.deepEqual(l.cordons.map((c) => c.fruits), svg.branches.map((b) => b.fruits.length));
  assert.equal(l.cordons.reduce((a, c) => a + c.fruits, 0), 14);
});

test("buah dibatasi MAX_FRUITS dan sisanya dihitung tersembunyi", () => {
  const l = layoutTree3D({ ...base, harvests: 80 });
  assert.equal(l.cordons.reduce((a, c) => a + c.fruits, 0), 52);
  assert.equal(l.hiddenFruits, 28);
});

test("cordon terpanjang untuk bobot terbesar; panjang dalam batas dinding", () => {
  const l = layoutTree3D(base);
  assert.ok(l.cordons[0].len > l.cordons[1].len && l.cordons[1].len > l.cordons[2].len);
  for (const c of l.cordons) assert.ok(c.len >= 1.2 && c.len <= 2.9);
});

test("tanpa posisi: tidak ada cordon dan tidak error", () => {
  const l = layoutTree3D({ ...base, positions: [] });
  assert.equal(l.cordons.length, 0);
  assert.equal(l.tierYs.length, 1);
});

const many = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `p${i}`, weightBps: 1000 + i }));

test("lebih dari 8 posisi sekarang digambar: satu cordon per posisi sampai MAX_CORDONS_3D", () => {
  for (const n of [9, 12, 17, MAX_CORDONS_3D]) {
    const l = layoutTree3D({ ...base, positions: many(n) });
    assert.equal(l.cordons.length, n, `n=${n}`);
    assert.equal(l.tierYs.length, Math.ceil(n / 2));
    assert.equal(l.hiddenCordons, 0);
    assert.equal(l.cordons.reduce((a, c) => a + c.fruits, 0), 14); // buah tidak hilang
  }
});

test("posisi di atas MAX_CORDONS_3D dihitung di hiddenCordons, bukan hilang diam-diam", () => {
  const l = layoutTree3D({ ...base, positions: many(MAX_CORDONS_3D + 5) });
  assert.equal(l.cordons.length, MAX_CORDONS_3D);
  assert.equal(l.hiddenCordons, 5);
});

test("kawat rapat tetap terpisah, naik, dan di dalam dinding; buah tidak menimpa kawat berikutnya", () => {
  for (const n of [9, 12, 16, MAX_CORDONS_3D]) {
    const l = layoutTree3D({ ...base, positions: many(n) });
    for (let i = 1; i < l.tierYs.length; i++) {
      const gap = l.tierYs[i] - l.tierYs[i - 1];
      assert.ok(gap >= 0.4, `n=${n} gap=${gap}`);
      // buah menggantung 0.2*scale + jari-jari 0.1*scale di bawah cordon; harus muat di bawah jarak antar kawat
      assert.ok(0.3 * l.scale + 0.04 < gap, `n=${n} fruit overlap gap=${gap} scale=${l.scale}`);
    }
    assert.ok(l.tierYs[0] > -2.9 && l.trunkTop < 3.2, `n=${n} range ${l.tierYs[0]}..${l.trunkTop}`);
    assert.ok(l.cordons.every((c) => c.y >= l.tierYs[0] && c.y <= l.tierYs[l.tierYs.length - 1]));
  }
});

test("sampai 8 posisi bentuk lama tidak berubah (skala 1, tingkat -1.8 sampai 1.0, batang 2.35)", () => {
  const l = layoutTree3D({ ...base, positions: many(8) });
  assert.equal(l.scale, 1);
  assert.ok(Math.abs(l.tierYs[0] + 1.8) < 1e-9 && Math.abs(l.tierYs[3] - 1.0) < 1e-9);
  assert.ok(Math.abs(l.trunkTop - 2.35) < 1e-9);
});

test("daun per cordon dikurangi di atas 8 cordon, tidak kurang dari 6, jumlah mesh daun terbatas", () => {
  const l8 = layoutTree3D({ ...base, streak: 20, positions: many(8) });
  const l20 = layoutTree3D({ ...base, streak: 20, positions: many(20) });
  assert.equal(l8.cordons[0].leaves, 24);
  assert.ok(l20.cordons[0].leaves >= 6 && l20.cordons[0].leaves < 24);
  assert.ok(l20.cordons.reduce((a, c) => a + c.leaves, 0) <= 24 * 8 + 20); // tidak lebih dari beban 8 cordon (+ pembulatan)
});

test("deterministik", () => {
  assert.deepEqual(layoutTree3D(base), layoutTree3D(base));
});
