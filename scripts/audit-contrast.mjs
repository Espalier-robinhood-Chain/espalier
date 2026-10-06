// Hitung rasio kontras WCAG untuk pasangan token di app/globals.css (terang dan gelap).
// Jalankan: node scripts/audit-contrast.mjs   (keluar dengan kode 1 bila ada pasangan yang gagal)
import { readFileSync } from "node:fs";

const css = readFileSync(new URL("../app/globals.css", import.meta.url), "utf8");
const grab = (block) => Object.fromEntries([...block.matchAll(/--([a-z0-9-]+):\s*(#[0-9a-fA-F]{6})/g)].map((m) => [m[1], m[2]]));
const light = grab(css.match(/:root\s*\{([^}]*)\}/)[1]);
const dark = grab(css.match(/:root\[data-theme="dark"\]\s*\{([^}]*)\}/)[1]);

const rgb = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
const hex = (a) => "#" + a.map((v) => Math.round(v).toString(16).padStart(2, "0")).join("");
const mix = (fg, bg, a) => hex(rgb(fg).map((v, i) => v * a + rgb(bg)[i] * (1 - a)));
const lum = (h) => { const c = rgb(h).map((v) => v / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)); return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]; };
const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };

// [depan, latar, minimum, keterangan]. Teks 4.5, batas komponen UI dan grafik 3.
// --fruit dan --wire sengaja tidak dipakai sebagai teks (aturan di globals.css); --fruit hanya dicek terhadap gelap karena isian/ikon.
const checks = [
  ["ink", "wall", 4.5, "teks utama"], ["ink", "panel", 4.5, "teks utama di panel"],
  ["bark", "wall", 4.5, "teks sekunder"], ["bark", "panel", 4.5, "teks sekunder di panel"], ["bark", "panel-2", 4.5, "teks sekunder di panel-2"],
  ["leaf", "wall", 4.5, "teks/tautan leaf"], ["leaf", "panel", 4.5, "teks leaf di panel"],
  ["blight", "wall", 4.5, "teks error"], ["blight", "panel", 4.5, "teks error di panel"],
  ["on-leaf", "leaf", 4.5, "teks di tombol/kartu leaf"],
  ["leaf", "wall", 3, "fokus (outline leaf)"],
];
// Teks dengan opasitas dan batas kolom input (dipakai di trade-panels.tsx dan wall/page.tsx).
const blended = (t) => [
  [mix(t.bark, t.wall, 0.7), t.wall, 3, "batas kolom input (border-bark/70)"],
  [mix(t.bark, t.wall, 0.8), t.wall, 4.5, "placeholder (text-bark/80)"],
  [mix(t["on-leaf"], t.leaf, 0.8), t.leaf, 4.5, "teks kartu Harvest (opacity .80)"],
];

let fail = 0;
for (const [name, t] of [["terang", light], ["gelap", dark]]) {
  const rows = [...checks.map(([f, b, min, why]) => [t[f], t[b], min, why, `${f} / ${b}`]), ...blended(t).map(([f, b, min, why]) => [f, b, min, why, ""])];
  for (const [f, b, min, why, label] of rows) {
    const r = ratio(f, b); const ok = r >= min; if (!ok) fail++;
    console.log(`${ok ? "OK    " : "GAGAL "} ${name.padEnd(6)} ${r.toFixed(2).padStart(5)} (min ${min}) ${why}${label ? ` [${label}]` : ""}`);
  }
}
process.exit(fail ? 1 : 0);
