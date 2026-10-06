// Bilangan bulat satuan terkecil -> string desimal eksak untuk kolom `numeric` Postgres (tanpa float, tanpa kehilangan presisi).
export function toDecimal(value: bigint, decimals: number): string {
  if (!Number.isInteger(decimals) || decimals < 0) throw new RangeError("decimals tidak valid");
  const neg = value < 0n;
  const v = neg ? -value : value;
  if (decimals === 0) return `${neg ? "-" : ""}${v}`;
  const s = v.toString().padStart(decimals + 1, "0");
  const whole = s.slice(0, -decimals);
  const frac = s.slice(-decimals).replace(/0+$/, "");
  return `${neg ? "-" : ""}${whole}${frac ? `.${frac}` : ""}`;
}

export const ZERO = "0x0000000000000000000000000000000000000000";
export const lower = (a: string) => a.toLowerCase();

/** Pecah [from, to] (inklusif) jadi potongan berukuran paling besar `size`. */
export function chunkRanges(from: bigint, to: bigint, size: bigint): Array<[bigint, bigint]> {
  if (size <= 0n) throw new RangeError("size harus > 0");
  const out: Array<[bigint, bigint]> = [];
  for (let a = from; a <= to; a += size) out.push([a, a + size - 1n < to ? a + size - 1n : to]);
  return out;
}
