import { readFile } from "node:fs/promises";
import { join } from "node:path";

// Satori hanya membaca ttf/otf/woff (bukan woff2), jadi font gambar adalah ttf statis hasil instansiasi
// dari font variabel yang sama dengan situs (lihat assets/og-fonts/README.md). Dibaca lewat process.cwd()
// dengan path literal supaya ikut terlacak saat deploy.
type Font = { name: string; data: ArrayBuffer; weight: 400 | 500 | 600; style: "normal" };
let cache: Promise<Font[]> | null = null;

const load = async (file: string) => {
  const b = await readFile(join(process.cwd(), "assets/og-fonts", file));
  return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;
};

export function ogFonts(): Promise<Font[]> {
  if (!cache) {
    const p: Promise<Font[]> = Promise.all([
      load("Fraunces-Regular.ttf"), load("Inter-Regular.ttf"), load("Inter-SemiBold.ttf"), load("JetBrainsMono-Medium.ttf"),
    ]).then(([fr, i4, i6, jb]): Font[] => [
      { name: "Fraunces", data: fr, weight: 400, style: "normal" },
      { name: "Inter", data: i4, weight: 400, style: "normal" },
      { name: "Inter", data: i6, weight: 600, style: "normal" },
      { name: "JetBrains Mono", data: jb, weight: 500, style: "normal" },
    ]);
    p.catch(() => { if (cache === p) cache = null; }); // gagal baca: coba lagi di permintaan berikutnya
    cache = p;
  }
  return cache;
}
