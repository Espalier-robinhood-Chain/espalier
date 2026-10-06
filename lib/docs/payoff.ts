// Hasil per saham pada expiry, relatif terhadap harga awal round (S0), dalam persen.
// Angka ilustratif untuk diagram di Docs: bukan prakiraan dan bukan data produk.
export type PayoffInput = { start: number; strike: number; premiumPct: number };

/** Memegang saham saja: ikut naik dan turun penuh. */
export function holdResult(price: number, start: number): number {
  return ((price - start) / start) * 100;
}

/** Spur (covered call, cash-settled dalam token): keuntungan dibatasi di strike, premium tetap diterima. */
export function spurResult(price: number, { start, strike, premiumPct }: PayoffInput): number {
  return ((Math.min(price, strike) - start) / start) * 100 + premiumPct;
}

/** Graft (cash-secured put, cash-settled): premium diterima; di bawah strike vault membayar selisihnya. */
export function graftResult(price: number, { start, strike, premiumPct }: PayoffInput): number {
  return (-Math.max(strike - price, 0) / start) * 100 + premiumPct;
}
