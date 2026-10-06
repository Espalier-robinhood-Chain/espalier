import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

// Pagar copy untuk halaman legal dan sistem (Fase 1 item 18). Memeriksa teks sumber, bukan hasil render.
const root = join(import.meta.dirname, "..", "..");
const copyFiles = [
  "app/terms/page.tsx", "app/privacy/page.tsx", "app/restricted/page.tsx",
  "app/not-found.tsx", "app/error.tsx", "app/global-error.tsx",
  "components/legal.tsx", "components/garden-art.tsx", "app/page.tsx", "components/way-art.tsx", "app/cordons/page.tsx", "app/cordons/[symbol]/page.tsx", "app/vaults/page.tsx", "app/vaults/[symbol]/page.tsx", "app/wall/page.tsx", "app/docs/page.tsx", "components/share-actions.tsx", "components/sparkline.tsx",
  // gambar share dan OG (Fase 1 item 21)
  "lib/og/copy.ts", "lib/og/images.tsx", "app/opengraph-image.tsx",
  "app/cordons/[symbol]/opengraph-image.tsx", "app/vaults/[symbol]/opengraph-image.tsx",
];
const linkFiles = [...copyFiles, "components/layout-parts.tsx"];
const read = (f: string) => readFileSync(join(root, f), "utf8");

test("guardrail penamaan: tanpa kata terlarang", () => {
  const banned = /\b(ETF|funds?|index fund|guarantee[ds]?|risk-free|savings?|interest)\b/i;
  for (const f of copyFiles) assert.doesNotMatch(read(f), banned, `${f} memuat kata terlarang`);
});

// Daftar `copyFiles` dipilih manual, sehingga copy baru di file lain lolos (kata "Funds" di trade-panels.tsx
// pernah lolos). Pemindaian ini mencakup SEMUA .tsx di app/ dan components/ (brief §1: kata terlarang
// tidak boleh ada di nama produk, ticker, atau copy utama).
test("guardrail penamaan: seluruh file UI (app/ dan components/) bebas kata terlarang", () => {
  const banned = /\b(ETF|funds?|index fund|guarantee[ds]?|risk-free|savings?|interest)\b/i;
  const files = ["app", "components"].flatMap((dir) =>
    (readdirSync(join(root, dir), { recursive: true }) as string[])
      .filter((f) => f.endsWith(".tsx") && !f.includes(".test."))
      .map((f) => join(dir, f)),
  );
  assert.ok(files.length > 40, `pemindaian harus mencakup banyak file (dapat ${files.length})`);
  for (const f of files) assert.doesNotMatch(read(f), banned, `${f} memuat kata terlarang`);
});

test("guardrail brand: tanpa nama penerbit Stock Token atau USDG", () => {
  const issuers = /(robinhood|paxos|bbvi|jersey|\bRHJ\b)/i;
  for (const f of copyFiles) assert.doesNotMatch(read(f), issuers, `${f} menyebut nama penerbit`);
});

test("semua tautan internal menuju halaman yang ada", () => {
  const hrefs = /(?:href=|\[)"(\/[^"#?]*)/g;
  for (const f of linkFiles) {
    for (const m of read(f).matchAll(hrefs)) {
      const path = m[1].replace(/\/$/, "");
      const page = path === "" ? "app/page.tsx" : `app${path}/page.tsx`;
      assert.ok(existsSync(join(root, page)), `${f}: tautan ${m[1]} tidak punya ${page}`);
    }
  }
});

test("halaman legal punya id bagian unik", () => {
  for (const f of ["app/terms/page.tsx", "app/privacy/page.tsx", "app/restricted/page.tsx"]) {
    const ids = [...read(f).matchAll(/^\s+id: "([a-z-]+)",$/gm)].map((m) => m[1]);
    assert.ok(ids.length >= 5, `${f}: bagian terlalu sedikit`);
    assert.equal(new Set(ids).size, ids.length, `${f}: id bagian ganda`);
  }
});
