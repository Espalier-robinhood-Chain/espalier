// Satu siklus keeper terhadap antarmuka (dites dengan tiruan). Aturan penting:
//  * Tabel `prunings` hanya diisi setelah transaksi SUNGGUHAN terkonfirmasi, dengan drift "sesudah" yang dibaca ulang
//    dari chain. Mode dry-run tidak pernah menulis riwayat (akan memalsukan data publik).
//  * Setiap siklus live yang bertindak dicatat di `keeper_runs` (running -> ok/failed).
import { decide, maxDriftBps, planTrades, type Holding, type PlanConfig, type Trade } from "./plan.ts";

export interface KeeperChain {
  /** Komponen + saldo + harga LIVE. pricesLive=false bila ada satu saja komponen tanpa harga live. */
  snapshot(): Promise<{ holdings: Holding[]; pricesLive: boolean }>;
}
export interface Executor {
  readonly mode: "dry-run" | "live";
  /** Kirim semua trade dalam satu pruning dan tunggu konfirmasi. Mengembalikan hash transaksi. */
  execute(trades: Trade[]): Promise<{ txHash: string; at: Date }>;
}
export interface KeeperStore {
  lastPruningAt(): Promise<Date | null>;
  startRun(): Promise<number>;
  finishRun(id: number, r: { status: "ok" | "failed"; txHash?: string; error?: string }): Promise<void>;
  recordPruning(p: { ts: string; driftBeforeBps: number; driftAfterBps: number; trades: number; txHash: string }): Promise<void>;
}
export interface KeeperConfig extends PlanConfig { thresholdBps: number; minIntervalDays: number }
export type Outcome = { kind: "skipped"; reason: string } | { kind: "dry-run"; trades: Trade[]; driftBps: number } | { kind: "pruned"; txHash: string; before: number; after: number; trades: number } | { kind: "failed"; error: string };

export async function runOnce(chain: KeeperChain, exec: Executor, store: KeeperStore, cfg: KeeperConfig, now = new Date()): Promise<Outcome> {
  const { holdings, pricesLive } = await chain.snapshot();
  const driftBps = pricesLive ? maxDriftBps(holdings) : 0;
  const d = decide({ now, lastPruningAt: await store.lastPruningAt(), pricesLive, driftBps, thresholdBps: cfg.thresholdBps, minIntervalDays: cfg.minIntervalDays });
  if (d.action === "skip") return { kind: "skipped", reason: d.reason };

  const trades = planTrades(holdings, cfg);
  if (trades.length === 0) return { kind: "skipped", reason: "no trade above the dust limit" };

  // Dry-run tidak menyentuh database sama sekali: poll berkala tidak boleh menumpuk baris keeper_runs.
  if (exec.mode === "dry-run") return { kind: "dry-run", trades, driftBps };

  const run = await store.startRun();
  let sent: string | undefined;
  try {
    const { txHash, at } = await exec.execute(trades);
    sent = txHash;
    const post = await chain.snapshot();
    // Harga tidak live setelah transaksi (pasar baru tutup): jangan mengarang angka "sesudah". Tercatat gagal dengan hash-nya.
    if (!post.pricesLive) throw new Error(`pruning ${txHash} confirmed but drift after could not be read (prices not live)`);
    const after = maxDriftBps(post.holdings);
    await store.recordPruning({ ts: at.toISOString(), driftBeforeBps: driftBps, driftAfterBps: after, trades: trades.length, txHash });
    await store.finishRun(run, { status: "ok", txHash });
    return { kind: "pruned", txHash, before: driftBps, after, trades: trades.length };
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    await store.finishRun(run, { status: "failed", txHash: sent, error: error.slice(0, 500) });
    return { kind: "failed", error };
  }
}
