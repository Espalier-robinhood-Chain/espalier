// Satu putaran indexer untuk satu aliran, tanpa loop: dipanggil cron (route Vercel yang dipicu pg_cron Supabase).
// Logikanya sama dengan main.ts (bootstrap lalu syncOnce); kursor tersimpan di Supabase, jadi pindah dari indexer di
// komputer ke cron berlangsung mulus dan putaran yang gagal cukup diulang pada panggilan berikutnya.
// Cordon: "cordon" = CORDON_VAULT_ADDRESS, "cordon1", "cordon2" = urutan EXTRA_CORDONS (cCHIP, cVOLT, ...).
import { loadConfig } from "./config.ts";
import { navDue } from "./nav-due.ts";
import { createSpurChain } from "./spur-chain.ts";
import { createSpurStore } from "./spur-store.ts";
import { bootstrapSpur, syncSpurOnce, type SpurSyncConfig } from "./spur-sync.ts";
import { parseStream } from "./stream.ts";
import { createSupabaseStore } from "./supabase-store.ts";
import { bootstrap, snapshotNav, syncOnce, type SyncConfig } from "./sync.ts";
import { createViemChain } from "./viem-chain.ts";

export { parseStream };
export interface RunResult { stream: string; ok: boolean; skipped?: boolean; line: string; ms: number }

/** Pesan galat aman disimpan: URL (memuat kunci RPC) dibuang dan panjangnya dibatasi. */
export function safeError(e: unknown): string {
  const raw = e instanceof Error ? e.message : String(e);
  return raw.replace(/https?:\/\/\S+/g, "<url>").replace(/\s+/g, " ").trim().slice(0, 300);
}

export async function runOnce(env: Record<string, string | undefined>, stream: string, nowMs = Date.now()): Promise<RunResult> {
  const t0 = Date.now();
  const done = (ok: boolean, line: string, skipped = false): RunResult => ({ stream, ok, skipped, line, ms: Date.now() - t0 });
  try {
    const spec = parseStream(stream);
    if (!spec) return done(false, "aliran tidak dikenal (cordon, cordon1, cordon2, spur, graft)");
    const cfg = loadConfig(env);
    if (spec.kind === "cordon") {
      const all = [{ vault: cfg.vault, startBlock: cfg.startBlock }, ...cfg.extraCordons];
      const c = all[spec.index];
      if (!c) return done(true, `${stream} tidak dikonfigurasi (EXTRA_CORDONS hanya berisi ${cfg.extraCordons.length} Cordon tambahan)`, true);
      const chain = await createViemChain(cfg.rpcUrl, c.vault, cfg.chainId);
      const store = createSupabaseStore(cfg.supabaseUrl, cfg.serviceKey, `cordon:${cfg.chainId}:${c.vault.toLowerCase()}`);
      const sync: SyncConfig = { startBlock: c.startBlock, confirmations: cfg.confirmations, logChunk: cfg.logChunk, balanceBatch: cfg.balanceBatch };
      const boot = await bootstrap(chain, store);
      const sym = boot.meta.symbol;
      const r = await syncOnce(chain, store, sync, boot);
      let line = r ? `${sym} sinkron blok ${r.from}..${r.to}: ${r.touched} akun berubah, NAV ${r.navWritten ? "ditulis" : "dilewati (harga tidak valid)"}` : `${sym} tidak ada blok baru`;
      if (navDue(nowMs, cfg.navEveryMs)) {
        const ok = await snapshotNav(chain, store, sync, boot);
        line += ok ? "; snapshot NAV ditulis" : "; snapshot NAV dilewati (harga tidak valid)";
      }
      return done(true, line);
    }
    const v = spec.kind === "spur" ? cfg.spur : cfg.graft;
    if (!v) return done(true, `${stream} tidak dikonfigurasi (env ${stream.toUpperCase()}_VAULT_ADDRESS kosong)`, true);
    const chain = await createSpurChain(cfg.rpcUrl, v.vault, cfg.chainId, spec.kind);
    const store = createSpurStore(cfg.supabaseUrl, cfg.serviceKey, `${stream}:${cfg.chainId}:${v.vault.toLowerCase()}`);
    const boot = await bootstrapSpur(chain, store, v.symbol);
    const sync: SpurSyncConfig = { startBlock: v.startBlock, confirmations: cfg.confirmations, logChunk: cfg.logChunk, balanceBatch: cfg.balanceBatch };
    const r = await syncSpurOnce(chain, store, sync, boot);
    return done(true, r ? `${stream} blok ${r.from}..${r.to}: ${r.events} event, ${r.rounds} round, ${r.harvests} harvest, ${r.positions} posisi` : `${stream} tidak ada blok baru`);
  } catch (e) {
    return done(false, `galat: ${safeError(e)}`);
  }
}
