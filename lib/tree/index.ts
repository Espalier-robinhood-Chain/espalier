// Pohon espalier deterministik: input sama → output sama (server, browser, gambar share).
export type TreeShape = "tiers" | "fan" | "candelabra" | "belgian";
export type TreeInput = {
  address: string;
  totalValueUsd: number;
  positions: { id: string; weightBps: number }[];
  harvests: number; // jumlah Harvest yang diterima
  streak: number; // streak panen tanpa putus
};
type Pt = [number, number];
export type TreeBranch = { id: string; d: string; fruits: Pt[]; leaves: Pt[] };
export type Tree = { shape: TreeShape; viewBox: string; trunk: string; branches: TreeBranch[]; hiddenFruits: number };

export const MAX_FRUITS = 52;
const SHAPES: TreeShape[] = ["tiers", "fan", "candelabra", "belgian"];
const r1 = (n: number) => Math.round(n * 10) / 10;

function hash(s: string): number {
  let h = 2166136261;
  for (const c of s.toLowerCase()) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  return h >>> 0;
}
function rng(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function generateTree(input: TreeInput): Tree {
  const seed = hash(input.address);
  const rand = rng(seed);
  const shape = SHAPES[seed % 4];
  const H = 300;
  const trunkH = 90 + 150 * Math.min(1, Math.log10(Math.max(input.totalValueUsd, 1)) / 6); // skala log
  const top = H - trunkH;
  const n = input.positions.length;
  const maxW = Math.max(1, ...input.positions.map((p) => p.weightBps));

  const geo = input.positions.map((p, i) => {
    const t = n === 1 ? 0.5 : i / (n - 1);
    const dir = i % 2 === 0 ? 1 : -1;
    const len = 35 + 105 * (p.weightBps / maxW);
    let s: Pt = [150, H - 10 - (trunkH - 20) * (0.2 + 0.75 * t)];
    let e: Pt = [150 + dir * len, s[1]];
    let d = `M${r1(s[0])} ${r1(s[1])}H${r1(e[0])}`;
    if (shape === "candelabra") d += `V${r1(e[1] - 28)}`;
    if (shape === "belgian") { e = [150 + dir * len * 0.87, s[1] - len * 0.5]; d = `M${r1(s[0])} ${r1(s[1])}L${r1(e[0])} ${r1(e[1])}`; }
    if (shape === "fan") {
      const a = (t - 0.5) * 2 * 1.2;
      s = [150, top + 30];
      e = [150 + len * Math.sin(a), s[1] - len * Math.cos(a)];
      d = `M${r1(s[0])} ${r1(s[1])}L${r1(e[0])} ${r1(e[1])}`;
    }
    return { id: p.id, s, e, d };
  });

  const branches: TreeBranch[] = geo.map((g) => ({ id: g.id, d: g.d, fruits: [], leaves: [] }));
  const at = (g: (typeof geo)[number], u: number, jitter: number): Pt => [
    r1(g.s[0] + (g.e[0] - g.s[0]) * u + (rand() - 0.5) * jitter),
    r1(g.s[1] + (g.e[1] - g.s[1]) * u + (rand() - 0.5) * jitter),
  ];
  if (n > 0) {
    const fruits = Math.min(Math.max(input.harvests, 0), MAX_FRUITS);
    for (let k = 0; k < fruits; k++) branches[k % n].fruits.push(at(geo[k % n], 0.3 + 0.65 * rand(), 0));
    const leaves = Math.min(Math.max(input.streak, 0) * 3, 60);
    for (let k = 0; k < leaves; k++) branches[k % n].leaves.push(at(geo[k % n], 0.15 + 0.8 * rand(), 12));
  }
  return {
    shape, viewBox: `0 0 300 ${H}`, trunk: `M150 ${H - 10}V${r1(top)}`, branches,
    hiddenFruits: Math.max(0, input.harvests - MAX_FRUITS),
  };
}

// SVG mandiri (string) dari pohon yang sama, dengan warna konkret: tanpa CSS variable dan tanpa <text>.
// Dipakai route handler gambar (next/og memrasterkan SVG di dalam <img>, yang tidak mengenal var(--…) maupun font halaman).
// Bentuk dan lebar garis disamakan dengan komponen WallTree; ringkasan "+N" buah tersembunyi dirender pemanggil.
export type TreePalette = { bark: string; leaf: string; fruit: string };
export function treeSvg(tree: Tree, p: TreePalette): string {
  const parts = [`<svg xmlns="http://www.w3.org/2000/svg" viewBox="${tree.viewBox}" fill="none" stroke-linecap="round">`,
    `<path d="${tree.trunk}" stroke="${p.bark}" stroke-width="2"/>`];
  for (const b of tree.branches) {
    parts.push(`<path d="${b.d}" stroke="${p.bark}" stroke-width="1.5"/>`);
    for (const [x, y] of b.leaves) parts.push(`<ellipse cx="${x}" cy="${y}" rx="5" ry="2.5" fill="${p.leaf}" fill-opacity=".55" stroke="${p.leaf}" stroke-width=".5"/>`);
    for (const [x, y] of b.fruits) parts.push(`<circle cx="${x}" cy="${y}" r="3.5" fill="${p.fruit}" stroke="${p.bark}" stroke-width=".75"/>`);
  }
  parts.push("</svg>");
  return parts.join("");
}
