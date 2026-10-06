// Tes browser untuk jalur pohon 3D (Chromium via Playwright). Jalankan terhadap build yang sedang hidup:
//   npm run build && ENABLE_DEV_PAGES=1 npm run start      # http://localhost:3000
//   BASE_URL=http://localhost:3000 node scripts/e2e-tree3d.mjs
// Butuh `playwright` terpasang global (seperti e2e-live.mjs). WebGL memakai SwiftShader supaya jalan tanpa GPU.
import { chromium } from "playwright";

const BASE = process.env.BASE_URL ?? "http://localhost:3000";
const HOST = '[role="img"][data-tree-ready]'; // elemen host milik tree-3d-scene.ts
const GL_ARGS = ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"];

let failed = 0;
const results = [];
async function test(name, fn) {
  try { await fn(); results.push(["ok", name]); }
  catch (e) { failed++; results.push(["FAIL", name, String(e?.message ?? e).split("\n")[0]]); }
}
const eq = (a, b, m) => { if (a !== b) throw new Error(`${m}: dapat ${a}, harap ${b}`); };
const ok = (c, m) => { if (!c) throw new Error(m); };

async function open(browser, path, { reduced = false, noWebGL = false, dark = false } = {}) {
  const ctx = await browser.newContext({ viewport: { width: 1100, height: 900 }, reducedMotion: reduced ? "reduce" : "no-preference", colorScheme: dark ? "dark" : "light" });
  if (noWebGL) await ctx.addInitScript(() => {
    const g = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (t, ...a) { return /webgl/i.test(t) ? null : g.call(this, t, ...a); };
  });
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
  page.on("console", (m) => { if (m.type() === "error") errors.push(`console: ${m.text()}`); });
  await page.goto(BASE + path, { waitUntil: "load" });
  return { ctx, page, errors };
}
const ready = (page) => page.waitForSelector(`${HOST}[data-tree-ready="1"]`, { timeout: 20000 });
const attr = (page, n) => page.locator(HOST).getAttribute(n);

// Proporsi piksel kanvas yang berbeda dari warna sudut (kanvas transparan, jadi diukur dari tangkapan layar elemen).
async function paintedRatio(page) {
  const png = (await page.locator(`${HOST} canvas`).screenshot()).toString("base64");
  return page.evaluate(async (b64) => {
    const bmp = await createImageBitmap(await (await fetch(`data:image/png;base64,${b64}`)).blob());
    const c = new OffscreenCanvas(bmp.width, bmp.height), x = c.getContext("2d"); x.drawImage(bmp, 0, 0);
    const d = x.getImageData(0, 0, bmp.width, bmp.height).data; let diff = 0;
    for (let i = 0; i < d.length; i += 4) if (Math.abs(d[i] - d[0]) + Math.abs(d[i + 1] - d[1]) + Math.abs(d[i + 2] - d[2]) > 40) diff++;
    return diff / (d.length / 4);
  }, png);
}

const browser = await chromium.launch({ args: GL_ARGS });

await test("Landing: 3D tampil, 3 cordon, SVG disembunyikan setelah frame pertama", async () => {
  const { ctx, page, errors } = await open(browser, "/");
  await ready(page);
  eq(await attr(page, "data-cordons"), "3", "cordon");
  eq(await attr(page, "data-tiers"), "2", "tingkat");
  eq(await page.locator(`${HOST} canvas`).count(), 1, "jumlah canvas");
  ok((await paintedRatio(page)) > 0.01, "kanvas kosong");
  ok(await page.locator("div.opacity-0 svg").count() > 0, "pembungkus SVG belum opacity-0");
  eq(errors.length, 0, `error konsol: ${errors.join(" | ")}`);
  await ctx.close();
});

// Inti pekerjaan "posisi di atas 8": jumlah cordon di scene sama dengan jumlah posisi, bukan dipotong di 8.
for (const [n, tiers] of [[8, 4], [9, 5], [12, 6], [20, 10]]) {
  await test(`/dev/tree3d?n=${n}: ${n} cordon, ${tiers} tingkat, tergambar`, async () => {
    const { ctx, page, errors } = await open(browser, `/dev/tree3d?n=${n}`);
    await ready(page);
    eq(await attr(page, "data-cordons"), String(n), "cordon di scene");
    eq(await attr(page, "data-tiers"), String(tiers), "tingkat");
    ok((await paintedRatio(page)) > 0.01, "kanvas kosong");
    ok(!/not drawn/.test((await page.locator(HOST).getAttribute("aria-label")) ?? ""), "label menyebut cordon tak tergambar padahal semua tergambar");
    eq(errors.length, 0, `error konsol: ${errors.join(" | ")}`);
    await ctx.close();
  });
}

