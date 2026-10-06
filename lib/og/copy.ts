// Teks untuk gambar share dan OG. Murni (tanpa JSX) supaya bisa dites dan dipindai pagar copy.
// Angka selalu realized. Tidak pernah memuat nominal dolar atau alamat wallet.
import { pct } from "../format.ts";

export const OG_SIZE = { width: 1200, height: 630 } as const;
export const TAGLINE = "Plant stocks. Train them. Harvest weekly.";

export const harvestHeadline = (percent: number) => `My garden harvested ${pct(percent)} this week.`;
export const harvestSub = (round: number, isDemo: boolean) => `Realized, round #${round}${isDemo ? " · demo data" : ""}`;

export const wallHeadline = "My espalier";
export function wallStats(s: { positions: number; harvests: number; streak: number }): string[] {
  const n = (x: number, one: string, many: string) => `${x} ${x === 1 ? one : many}`;
  return [n(s.positions, "branch", "branches"), n(s.harvests, "Harvest", "Harvests"), s.streak > 0 ? `${s.streak}-week streak` : "No streak yet"];
}

// Gambar Harvest Card dan pohon bergantung pada siapa yang meminta: Wall privat hanya boleh dibuat untuk pemiliknya
// (cookie sesi). Respons seperti itu tidak boleh disimpan cache bersama (kunci CDN = URL, cookie diabaikan), jadi
// tidak "public" dan tidak "immutable". Gambar OG halaman detail (OG_CACHE) tidak bergantung pada penonton.
export const IMAGE_CACHE = "private, no-store";
// Gambar OG halaman detail: berubah lebih jarang daripada kartu mingguan, tetapi tetap bukan immutable.
export const OG_CACHE = "public, s-maxage=3600, stale-while-revalidate=86400";
