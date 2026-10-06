// Perencana keeper untuk SpurVault (murni, tanpa jaringan). Membaca keadaan ONCHAIN (bukan database) dan menjawab
// "langkah apa berikutnya". Keeper hanya memicu fungsi yang sudah dibatasi kontrak; di sini tidak ada keputusan harga:
//  * strike dihitung kontrak dari harga oracle live saat `rollRound`; keeper hanya memilih expiry (Jumat 16:00 ET);
//  * harga settlement dibuktikan kontrak (`SettlementOracle`); keeper hanya MENUNJUK round Chainlink yang dibuktikan;
//  * premium ditentukan quote bertanda tangan Picker; kontrak menolak yang di bawah lantai.
import { nextHarvestClose } from "../../lib/schedule.ts";

export const WEEK = 7n * 86_400n;
/** Cadangan waktu untuk latensi transaksi saat memilih expiry (kontrak menolak expiry < now + MIN_DURATION). */
export const EXPIRY_MARGIN = 900n;

export interface SpurRoundLite { start: bigint; expiry: bigint; picker: string; outcome: number }
export interface SpurSnapshot {
  /** Waktu blok terbaru (detik). Semua keputusan memakai waktu chain, bukan jam lokal. */
  now: bigint;
  paused: boolean;
  active: boolean;
  /** Nomor round terakhir yang dimulai (0 = belum pernah). */
  round: bigint;
  /** `rounds[round]`; null bila round = 0. */
  current: SpurRoundLite | null;
  fillWindow: bigint;
  minDuration: bigint;
  maxDuration: bigint;
  /** Harga settlement (token, expiry round saat ini) sudah tercatat di SettlementOracle. Hanya bermakna bila round aktif, terjual, dan lewat expiry. */
  settlementRecorded: boolean;
}

export type SpurAction =
  | { action: "roll"; expiry: bigint }
  | { action: "fill"; round: bigint }
  | { action: "closeUnsold" }
  | { action: "recordSettlement" }
  | { action: "settleRound" }
  | { action: "wait"; reason: string };

const isZero = (a: string) => /^0x0{40}$/i.test(a);

/** Jumat 16:00 ET berikutnya yang memenuhi batas kontrak [now+min, now+max]. null bila tidak ada (jangan memaksa). */
export function rollExpiry(now: bigint, minDuration: bigint, maxDuration: bigint): bigint | null {
  let e = BigInt(Math.floor(nextHarvestClose(new Date(Number(now) * 1000)).getTime() / 1000));
  for (let i = 0; e < now + minDuration + EXPIRY_MARGIN && i < 4; i++) {
    // Jumat berikutnya setelah e (lewat nextHarvestClose lagi, bukan +7 hari, supaya pergeseran DST ikut benar).
    e = BigInt(Math.floor(nextHarvestClose(new Date(Number(e + 1n) * 1000)).getTime() / 1000));
  }
  if (e < now + minDuration + EXPIRY_MARGIN || e > now + maxDuration) return null;
  return e;
}

export function nextSpurAction(s: SpurSnapshot): SpurAction {
  if (!s.active) {
    if (s.paused) return { action: "wait", reason: "vault paused: rollRound disabled until ADMIN unpauses" };
    const expiry = rollExpiry(s.now, s.minDuration, s.maxDuration);
    if (expiry === null) return { action: "wait", reason: "no Friday 16:00 ET expiry fits the contract duration bounds" };
    // Tanpa syarat harga live di sini: kontrak sendiri menolak roll saat pasar tutup/harga basi bila ada yang dijual,
    // dan tetap memproses antrean bila tidak ada yang dijual. Eksekutor mensimulasikan dulu dan melaporkan alasannya.
    return { action: "roll", expiry };
  }
  const r = s.current;
  if (!r) return { action: "wait", reason: "active but no round data (inconsistent state)" };
  if (isZero(r.picker)) {
    // Belum terjual: Picker boleh membeli sampai start + fillWindow; lewat itu siapa saja boleh menutup.
    return s.now <= r.start + s.fillWindow ? { action: "fill", round: s.round } : { action: "closeUnsold" };
  }
  if (s.now < r.expiry) return { action: "wait", reason: `round #${s.round} runs until ${new Date(Number(r.expiry) * 1000).toISOString()}` };
  return s.settlementRecorded ? { action: "settleRound" } : { action: "recordSettlement" };
}