await test("25 posisi: 20 tergambar, label menyebut 5 yang tidak", async () => {
  const { ctx, page } = await open(browser, "/dev/tree3d?n=25");
  await ready(page);
  eq(await attr(page, "data-cordons"), "20", "cordon");
  ok(/5 cordons not drawn/.test((await page.locator(HOST).getAttribute("aria-label")) ?? ""), "aria-label");
  await ctx.close();
});

await test("tanpa posisi: tidak error, kanvas tetap muncul", async () => {
  const { ctx, page, errors } = await open(browser, "/dev/tree3d?n=0");
  await ready(page);
  eq(await attr(page, "data-cordons"), "0", "cordon");
  eq(errors.length, 0, `error konsol: ${errors.join(" | ")}`);
  await ctx.close();
});

await test("WebGL tidak ada: pohon SVG tampil, tidak ada canvas, tidak ada error", async () => {
  const { ctx, page, errors } = await open(browser, "/dev/tree3d?n=12", { noWebGL: true });
  await page.waitForTimeout(3000); // lewati batas idle (maks 2 dtk)
  eq(await page.locator("canvas").count(), 0, "canvas");
  ok(await page.locator("svg").count() > 0, "SVG cadangan tidak ada");
  eq(errors.length, 0, `error konsol: ${errors.join(" | ")}`);
  await ctx.close();
});

await test("konteks WebGL hilang: kembali ke SVG", async () => {
  const { ctx, page } = await open(browser, "/dev/tree3d?n=12");
  await ready(page);
  await page.evaluate(() => document.querySelector('[data-tree-ready] canvas').getContext("webgl2")?.getExtension("WEBGL_lose_context")?.loseContext());
  await page.waitForFunction(() => !document.querySelector("canvas"), null, { timeout: 5000 }); // scene dibuang
  ok(await page.locator("svg:visible").count() > 0, "pohon SVG cadangan tidak tampil");
  await ctx.close();
});

await test("reduced-motion: gambar utuh langsung, tanpa tombol 'Grow again'", async () => {
  const { ctx, page } = await open(browser, "/dev/tree3d?n=12", { reduced: true });
  await ready(page);
  eq(await page.getByRole("button", { name: "Grow again" }).count(), 0, "tombol");
  ok((await paintedRatio(page)) > 0.01, "kanvas kosong");
  await ctx.close();
});

await test("'Grow again' menumbuhkan ulang tanpa error", async () => {
  const { ctx, page, errors } = await open(browser, "/dev/tree3d?n=12");
  await ready(page);
  await page.getByRole("button", { name: "Grow again" }).click();
  await page.waitForTimeout(600);
  ok((await paintedRatio(page)) > 0.0, "kanvas hilang");
  eq(errors.length, 0, `error konsol: ${errors.join(" | ")}`);
  await ctx.close();
});

await test("tema gelap mengubah tampilan", async () => {
  const { ctx, page } = await open(browser, "/dev/tree3d?n=12", { reduced: true });
  await ready(page);
  const before = (await page.locator(HOST).screenshot()).toString("base64");
  await page.evaluate(() => { document.documentElement.dataset.theme = "dark"; });
  await page.waitForTimeout(500);
  ok((await page.locator(HOST).screenshot()).toString("base64") !== before, "tangkapan layar sama setelah ganti tema");
  await ctx.close();
});

await test("seret memutar pohon", async () => {
  const { ctx, page } = await open(browser, "/dev/tree3d?n=12", { reduced: true });
  await ready(page);
  const before = (await page.locator(HOST).screenshot()).toString("base64");
  const b = await page.locator(HOST).boundingBox();
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2); await page.mouse.down();
  await page.mouse.move(b.x + b.width / 2 + 160, b.y + b.height / 2, { steps: 8 }); await page.mouse.up();
  await page.waitForTimeout(300);
  ok((await page.locator(HOST).screenshot()).toString("base64") !== before, "tidak berubah setelah seret");
  await ctx.close();
});

await test("pindah halaman membuang scene (tidak ada canvas tertinggal)", async () => {
  const { ctx, page } = await open(browser, "/dev/tree3d?n=12");
  await ready(page);
  await page.goto(BASE + "/docs", { waitUntil: "load" });
  eq(await page.locator("canvas").count(), 0, "canvas tertinggal");
  await ctx.close();
});

await browser.close();
for (const r of results) console.log(r[0] === "ok" ? "ok   " : "FAIL ", r[1], r[2] ? `\n      ${r[2]}` : "");
console.log(`\n${results.length - failed}/${results.length} lulus`);
process.exit(failed ? 1 : 0);
