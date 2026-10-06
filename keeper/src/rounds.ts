// Perencana round mingguan untuk keeper (murni, tanpa jaringan). Dasar: halaman /docs, alur kerja (bagian 3),
// dan keputusan "strike = persen tetap OTM" (bukan target delta). Kontrak SpurVault/HarvestAuction BELUM ada,
// jadi modul ini hanya memutuskan APA yang harus dilakukan; pemanggilan kontrak menyusul bersama kontraknya.
import { nextHarvestClose } from "../../lib/schedule.ts";

export type VaultKind = "spur" | "graft";
export type RoundStatus = "open" | "auctioned" | "settled" | "cancelled";

const BPS = 10_000n;

/**
 * Strike per token (18 desimal). Spur = call: di ATAS harga, dibulatkan ke ATAS ke kelipatan tick.
 * Graft = put: di BAWAH harga, dibulatkan ke BAWAH. Pembulatan selalu menjauh dari harga (OTM tidak pernah menyusut).
 */
export function strikeFor(kind: VaultKind, spotE18: bigint, otmBps: number, tickE18: bigint): bigint {
  if (spotE18 <= 0n) throw new RangeError("harga harus > 0");
  if (!Number.isInteger(otmBps) || otmBps < 0 || otmBps > 5_000) throw new RangeError("otmBps 0..5000");
  if (tickE18 <= 0n) throw new RangeError("tick harus > 0");
  const o = BigInt(otmBps);
  if (kind === "spur") {
    const raw = (spotE18 * (BPS + o) + BPS - 1n) / BPS; // ceil
    return ((raw + tickE18 - 1n) / tickE18) * tickE18;
  }
  const raw = (spotE18 * (BPS - o)) / BPS; // floor
  const k = (raw / tickE18) * tickE18;
  if (k <= 0n) throw new RangeError("strike put menjadi nol: kurangi otmBps atau tick");
  return k;
}

const TRANSITIONS: Record<RoundStatus, readonly RoundStatus[]> = {
  open: ["auctioned", "cancelled"], // cancelled = SpurVault.closeUnsold (tanpa Picker sampai start + FILL_WINDOW), bukan expiry; keeper Spur memakai spur-plan.ts yang membaca chain
  auctioned: ["settled"],
  settled: [],
  cancelled: [],
};
export const canTransition = (from: RoundStatus, to: RoundStatus) => TRANSITIONS[from].includes(to);

export interface RoundView { roundNo: number; status: RoundStatus; expiry: Date }
export type RoundAction =
  | { action: "roll"; expiry: Date; roundNo: number }
  | { action: "settle"; roundNo: number }
  | { action: "wait"; reason: string };

/**
 * Langkah keeper berikutnya.
 *  - Ada round open/auctioned yang sudah lewat expiry: settle bila harga settlement sudah tercatat di oracle,
 *    selain itu tunggu (keeper tidak boleh memilih harga; SettlementOracle yang memverifikasi).
 *  - Round open/auctioned belum expiry: tunggu.
 *  - Tidak ada round aktif: buka round baru ke Jumat 16:00 ET berikutnya, hanya bila harga live (strike butuh harga segar).
 */
export function nextRoundAction(i: { now: Date; latest: RoundView | null; settlementRecorded: boolean; pricesLive: boolean }): RoundAction {
  const r = i.latest;
  if (r && (r.status === "open" || r.status === "auctioned")) {
    if (i.now.getTime() < r.expiry.getTime()) return { action: "wait", reason: `round #${r.roundNo} runs until ${r.expiry.toISOString()}` };
    if (r.status === "open") return { action: "wait", reason: `round #${r.roundNo} expired without a Picker; needs the cancel path (undecided)` };
    return i.settlementRecorded ? { action: "settle", roundNo: r.roundNo } : { action: "wait", reason: `round #${r.roundNo} expired; settlement price not recorded yet` };
  }
  if (!i.pricesLive) return { action: "wait", reason: "prices not live; cannot set a strike" };
  const expiry = nextHarvestClose(i.now);
  return { action: "roll", expiry, roundNo: (r?.roundNo ?? 0) + 1 };
}
