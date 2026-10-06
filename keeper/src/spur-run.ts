// Satu siklus keeper untuk SpurVault terhadap antarmuka (dites dengan tiruan). Aturan penting:
//  * Keadaan dibaca dari chain, bukan database. Database hanya menerima log `keeper_runs`.
//  * Tidak ada transaksi yang dikirim sebelum lolos simulasi (eth_call sebagai akun keeper). Simulasi gagal = "blocked":
//    dilaporkan di log, TIDAK ditulis ke `keeper_runs` (poll berkala tidak boleh menumpuk baris), dan dicoba lagi di siklus berikut.
//  * `keeper_runs` hanya untuk transaksi yang benar-benar dikirim (running -> ok/failed). Dry-run tidak menulis apa pun.
//  * Quote RFQ tidak dipercaya: keeper menyusun sendiri isi quote dari state round onchain; sumber hanya memberi
//    (picker, premium, deadline, signature). Tanda tangan mengikat semua field, jadi quote yang tidak cocok ditolak kontrak.
import { findSettlementRound, nextSpurAction, type FeedReader, type SpurSnapshot } from "./spur-plan.ts";

export type Hex = `0x${string}`;
export interface Quote { vault: Hex; picker: Hex; round: bigint; strikeE18: bigint; expiry: bigint; notional: bigint; premium: bigint; deadline: bigint }
export type SpurCall =
  | { fn: "rollRound"; expiry: bigint }
  | { fn: "fill"; quote: Quote; signature: Hex }
  | { fn: "closeUnsold" }
  | { fn: "settle"; roundId: bigint }
  | { fn: "settleFallback"; roundId: bigint }
  | { fn: "settleRound" };

export interface RoundTerms { strikeE18: bigint; expiry: bigint; notional: bigint; minPremium: bigint; start: bigint }
export interface QuoteRequest { chainId: number; auction: Hex; vault: Hex; round: bigint; strikeE18: bigint; expiry: bigint; notional: bigint; minPremium: bigint }
export interface RawQuote { picker: Hex; premium: bigint; deadline: bigint; signature: Hex }

export interface SpurChain {
  readonly vault: Hex;
  readonly auction: Hex;
  readonly chainId: number;
  snapshot(): Promise<SpurSnapshot>;
  roundTerms(round: bigint): Promise<RoundTerms>;
  isPicker(picker: Hex): Promise<boolean>;
  settlementContext(): Promise<{ feed: FeedReader; maxPrintDelay: bigint }>;
}
export interface QuoteSource { fetch(req: QuoteRequest): Promise<RawQuote[]> }
export interface SpurExecutor {
  readonly mode: "dry-run" | "live";
  simulate(call: SpurCall): Promise<{ ok: true } | { ok: false; reason: string }>;
  /** Kirim dan tunggu konfirmasi (status sukses). Dry-run melempar galat. */
  send(call: SpurCall): Promise<{ txHash: string; at: Date }>;
}
export interface SpurStore {
  startRun(job: string): Promise<number>;
  finishRun(id: number, r: { status: "ok" | "failed"; txHash?: string; error?: string }): Promise<void>;
}

export type SpurOutcome =
  | { kind: "waiting"; reason: string }
  | { kind: "blocked"; job: string; reason: string }
  | { kind: "dry-run"; job: string; detail: string }
  | { kind: "sent"; job: string; txHash: string }
  | { kind: "failed"; job: string; error: string; txHash?: string };

/** Quote yang deadline-nya kurang dari ini dari sekarang dibuang: bisa kedaluwarsa sebelum transaksi masuk blok. */
export const QUOTE_DEADLINE_BUFFER = 30n;

const JOB: Record<SpurCall["fn"], string> = {
  rollRound: "spur:roll", fill: "spur:fill", closeUnsold: "spur:close-unsold", settle: "spur:record-settlement", settleFallback: "spur:record-settlement", settleRound: "spur:settle-round",
};
const short = (e: unknown) => (e instanceof Error ? e.message : String(e)).slice(0, 500);

async function act(call: SpurCall, exec: SpurExecutor, store: SpurStore): Promise<SpurOutcome> {
  const job = JOB[call.fn];
  const sim = await exec.simulate(call);
  if (!sim.ok) return { kind: "blocked", job, reason: sim.reason };
  if (exec.mode === "dry-run") return { kind: "dry-run", job, detail: describe(call) };
  const run = await store.startRun(job);
  let hash: string | undefined;
  try {
    const { txHash } = await exec.send(call);
    hash = txHash;
    await store.finishRun(run, { status: "ok", txHash });
    return { kind: "sent", job, txHash };
  } catch (e) {
    const error = short(e);
    await store.finishRun(run, { status: "failed", txHash: hash, error });
    return { kind: "failed", job, error, txHash: hash };
  }
}

