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

// Cordon: yang utama (cMAG7) ditambah EXTRA_CORDONS (mis. cCHIP). Masing-masing jalur sendiri (klien, kursor, snapshot NAV),
// jadi galat di satu Cordon tidak menghentikan yang lain.
type CordonPipe = { chain: Awaited<ReturnType<typeof createViemChain>>; store: ReturnType<typeof createSupabaseStore>; sync: SyncConfig; boot: Awaited<ReturnType<typeof bootstrap>>; lastSnapshot: number };
const cordons: CordonPipe[] = [];
for (const c of [{ vault: cfg.vault, startBlock: cfg.startBlock }, ...cfg.extraCordons]) {
  const cChain = await createViemChain(cfg.rpcUrl, c.vault, cfg.chainId);
  const cStore = createSupabaseStore(cfg.supabaseUrl, cfg.serviceKey, `cordon:${cfg.chainId}:${c.vault.toLowerCase()}`);
  const cSync: SyncConfig = { startBlock: c.startBlock, confirmations: cfg.confirmations, logChunk: cfg.logChunk, balanceBatch: cfg.balanceBatch, maxChunks: cfg.maxChunks };
  const cBoot = await bootstrap(cChain, cStore);
  cordons.push({ chain: cChain, store: cStore, sync: cSync, boot: cBoot, lastSnapshot: 0 });
  log(`indexer siap: ${cBoot.meta.symbol} @ ${cBoot.meta.address} (chain ${cfg.chainId}), ${cBoot.meta.components.length} komponen`);
}

// Spur dan Graft (opsional): masing-masing jalur sendiri dengan kursor + snapshot sendiri, jadi galat di satu jalur
// tidak menghentikan Cordon atau vault lain. Graft memakai kode yang sama (GraftVault mencerminkan SpurVault).
type VaultPipe = { name: "spur" | "graft"; chain: Awaited<ReturnType<typeof createSpurChain>>; store: ReturnType<typeof createSpurStore>; sync: SpurSyncConfig; boot: Awaited<ReturnType<typeof bootstrapSpur>> };
const vaults: VaultPipe[] = [];
for (const [name, v] of [["spur", cfg.spur], ["graft", cfg.graft]] as const) {
  if (!v) continue;
  const vChain = await createSpurChain(cfg.rpcUrl, v.vault, cfg.chainId, name);
  const vStore = createSpurStore(cfg.supabaseUrl, cfg.serviceKey, `${name}:${cfg.chainId}:${v.vault.toLowerCase()}`);
  const vBoot = await bootstrapSpur(vChain, vStore, v.symbol);
  vaults.push({ name, chain: vChain, store: vStore, boot: vBoot, sync: { startBlock: v.startBlock, confirmations: cfg.confirmations, logChunk: cfg.logChunk, balanceBatch: cfg.balanceBatch, maxChunks: cfg.maxChunks } });
  log(`${name} siap: ${v.symbol ?? (name === "graft" ? "g" : "s") + (vBoot.meta.underlyingSymbol ?? vBoot.meta.assetSymbol)} @ ${vBoot.meta.address}`);
}

let stop = false;
for (const s of ["SIGINT", "SIGTERM"] as const) process.on(s, () => { stop = true; });

let failures = 0;
while (!stop) {
  let failed = false;
  const attempt = async (what: string, fn: () => Promise<void>) => {
    try { await fn(); } catch (e) { failed = true; log(`galat ${what} (percobaan ${failures + 1}):`, e instanceof Error ? e.message : e); }
  };
  for (const c of cordons) {
    await attempt(c.boot.meta.symbol, async () => {
      const r = await syncOnce(c.chain, c.store, c.sync, c.boot);
      if (r) log(`${c.boot.meta.symbol} sinkron blok ${r.from}..${r.to}: ${r.touched} akun berubah, ${r.partial ? "mengejar, NAV ditunda" : `NAV ${r.navWritten ? "ditulis" : "dilewati (harga tidak valid)"}`}`);
      if (Date.now() - c.lastSnapshot >= cfg.navEveryMs) {
        const ok = await snapshotNav(c.chain, c.store, c.sync, c.boot);
        c.lastSnapshot = Date.now();
        if (!ok) log(`snapshot NAV ${c.boot.meta.symbol} dilewati (harga komponen tidak valid atau belum ada blok aman)`);
      }
    });
  }
  for (const v of vaults) {
    await attempt(v.name, async () => {
      const r = await syncSpurOnce(v.chain, v.store, v.sync, v.boot);
      if (r) log(`${v.name} blok ${r.from}..${r.to}: ${r.events} event, ${r.rounds} round, ${r.harvests} harvest, ${r.positions} posisi`);
    });
  }
  if (!failed) { failures = 0; await sleep(cfg.pollMs); continue; }
  failures++;
  const wait = Math.min(60_000, cfg.pollMs * 2 ** Math.min(failures, 6));
  log(`coba lagi ${Math.round(wait / 1000)} dtk`);
  await sleep(wait);
}
log("berhenti");
