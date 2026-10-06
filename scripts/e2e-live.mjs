// Uji ujung-ke-ujung pembaruan langsung (Fase 1 item 20) dengan Chromium sungguhan.
// Menyalakan scripts/fake-supabase.mjs dan `next start`, lalu mengubah data lewat endpoint admin dan memeriksa
// bahwa halaman Cordon dan vault ikut berubah TANPA muat ulang.
//
// Prasyarat:
//   1. Build dengan env palsu:   NEXT_PUBLIC_SUPABASE_URL=http://localhost:4010 \
//                                NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=fake npx next build
//   2. Playwright + Chromium terpasang (tidak jadi dependensi repo): npm i -g playwright && npx playwright install chromium
//   3. Opsional: axe-core terpasang (npm i -g axe-core) untuk pemeriksaan aksesibilitas.
//   node scripts/e2e-live.mjs
import { spawn, execSync } from "node:child_process";
import { createRequire } from "node:module";
import { existsSync } from "node:fs";
import { join } from "node:path";

const require = createRequire(import.meta.url);
const globalRoot = (() => { try { return execSync("npm root -g").toString().trim(); } catch { return ""; } })();
const load = (name) => { try { return require(name); } catch { return require(join(globalRoot, name)); } };
const { chromium } = load("playwright");
const axePath = (() => { try { return require.resolve("axe-core/axe.min.js"); } catch { const p = join(globalRoot, "axe-core/axe.min.js"); return existsSync(p) ? p : null; } })();

const FAKE = "http://localhost:4010", APP = "http://localhost:3100";
const ID = { cordon: "11111111-1111-4111-8111-111111111111", vault: "33333333-3333-4333-8333-333333333333" };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const admin = (op, body = {}) => fetch(`${FAKE}/__admin/${op}`, { method: "POST", body: JSON.stringify(body) }).then((r) => r.json());
const stats = () => fetch(`${FAKE}/__admin/stats`).then((r) => r.json());
const insertNav = (nav, cordon = ID.cordon, ts = new Date().toISOString()) =>
  admin("mutate", { op: "insert", table: "nav_points", row: { cordon_id: cordon, ts, nav_per_share: nav, total_supply: 1000, tvl_usd: nav * 1000 } });

const children = [];
const start = (cmd, args, opts) => { const c = spawn(cmd, args, { stdio: "ignore", ...opts }); children.push(c); return c; };
async function waitFor(url, ms = 30000) {
  const t = Date.now();
  while (Date.now() - t < ms) { try { if ((await fetch(url)).status < 500) return; } catch { /* belum siap */ } await sleep(300); }
  throw new Error(`timeout menunggu ${url}`);
}

const results = [];
async function step(name, fn) {
  try { await fn(); results.push([true, name]); console.log(`  ok   ${name}`); }
  catch (e) { results.push([false, name, e.message]); console.log(`  FAIL ${name}\n       ${e.message.split("\n")[0]}`); }
}
function check(cond, msg) { if (!cond) throw new Error(msg); }

async function open(browser, path, { clock = false, width = 1280 } = {}) {
  const ctx = await browser.newContext({ viewport: { width, height: 900 } });
  const page = await ctx.newPage();
  const problems = [];
  page.on("pageerror", (e) => problems.push(`pageerror: ${e.message}`));
  page.on("console", (m) => {
    const t = m.text();
    if (m.type() === "error" && !/WebSocket|ERR_|Failed to load resource|net::/i.test(t)) problems.push(`console.error: ${t}`);
    if (/hydrat/i.test(t)) problems.push(`hydration: ${t}`);
  });
  const refreshes = [];
  page.on("request", (r) => {
    const h = r.headers();
    if (h["rsc"] === "1" && !h["next-router-prefetch"] && new URL(r.url()).pathname === path) refreshes.push(Date.now());
  });
  if (clock) await page.clock.install();
  await page.goto(APP + path, { waitUntil: "load" });
  return { ctx, page, problems, refreshes };
}
const status = (page) => page.locator("[data-live-status]").getAttribute("data-live-status");
const waitStatus = (page, s, timeout = 15000) => page.waitForSelector(`[data-live-status="${s}"]`, { timeout });
const text = (page, t, timeout = 6000) => page.getByText(t, { exact: false }).first().waitFor({ state: "visible", timeout });

