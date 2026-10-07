// Pemetaan round on-chain -> bentuk baris `rounds`. Murni (tanpa viem/SDK) supaya bisa dites dengan node --test.
// Aturannya sama dengan indexer (indexer/src/spur-sync.ts, roundRow): outcome 0 = Pending, picker kosong = belum terjual.
export type OnchainRound = {
  expiry: bigint; strikeE18: bigint; startPriceE18: bigint; notional: bigint;
  picker: string; premium: bigint; outcome: number;
};

/** Bentuk yang sama dengan baris `rounds` yang dipakai lib/api/queries.ts, khusus round yang sedang berjalan. */
export type LiveRound = {
  vault_id: string; round_no: number; strike: number; expiry: string; notional: number;
  premium_usdg: number | null; spot_start: number | null; picker: string | null;
  settlement_price: null; settled_at: null; status: "open" | "auctioned";
};

const ZERO_ADDR = /^0x0{40}$/i;

/** bigint skala `decimals` -> number (tampilan saja; nilai uang sebenarnya tetap dibaca on-chain oleh panel). */
export function toNumber(v: bigint, decimals: number): number {
  if (decimals === 0) return Number(v);
  const s = v.toString().padStart(decimals + 1, "0");
  return Number(`${s.slice(0, s.length - decimals)}.${s.slice(s.length - decimals)}`);
}

/**
 * Round yang sedang berjalan dari state kontrak. null = bukan round berjalan (expiry 0 = RoundSkipped, atau outcome
 * bukan Pending). Kalau `active()` false, pemanggil tidak memanggil fungsi ini sama sekali.
 */
export function liveRoundRow(r: OnchainRound, no: number, vaultId: string, notionalDecimals: number, premiumDecimals: number): LiveRound | null {
  if (r.expiry === 0n || r.outcome !== 0) return null;
  const sold = !ZERO_ADDR.test(r.picker);
  return {
    vault_id: vaultId,
    round_no: no,
    strike: toNumber(r.strikeE18, 18),
    expiry: new Date(Number(r.expiry) * 1000).toISOString(),
    notional: toNumber(r.notional, notionalDecimals),
    premium_usdg: sold ? toNumber(r.premium, premiumDecimals) : null,
    spot_start: toNumber(r.startPriceE18, 18),
    picker: sold ? r.picker.toLowerCase() : null,
    settlement_price: null,
    settled_at: null,
    status: sold ? "auctioned" : "open",
  };
}