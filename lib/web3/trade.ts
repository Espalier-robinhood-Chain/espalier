// Logika murni untuk panel mint/redeem (tanpa viem/wagmi/React) supaya bisa dites dengan node --test.
// Hanya `import type`: aman dihapus oleh Node dan tidak menarik SDK ke tes.
import type { CordonError } from "@espalier/sdk";

/**
 * Ubah teks jumlah desimal ("12.5") jadi satuan terkecil. Ketat: tanpa tanda, tanpa notasi ilmiah,
 * tanpa pembulatan diam-diam (digit di luar `decimals` ditolak). null = bukan angka valid atau nol.
 */
export function parseAmount(text: string, decimals: number): bigint | null {
  const t = text.trim();
  if (!/^\d*\.?\d*$/.test(t) || t === "" || t === ".") return null;
  const [whole = "", frac = ""] = t.split(".");
  if (frac.length > decimals) return null;
  const raw = BigInt((whole || "0") + frac.padEnd(decimals, "0"));
  return raw === 0n ? null : raw;
}

/** Satuan terkecil → teks desimal, tanpa nol buntut. `maxFrac` memotong (bukan membulatkan) pecahan. */
export function formatAmount(value: bigint, decimals: number, maxFrac = 6): string {
  const neg = value < 0n;
  const v = neg ? -value : value;
  const base = 10n ** BigInt(decimals);
  const whole = v / base;
  const rem = v % base;
  const frac = rem.toString().padStart(decimals, "0").slice(0, maxFrac).replace(/0+$/, "");
  // Jangan menampilkan "0" bila sebenarnya ada sisa yang terpotong.
  if (whole === 0n && frac === "" && rem !== 0n) return `${neg ? "-" : ""}<${(10 ** -maxFrac).toFixed(maxFrac)}`;
  return `${neg ? "-" : ""}${whole.toString()}${frac ? `.${frac}` : ""}`;
}

/** Penolakan oleh pengguna di wallet (EIP-1193 4001 atau viem UserRejectedRequestError), di mana pun dalam rantai `cause`. */
export function isUserRejection(err: unknown): boolean {
  let e: unknown = err;
  for (let i = 0; i < 8 && e && typeof e === "object"; i++) {
    const o = e as { name?: unknown; code?: unknown; cause?: unknown };
    if (o.name === "UserRejectedRequestError" || o.code === 4001) return true;
    e = o.cause;
  }
  return false;
}

/** Pesan untuk pengguna dari error kontrak CordonVault. `symbols` = simbol token komponen (urutan kontrak). */
export function cordonErrorMessage(e: CordonError, symbols: readonly string[] = []): string {
  const tok = (i?: number) => (i !== undefined && symbols[i]) || (i !== undefined ? `component #${i + 1}` : "a component");
  switch (e.name) {
    case "ZeroAmount": return "Enter an amount greater than zero.";
    case "SlippageExceeded": return `The price moved past your slippage limit on ${tok(e.index)}. Refresh the quote and try again, or raise slippage.`;
    case "ShortReceipt": return `${tok(e.index)} delivered less than expected (fee-on-transfer token?). Nothing was minted.`;
    case "NotSeeded": return "This cordon has not been seeded yet, so it cannot be minted.";
    case "AssetPaused": return "Minting is paused because a component asset is paused. Redeeming in-kind still works.";
    case "InvalidMask": return "Select at least one component to receive.";
    case "LengthMismatch": return "The quote is out of date. Refresh and try again.";
    case "PriceUnavailable": return `No valid price for ${tok(e.index)} right now. Try again when the market is open.`;
    case "ZeroAddress": return "Invalid recipient address.";
    case "VenueNotSet": return "Redeeming to USDG is not enabled for this cordon. Redeem in-kind instead.";
    case "UsdgSlippage": return "The USDG payout fell below your slippage limit. Refresh the quote and try again, or raise slippage.";
    case "ERC20InsufficientAllowance": return "Token allowance is too low. Approve the token first.";
    case "ERC20InsufficientBalance": return "Your balance is too low for this amount.";
    default: return "The transaction would fail on-chain. Nothing was sent.";
  }
}

export const SLIPPAGE_OPTIONS = { "0.5%": 50, "1%": 100 } as const;
export type SlippageLabel = keyof typeof SLIPPAGE_OPTIONS;

/** Token komponen mana yang perlu di-approve (urutan komponen), memakai batas atas yang akan disetujui. */
export function pendingApprovals(allowances: readonly bigint[], required: readonly bigint[]): number[] {
  const out: number[] = [];
  for (let i = 0; i < required.length; i++) if ((required[i] ?? 0n) > 0n && (allowances[i] ?? 0n) < (required[i] ?? 0n)) out.push(i);
  return out;
}

/** Pesan saat kuotasi atau transaksi "To USDG" gagal karena harga live tidak ada (tidak masuk ABI vault, jadi tidak ter-decode). */
export const USDG_PRICE_UNAVAILABLE = "Live prices are unavailable right now (market closed or a price feed is stale), so redeeming to USDG is not possible. Redeem in-kind instead.";