async function main() {
  start("node", [join(import.meta.dirname, "fake-supabase.mjs"), "4010"]);
  start("npx", ["next", "start", "-p", "3100"], { cwd: join(import.meta.dirname, "..", "apps", "web") });
  await waitFor(`${FAKE}/__admin/stats`);
  await waitFor(`${APP}/docs`);
  const browser = await chromium.launch();
  const allProblems = [];

  console.log("Halaman Cordon (/cordons/cMAG7)");
  await step("tersambung, indikator Live, langganan memakai filter id Cordon ini", async () => {
    await admin("reset");
    const { ctx, page, problems } = await open(browser, "/cordons/cMAG7");
    await waitStatus(page, "live");
    check((await page.locator("[data-live-status]").innerText()).includes("Live"), "teks indikator bukan Live");
    const s = await stats();
    check(s.subscribers === 1, `subscribers=${s.subscribers}`);
    const f = s.joins[0].filters;
    check(f.length === 1 && f[0].table === "nav_points" && f[0].schema === "public" && f[0].event === "*" && f[0].filter === `cordon_id=eq.${ID.cordon}`, `filter salah: ${JSON.stringify(f)}`);
    allProblems.push(...problems); await ctx.close();
  });

  await step("NAV baru muncul tanpa muat ulang; input, skrip, dan pengumuman terjaga", async () => {
    await admin("reset");
    const { ctx, page, problems } = await open(browser, "/cordons/cMAG7");
    await waitStatus(page, "live");
    await text(page, "$102.00");
    await page.evaluate(() => { window.__noReload = "marker"; });
    await page.getByLabel("You pay").fill("42");
    const t0 = Date.now();
    const r = await insertNav(105.5);
    check(r.delivered === 1, `event terkirim ke ${r.delivered} pelanggan`);
    await text(page, "$105.50");
    const ms = Date.now() - t0;
    check(await page.evaluate(() => window.__noReload) === "marker", "halaman dimuat ulang penuh");
    check(await page.getByLabel("You pay").inputValue() === "42", "isi input hilang saat refresh");
    const said = await page.locator('.sr-only[aria-live="polite"]').innerText();
    check(said === "cMAG7 NAV per share is now $105.50", `pengumuman: ${JSON.stringify(said)}`);
    check(await page.getByText("As of").first().isVisible(), "keterangan As of hilang");
    console.log(`       latensi event -> layar: ${ms} ms`);
    allProblems.push(...problems); await ctx.close();
  });

  await step("event Cordon lain tidak memicu refresh", async () => {
    await admin("reset");
    const { ctx, page, problems, refreshes } = await open(browser, "/cordons/cMAG7");
    await waitStatus(page, "live");
    const r = await insertNav(77, "22222222-2222-4222-8222-222222222222");
    await sleep(2500);
    check(r.delivered === 0, `terkirim ke ${r.delivered}`);
    check(refreshes.length === 0, `${refreshes.length} refresh padahal bukan Cordon ini`);
    check((await page.getByText("$102.00").count()) > 0, "NAV berubah");
    allProblems.push(...problems); await ctx.close();
  });

  await step("10 event beruntun digabung (<= 2 refresh), hasil akhir benar", async () => {
    await admin("reset");
    const { ctx, page, problems, refreshes } = await open(browser, "/cordons/cMAG7");
    await waitStatus(page, "live");
    const base = Date.parse("2026-10-03T00:00:00Z");
    for (let i = 1; i <= 10; i++) { await insertNav(110 + i, ID.cordon, new Date(base + i * 60000).toISOString()); await sleep(60); }
    await text(page, "$120.00");
    await sleep(1500);
    check(refreshes.length >= 1 && refreshes.length <= 2, `${refreshes.length} refresh untuk 10 event`);
    console.log(`       10 event -> ${refreshes.length} refresh`);
    allProblems.push(...problems); await ctx.close();
  });

  await step("putus lalu tersambung lagi: status Paused, lalu Live dan data terlewat terbaca ulang", async () => {
    await admin("reset");
    const { ctx, page, problems } = await open(browser, "/cordons/cMAG7");
    await waitStatus(page, "live");
    await admin("refuse", { on: true });
    await admin("drop");
    await waitStatus(page, "paused");
    check((await page.locator("[data-live-status]").innerText()).includes("paused"), "teks Paused tidak tampil");
    const r = await insertNav(107);   // terjadi saat putus: tidak ada yang menerima event
    check(r.delivered === 0, "seharusnya tak ada pelanggan");
    await admin("refuse", { on: false });
    await waitStatus(page, "live", 30000);
    await text(page, "$107.00", 8000);
    allProblems.push(...problems); await ctx.close();
  });

  await step("saat jeda, halaman memeriksa sendiri tiap menit (polling)", async () => {
    await admin("reset");
    const { ctx, page, problems } = await open(browser, "/cordons/cMAG7", { clock: true });
    await waitStatus(page, "live");
    await admin("refuse", { on: true });
    await admin("drop");
    await waitStatus(page, "paused");
    await insertNav(108);
    await sleep(1500);
    check((await page.getByText("$108.00").count()) === 0, "data berubah sebelum waktunya");
    await page.clock.fastForward(61000);
    await text(page, "$108.00", 8000);
    check(await status(page) === "paused", "status berubah dari paused");
    await admin("refuse", { on: false });
    allProblems.push(...problems); await ctx.close();
  });

  await step("pindah halaman (navigasi klien) melepas langganan", async () => {
    await admin("reset");
    const { ctx, page, problems } = await open(browser, "/cordons/cMAG7");
    await waitStatus(page, "live");
    check((await stats()).subscribers === 1, "belum 1 pelanggan");
    await page.getByRole("link", { name: "All Cordons" }).click();
    await page.waitForURL("**/cordons");
    await sleep(1500);
    const s = await stats();
    check(s.subscribers === 0, `masih ${s.subscribers} pelanggan setelah pindah halaman`);
    allProblems.push(...problems); await ctx.close();
  });

  console.log("Halaman vault (/vaults/sNVDA)");
  await step("tersambung dengan filter rounds.vault_id", async () => {
    await admin("reset");
    const { ctx, page, problems } = await open(browser, "/vaults/sNVDA");
    await waitStatus(page, "live");
    const f = (await stats()).joins[0].filters;
    check(f.length === 1 && f[0].table === "rounds" && f[0].filter === `vault_id=eq.${ID.vault}`, `filter salah: ${JSON.stringify(f)}`);
    allProblems.push(...problems); await ctx.close();
  });

  await step("round settle lalu round baru: panel, riwayat, strike, dan pengumuman ikut berubah", async () => {
    await admin("reset");
    const { ctx, page, problems } = await open(browser, "/vaults/sNVDA");
    await waitStatus(page, "live");
    await text(page, "#4 · premium auctioned");
    await page.evaluate(() => { window.__noReload = "marker"; });
    await admin("mutate", { op: "update", table: "rounds", match: { vault_id: ID.vault, round_no: 4 }, row: { status: "settled", settlement_price: 140, settled_at: "2026-10-02T20:05:00Z" } });
    await text(page, "No round is open right now.");
    const row4 = await page.locator("tbody tr", { hasText: "#4" }).innerText();
    check(/settled/.test(row4) && /\$140\.00/.test(row4), `baris #4: ${JSON.stringify(row4)}`);
    await admin("mutate", { op: "insert", table: "rounds", row: { vault_id: ID.vault, round_no: 5, strike: 150, expiry: "2026-10-09T20:00:00Z", notional: 10, premium_usdg: null, spot_start: 120, picker: null, settlement_price: null, settled_at: null, status: "open" } });
    await text(page, "#5 · open");
    await text(page, "$150.00");
    await text(page, "Not auctioned yet");
    check(await page.evaluate(() => window.__noReload) === "marker", "halaman dimuat ulang penuh");
    const said = await page.locator('.sr-only[aria-live="polite"]').innerText();
    check(said === "sNVDA round 5 is open", `pengumuman: ${JSON.stringify(said)}`);
    allProblems.push(...problems); await ctx.close();
  });

  console.log("Aksesibilitas dan tata letak");
  for (const [path, label] of [["/cordons/cMAG7", "Cordon"], ["/vaults/sNVDA", "vault"]]) {
    await step(`${label}: tanpa overflow horizontal di 360px, tanpa error console/hydration`, async () => {
      await admin("reset");
      const { ctx, page, problems } = await open(browser, path, { width: 360 });
      await waitStatus(page, "live");
      const over = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      check(over <= 0, `overflow horizontal ${over}px`);
      check(problems.length === 0, problems.join(" | "));
      await ctx.close();
    });
    if (axePath) {
      await step(`${label}: axe-core (WCAG A/AA) 0 pelanggaran, terang dan gelap`, async () => {
        await admin("reset");
        for (const scheme of ["light", "dark"]) {
          const ctx = await browser.newContext({ colorScheme: scheme });
          const page = await ctx.newPage();
          await page.goto(APP + path);
          await waitStatus(page, "live");
          await page.addScriptTag({ path: axePath });
          const v = await page.evaluate(async () => (await window.axe.run(document, { runOnly: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "best-practice"] })).violations.map((x) => `${x.id}(${x.nodes.length})`));
          check(v.length === 0, `${scheme}: ${v.join(", ")}`);
          await ctx.close();
        }
      });
    }
  }
  await step("tidak ada pageerror, console.error, atau peringatan hydration di seluruh uji", async () => {
    check(allProblems.length === 0, allProblems.join(" | "));
  });

  await browser.close();
  const failed = results.filter((r) => !r[0]);
  console.log(`\n${results.length - failed.length}/${results.length} lulus${axePath ? "" : " (axe dilewati: axe-core tidak terpasang)"}`);
  return failed.length;
}

let code = 1;
try { code = await main(); }
catch (e) { console.error("uji berhenti:", e.message); }
finally { for (const c of children) { try { process.kill(c.pid); } catch { /* sudah mati */ } } }
process.exit(code ? 1 : 0);
