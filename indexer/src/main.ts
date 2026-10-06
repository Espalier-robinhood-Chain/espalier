import { loadConfig } from "./config.ts";
import { createSpurChain } from "./spur-chain.ts";
import { createSpurStore } from "./spur-store.ts";
import { bootstrapSpur, syncSpurOnce, type SpurSyncConfig } from "./spur-sync.ts";
import { createSupabaseStore } from "./supabase-store.ts";
import { bootstrap, snapshotNav, syncOnce, type SyncConfig } from "./sync.ts";
import { createViemChain } from "./viem-chain.ts";

const log = (msg: string, extra?: unknown) => console.log(`${new Date().toISOString()} ${msg}`, extra ?? "");
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const cfg = loadConfig(process.env);
const chain = await createViemChain(cfg.rpcUrl, cfg.vault, cfg.chainId);
const store = createSupabaseStore(cfg.supabaseUrl, cfg.serviceKey, `cordon:${cfg.chainId}:${cfg.vault.toLowerCase()}`);
const sync: SyncConfig = { startBlock: cfg.startBlock, confirmations: cfg.confirmations, logChunk: cfg.logChunk, balanceBatch: cfg.balanceBatch };

const boot = await bootstrap(chain, store);
log(`indexer siap: ${boot.meta.symbol} @ ${boot.meta.address} (chain ${cfg.chainId}), ${boot.meta.components.length} komponen`);

// Spur (opsional): jalur sendiri dengan kursor + snapshot sendiri, jadi galat di sini tidak menghentikan Cordon dan sebaliknya.
let spur: { chain: Awaited<ReturnType<typeof createSpurChain>>; store: ReturnType<typeof createSpurStore>; sync: SpurSyncConfig; boot: Awaited<ReturnType<typeof bootstrapSpur>> } | null = null;
if (cfg.spur) {
  const sChain = await createSpurChain(cfg.rpcUrl, cfg.spur.vault, cfg.chainId);
  const sStore = createSpurStore(cfg.supabaseUrl, cfg.serviceKey, `spur:${cfg.chainId}:${cfg.spur.vault.toLowerCase()}`);
  const sBoot = await bootstrapSpur(sChain, sStore, cfg.spur.symbol);
  spur = { chain: sChain, store: sStore, boot: sBoot, sync: { startBlock: cfg.spur.startBlock, confirmations: cfg.confirmations, logChunk: cfg.logChunk, balanceBatch: cfg.balanceBatch } };
  log(`spur siap: ${cfg.spur.symbol ?? `s${sBoot.meta.assetSymbol}`} @ ${sBoot.meta.address}`);
}

let stop = false;
for (const s of ["SIGINT", "SIGTERM"] as const) process.on(s, () => { stop = true; });

let lastSnapshot = 0;
let failures = 0;
while (!stop) {
  let failed = false;
  const attempt = async (what: string, fn: () => Promise<void>) => {
    try { await fn(); } catch (e) { failed = true; log(`galat ${what} (percobaan ${failures + 1}):`, e instanceof Error ? e.message : e); }
  };
  await attempt("cordon", async () => {
    const r = await syncOnce(chain, store, sync, boot);
    if (r) log(`sinkron blok ${r.from}..${r.to}: ${r.touched} akun berubah, NAV ${r.navWritten ? "ditulis" : "dilewati (harga tidak valid)"}`);
    if (Date.now() - lastSnapshot >= cfg.navEveryMs) {
      const ok = await snapshotNav(chain, store, sync, boot);
      lastSnapshot = Date.now();
      if (!ok) log("snapshot NAV dilewati (harga komponen tidak valid atau belum ada blok aman)");
    }
  });
  if (spur) {
    const s = spur;
    await attempt("spur", async () => {
      const r = await syncSpurOnce(s.chain, s.store, s.sync, s.boot);
      if (r) log(`spur blok ${r.from}..${r.to}: ${r.events} event, ${r.rounds} round, ${r.harvests} harvest, ${r.positions} posisi`);
    });
  }
  if (!failed) { failures = 0; await sleep(cfg.pollMs); continue; }
  failures++;
  const wait = Math.min(60_000, cfg.pollMs * 2 ** Math.min(failures, 6));
  log(`coba lagi ${Math.round(wait / 1000)} dtk`);
  await sleep(wait);
}
log("berhenti");
