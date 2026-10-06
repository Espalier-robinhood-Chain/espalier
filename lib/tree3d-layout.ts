// Tata letak pohon 3D dari TreeInput yang sama dengan pohon SVG: satu cordon per posisi, satu buah per Harvest
// (maks MAX_FRUITS), daun bertambah bersama streak. Deterministik dan murni, tanpa three.js, jadi bisa diuji.
// Satuan = unit dunia three.js (dinding ±4.3, tinggi pohon sekitar 5).
import { MAX_FRUITS, type TreeInput } from "./tree/index.ts";

export const MAX_CORDONS_3D = 20; // 10 tingkat kawat. Di atas ini sisanya dihitung di hiddenCordons, bukan dibuang diam-diam.
export const GROUND_Y = -2.95;
const TIER_CENTER = -0.4; // pusat vertikal kawat; sama dengan susunan lama untuk 1 sampai 4 tingkat
const SPAN_SPARSE = 2.8; // rentang kawat untuk <= 4 tingkat (susunan lama, tidak berubah)
const SPAN_DENSE = 3.7; // rentang kawat untuk >= 5 tingkat: tingkat dirapatkan, bukan ditambah tinggi
const REF_GAP = SPAN_SPARSE / 3; // jarak antar kawat pada 4 tingkat; ukuran daun dan buah 1.0 di jarak ini

export type Cordon3D = { id: string; dir: 1 | -1; y: number; len: number; fruits: number; leaves: number };
// scale: pengali ukuran daun, buah, dan gantungannya; mengecil bila kawat dirapatkan supaya buah tidak menimpa kawat di bawahnya.
export type Layout3D = { cordons: Cordon3D[]; tierYs: number[]; trunkTop: number; scale: number; hiddenFruits: number; hiddenCordons: number; seed: number };

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

export function hashSeed(s: string): number {
  let h = 2166136261;
  for (const c of s.toLowerCase()) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  return h >>> 0;
}

export function layoutTree3D(input: TreeInput): Layout3D {
  const pos = input.positions.slice(0, MAX_CORDONS_3D);
  const n = pos.length;
  const tiers = Math.max(1, Math.ceil(n / 2));
  const span = tiers <= 4 ? SPAN_SPARSE : SPAN_DENSE;
  const tierYs = Array.from({ length: tiers }, (_, i) => (tiers === 1 ? TIER_CENTER : TIER_CENTER - span / 2 + (span * i) / (tiers - 1)));
  const gap = tiers === 1 ? REF_GAP : span / (tiers - 1);
  const scale = Math.round(clamp(gap / REF_GAP, 0.5, 1) * 1000) / 1000;
  const maxW = Math.max(1, ...pos.map((p) => p.weightBps));
  const fruitTotal = Math.min(Math.max(input.harvests, 0), MAX_FRUITS);
  // Di atas 8 cordon, daun per cordon dikurangi (jumlah mesh tetap terkendali), tidak kurang dari 6.
  const leaves = Math.max(6, Math.round(Math.min(24, 6 + 2 * Math.max(input.streak, 0)) * Math.min(1, 8 / Math.max(n, 1))));
  const cordons: Cordon3D[] = pos.map((p, i) => ({
    id: p.id,
    dir: i % 2 === 0 ? 1 : -1,
    y: tierYs[Math.floor(i / 2)],
    len: 1.2 + 1.7 * (Math.max(p.weightBps, 0) / maxW),
    // round-robin seperti generateTree: cordon ke-i mendapat buah ke-i, i+n, i+2n, ...
    fruits: n === 0 ? 0 : Math.floor(fruitTotal / n) + (i < fruitTotal % n ? 1 : 0),
    leaves,
  }));
  const trunkTop = tierYs[tierYs.length - 1] + (tiers <= 4 ? 1.35 : 0.9);
  return { cordons, tierYs, trunkTop, scale, hiddenFruits: Math.max(0, input.harvests - MAX_FRUITS), hiddenCordons: Math.max(0, input.positions.length - MAX_CORDONS_3D), seed: hashSeed(input.address) };
}
