import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { harvestHeadline, harvestSub, IMAGE_CACHE, OG_CACHE, OG_SIZE, TAGLINE, wallStats } from "./copy.ts";

const root = join(import.meta.dirname, "..", "..");
const read = (f: string) => readFileSync(join(root, f), "utf8");

test("headline Harvest Card memakai tanda +/− dan dua desimal", () => {
  assert.equal(harvestHeadline(0.42), "My garden harvested +0.42% this week.");
  assert.equal(harvestHeadline(-0.1), "My garden harvested −0.10% this week.");
});
test("keterangan: realized, nomor round, label demo hanya bila demo", () => {
  assert.equal(harvestSub(4, true), "Realized, round #4 · demo data");
  assert.equal(harvestSub(4, false), "Realized, round #4");
});
test("hitungan The Wall: bentuk tunggal/jamak dan streak nol", () => {
  assert.deepEqual(wallStats({ positions: 1, harvests: 1, streak: 1 }), ["1 branch", "1 Harvest", "1-week streak"]);
  assert.deepEqual(wallStats({ positions: 3, harvests: 0, streak: 0 }), ["3 branches", "0 Harvests", "No streak yet"]);
});
test("ukuran gambar 1200×630 dan cache bukan immutable", () => {
  assert.deepEqual({ ...OG_SIZE }, { width: 1200, height: 630 });
  for (const c of [IMAGE_CACHE, OG_CACHE]) assert.doesNotMatch(c, /immutable/);
});
test("gambar Harvest Card dan pohon tidak boleh masuk cache bersama (bergantung pada cookie sesi)", () => {
  assert.match(IMAGE_CACHE, /\bprivate\b/);
  assert.match(IMAGE_CACHE, /\bno-store\b/);
  assert.doesNotMatch(IMAGE_CACHE, /\bpublic\b|s-maxage/);
});
test("teks gambar tidak memuat nominal dolar", () => {
  const all = [harvestHeadline(12.5), harvestSub(1, true), TAGLINE, ...wallStats({ positions: 2, harvests: 5, streak: 3 })].join(" ");
  assert.doesNotMatch(all, /\$|USD/);
});
test("sumber gambar tidak mengimpor usd() dan tidak menaruh alamat di teks", () => {
  for (const f of ["lib/og/images.tsx", "lib/og/copy.ts", "app/api/accounts/[address]/card.png/route.tsx", "app/api/accounts/[address]/wall.png/route.tsx"]) {
    const src = read(f);
    assert.doesNotMatch(src, /\busd\b/, `${f} memakai usd`);
    assert.doesNotMatch(src, /shortAddr|\{address\}|wall\.address/, `${f} menampilkan alamat di gambar`);
  }
});