function describe(c: SpurCall): string {
  switch (c.fn) {
    case "rollRound": return `rollRound(expiry=${new Date(Number(c.expiry) * 1000).toISOString()})`;
    case "fill": return `fill(round=${c.quote.round}, picker=${c.quote.picker}, premium=${c.quote.premium})`;
    case "settle": case "settleFallback": return `${c.fn}(roundId=${c.roundId})`;
    default: return `${c.fn}()`;
  }
}

/** Pilih quote terbaik yang LOLOS SIMULASI. Mengembalikan alasan penolakan tiap kandidat untuk log. */
export async function pickQuote(
  raws: RawQuote[], terms: RoundTerms, round: bigint, vault: Hex, now: bigint,
  isPicker: (p: Hex) => Promise<boolean>, exec: SpurExecutor,
): Promise<{ call: Extract<SpurCall, { fn: "fill" }> | null; rejected: string[] }> {
  const rejected: string[] = [];
  const sorted = [...raws].sort((a, b) => (a.premium === b.premium ? 0 : a.premium > b.premium ? -1 : 1));
  for (const q of sorted) {
    const tag = `${q.picker}@${q.premium}`;
    if (q.premium === 0n || q.premium < terms.minPremium) { rejected.push(`${tag}: premium below floor ${terms.minPremium}`); continue; }
    if (q.deadline < now + QUOTE_DEADLINE_BUFFER) { rejected.push(`${tag}: deadline too close or past`); continue; }
    if (!(await isPicker(q.picker))) { rejected.push(`${tag}: not an allowed picker`); continue; }
    const call: Extract<SpurCall, { fn: "fill" }> = {
      fn: "fill", signature: q.signature,
      quote: { vault, picker: q.picker, round, strikeE18: terms.strikeE18, expiry: terms.expiry, notional: terms.notional, premium: q.premium, deadline: q.deadline },
    };
    const sim = await exec.simulate(call);
    if (sim.ok) return { call, rejected };
    rejected.push(`${tag}: ${sim.reason}`);
  }
  return { call: null, rejected };
}

export async function runSpurOnce(chain: SpurChain, exec: SpurExecutor, quotes: QuoteSource | null, store: SpurStore): Promise<SpurOutcome> {
  const snap = await chain.snapshot();
  const a = nextSpurAction(snap);
  switch (a.action) {
    case "wait": return { kind: "waiting", reason: a.reason };
    case "roll": return act({ fn: "rollRound", expiry: a.expiry }, exec, store);
    case "closeUnsold": return act({ fn: "closeUnsold" }, exec, store);
    case "settleRound": return act({ fn: "settleRound" }, exec, store);
    case "fill": {
      if (!quotes) return { kind: "waiting", reason: `round #${a.round} awaits a Picker but no RFQ source is configured (RFQ_URL)` };
      const terms = await chain.roundTerms(a.round);
      let raws: RawQuote[];
      try {
        raws = await quotes.fetch({ chainId: chain.chainId, auction: chain.auction, vault: chain.vault, round: a.round, strikeE18: terms.strikeE18, expiry: terms.expiry, notional: terms.notional, minPremium: terms.minPremium });
      } catch (e) { return { kind: "blocked", job: JOB.fill, reason: `RFQ request failed: ${short(e)}` }; }
      if (raws.length === 0) return { kind: "waiting", reason: `round #${a.round}: RFQ returned no quotes` };
      const { call, rejected } = await pickQuote(raws, terms, a.round, chain.vault, snap.now, (p) => chain.isPicker(p), exec);
      if (!call) return { kind: "blocked", job: JOB.fill, reason: `round #${a.round}: no usable quote (${rejected.join("; ")})` };
      return act(call, exec, store);
    }
    case "recordSettlement": {
      const r = snap.current!; // nextSpurAction hanya mengembalikan ini bila round ada
      const ctx = await chain.settlementContext();
      const pick = await findSettlementRound(ctx.feed, r.expiry, ctx.maxPrintDelay, snap.now);
      if (pick.kind === "wait") return { kind: "waiting", reason: pick.reason };
      if (pick.kind === "stuck") return { kind: "blocked", job: JOB.settle, reason: pick.reason };
      return act(pick.kind === "print" ? { fn: "settle", roundId: pick.roundId } : { fn: "settleFallback", roundId: pick.roundId }, exec, store);
    }
  }
}
