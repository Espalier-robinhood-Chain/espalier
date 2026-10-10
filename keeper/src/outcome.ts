// Murni (hanya tipe dari spur-run.ts, terhapus saat dijalankan) supaya bisa dites tanpa viem/Supabase.
import type { Outcome } from "./run.ts";
import type { SpurOutcome } from "./spur-run.ts";

export interface LaneResult { ok: boolean; kind: string; line: string; txHash?: string }

/** Satu baris ringkas per hasil siklus. ok=false hanya untuk transaksi yang benar-benar gagal. */
export function describeOutcome(lane: string, o: SpurOutcome): LaneResult {
  switch (o.kind) {
    case "waiting": return { ok: true, kind: o.kind, line: `${lane} tunggu: ${o.reason}` };
    case "blocked": return { ok: true, kind: o.kind, line: `${lane} DITAHAN ${o.job}: ${o.reason}` };
    case "dry-run": return { ok: true, kind: o.kind, line: `${lane} DRY-RUN ${o.job}: ${o.detail} (lolos simulasi, tidak dikirim)` };
    case "sent": return { ok: true, kind: o.kind, line: `${lane} ${o.job} terkirim ${o.txHash}`, txHash: o.txHash };
    case "failed": return { ok: false, kind: o.kind, line: `${lane} GAGAL ${o.job}: ${o.error}`, txHash: o.txHash };
  }
}

/** Hasil satu siklus pruning Cordon. ok=false hanya untuk pruning yang benar-benar gagal. */
export function describeCordonOutcome(label: string, o: Outcome): LaneResult {
  switch (o.kind) {
    case "skipped": return { ok: true, kind: o.kind, line: `${label} lewati: ${o.reason}` };
    case "dry-run": return { ok: true, kind: o.kind, line: `${label} DRY-RUN: drift ${o.driftBps} bps, rencana ${o.trades.length} trade (tidak dikirim)` };
    case "pruned": return { ok: true, kind: o.kind, line: `${label} pruning ${o.txHash}: drift ${o.before} -> ${o.after} bps (${o.trades} trade)`, txHash: o.txHash };
    case "failed": return { ok: false, kind: o.kind, line: `${label} GAGAL: ${safeText(o.error)}` };
  }
}

/** Satu set env di Vercel untuk indexer dan keeper: KEEPER_RPC_URL / KEEPER_CHAIN_ID bila kosong memakai INDEXER_*. */
export function keeperEnv(e: Record<string, string | undefined>): Record<string, string | undefined> {
  const pick = (a: string, b: string) => (e[a]?.trim() ? e[a] : e[b]);
  return { ...e, KEEPER_RPC_URL: pick("KEEPER_RPC_URL", "INDEXER_RPC_URL"), KEEPER_CHAIN_ID: pick("KEEPER_CHAIN_ID", "INDEXER_CHAIN_ID") };
}

/** Pesan galat aman disimpan: URL (memuat kunci RPC) dibuang, panjang dibatasi. */
export function safeText(e: unknown): string {
  const raw = e instanceof Error ? e.message : String(e);
  return raw.replace(/https?:\/\/\S+/g, "<url>").replace(/\s+/g, " ").trim().slice(0, 300);
}

/**
 * Mainnet (4663): keeper LIVE lewat cron hanya jalan bila ALLOW_MAINNET_CRON_KEEPER=true (kunci keeper ada di env server).
 * Mengembalikan alasan penolakan, atau null bila boleh jalan. Dry-run dan testnet tidak pernah ditolak.
 */
export function mainnetLiveRefusal(e: Record<string, string | undefined>, chainId: number, mode: "dry-run" | "live"): string | null {
  if (mode !== "live" || chainId !== 4663) return null;
  if (e.ALLOW_MAINNET_CRON_KEEPER?.trim() === "true") return null;
  return "keeper live dari cron di mainnet (4663) butuh ALLOW_MAINNET_CRON_KEEPER=true (kunci keeper di env server), atau jalankan keeper/ sebagai worker";
}