// ---------------------------------------------------------------------------------------------
// Mencari round Chainlink untuk SettlementOracle.settle / settleFallback.
// ---------------------------------------------------------------------------------------------
export interface FeedRound { updatedAt: bigint }
export interface FeedReader {
  latest(): Promise<{ id: bigint; updatedAt: bigint }>;
  /** null bila round tidak ada. Galat jaringan dilempar (jangan disamakan dengan "tidak ada"). */
  round(id: bigint): Promise<FeedRound | null>;
}
export type SettlementPick =
  | { kind: "print"; roundId: bigint }
  | { kind: "fallback"; roundId: bigint }
  | { kind: "wait"; reason: string }
  | { kind: "stuck"; reason: string };

const NO_MASK = (1n << 64n) - 1n;

/**
 * Aturan kontrak (SettlementOracle):
 *  - settle: round PERTAMA dengan updatedAt >= expiry, harus muncul dalam maxPrintDelay, dan round sebelumnya (id-1) di fase sama < expiry.
 *  - settleFallback: setelah expiry + maxPrintDelay, round TERAKHIR sebelum expiry, bila tidak ada print di jendela.
 * Round id Chainlink = (fase << 64) | nomor; nomor naik satu per round di fase yang sama, jadi updatedAt tidak menurun dan pencarian biner sah.
 * Fungsi ini hanya menunjuk kandidat; kontrak tetap memverifikasi semuanya dan eksekutor mensimulasikan sebelum mengirim.
 */
export async function findSettlementRound(feed: FeedReader, expiry: bigint, maxPrintDelay: bigint, now: bigint): Promise<SettlementPick> {
  const latest = await feed.latest();
  const phase = latest.id >> 64n;
  const lastNo = latest.id & NO_MASK;
  const id = (no: bigint) => (phase << 64n) | no;
  const windowClosed = now > expiry + maxPrintDelay;

  if (latest.updatedAt < expiry) {
    // Belum ada print setelah expiry.
    return windowClosed
      ? { kind: "fallback", roundId: latest.id } // round terakhir sebelum expiry = round terbaru
      : { kind: "wait", reason: "no feed update since expiry yet; print window still open" };
  }

  // Cari nomor terkecil dengan updatedAt >= expiry di fase terbaru. `hi` memenuhi syarat (latest).
  let lo = 1n, hi = lastNo;
  while (lo < hi) {
    const mid = (lo + hi) / 2n;
    const r = await feed.round(id(mid));
    if (r === null) return { kind: "stuck", reason: `feed round ${id(mid)} missing inside the latest phase; cannot bisect safely` };
    if (r.updatedAt >= expiry) hi = mid; else lo = mid + 1n;
  }
  const first = lo;
  if (first <= 1n) {
    return { kind: "stuck", reason: "the first round after expiry is the first round of a Chainlink phase (PhaseBoundary): the contract rejects it and has no admin path" };
  }
  const print = await feed.round(id(first));
  if (print === null) return { kind: "stuck", reason: `feed round ${id(first)} disappeared` };
  if (print.updatedAt - expiry <= maxPrintDelay) return { kind: "print", roundId: id(first) };
  // Print terlambat: kontrak menolak `settle`; jalur fallback memakai round tepat sebelum print, setelah jendela lewat.
  return windowClosed
    ? { kind: "fallback", roundId: id(first - 1n) }
    : { kind: "wait", reason: "first post-expiry print arrived too late; waiting for the fallback window" };
}
