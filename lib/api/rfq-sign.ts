// Murni (tanpa Next). Kebijakan dan struktur tanda tangan quote RFQ Picker.
// Mainnet (4663) hanya bila RFQ_ALLOW_MAINNET=true DAN batas premi/notional diisi eksplisit (tanpa nilai bawaan): Picker memakai USDG sungguhan.
// Struktur EIP-712 mengikuti HarvestAuction.sol: domain ("EspalierHarvestAuction", "1") dan QUOTE_TYPEHASH.
import { isAddress, type Address } from "viem";

export const QUOTE_TYPES = {
  Quote: [
    { name: "vault", type: "address" }, { name: "picker", type: "address" }, { name: "round", type: "uint64" },
    { name: "strikeE18", type: "uint256" }, { name: "expiry", type: "uint64" }, { name: "notional", type: "uint256" },
    { name: "premium", type: "uint256" }, { name: "deadline", type: "uint64" },
  ],
} as const;

export interface RfqRequest { chainId: number; auction: Address; vault: Address; round: bigint; strikeE18: bigint; expiry: bigint; notional: bigint; minPremium: bigint }
export interface RfqPolicy { chainId: number; auction: Address; vaults: Address[]; premium: bigint; maxPremium: bigint; /** 0n = tanpa batas (testnet). Mainnet wajib > 0. */ maxNotional: bigint; deadlineSecs: number }
export type Decision = { ok: true; premium: bigint; deadline: bigint } | { ok: false; reason: string };

const UINT = /^\d{1,78}$/;
const U64 = 1n << 64n, U256 = 1n << 256n;
const lc = (a: string) => a.toLowerCase();

function uint(v: unknown, name: string, max: bigint): bigint {
  const s = typeof v === "number" && Number.isSafeInteger(v) && v >= 0 ? String(v) : typeof v === "string" ? v.trim() : "";
  if (!UINT.test(s)) throw new Error(`${name} harus bilangan bulat tak negatif`);
  const n = BigInt(s);
  if (n >= max) throw new Error(`${name} melebihi batas`);
  return n;
}

function addr(v: unknown, name: string): Address {
  if (typeof v !== "string" || !isAddress(v, { strict: false }) || /^0x0{40}$/.test(v)) throw new Error(`${name} bukan alamat valid`);
  return v as Address;
}

/** Membaca env. RFQ_AUCTION_ADDRESS wajib; vault yang boleh diberi quote diambil dari SPUR_VAULT_ADDRESS / GRAFT_VAULT_ADDRESS. */
export function loadRfqPolicy(e: Record<string, string | undefined>): RfqPolicy {
  const chainId = Number(e.RFQ_CHAIN_ID?.trim() || e.KEEPER_CHAIN_ID?.trim() || e.INDEXER_CHAIN_ID?.trim() || 46630);
  if (!Number.isInteger(chainId) || chainId < 1) throw new Error("chain id tidak valid");
  const mainnet = chainId === 4663;
  if (mainnet && e.RFQ_ALLOW_MAINNET?.trim() !== "true") throw new Error("RFQ route ini hanya untuk testnet; mainnet 4663 butuh RFQ_ALLOW_MAINNET=true (Picker memakai USDG sungguhan)");
  if (mainnet) for (const k of ["RFQ_PREMIUM_RAW", "RFQ_MAX_PREMIUM_RAW", "RFQ_MAX_NOTIONAL_RAW"]) if (!e[k]?.trim()) throw new Error(`mainnet: ${k} wajib diisi eksplisit (tanpa nilai bawaan)`);
  const auction = addr(e.RFQ_AUCTION_ADDRESS?.trim(), "RFQ_AUCTION_ADDRESS");
  const vaults = [e.SPUR_VAULT_ADDRESS, e.GRAFT_VAULT_ADDRESS].map((s) => s?.trim()).filter((s): s is string => !!s).map((s, i) => addr(s, i === 0 ? "SPUR_VAULT_ADDRESS" : "GRAFT_VAULT_ADDRESS"));
  if (!vaults.length) throw new Error("isi SPUR_VAULT_ADDRESS dan/atau GRAFT_VAULT_ADDRESS");
  const premium = uint(e.RFQ_PREMIUM_RAW?.trim() || "5000000", "RFQ_PREMIUM_RAW", U256); // 6 desimal: 5 USDG
  const maxPremium = uint(e.RFQ_MAX_PREMIUM_RAW?.trim() || "20000000", "RFQ_MAX_PREMIUM_RAW", U256);
  const maxNotional = e.RFQ_MAX_NOTIONAL_RAW?.trim() ? uint(e.RFQ_MAX_NOTIONAL_RAW.trim(), "RFQ_MAX_NOTIONAL_RAW", U256) : 0n;
  if (premium === 0n) throw new Error("RFQ_PREMIUM_RAW harus lebih dari 0");
  if (premium > maxPremium) throw new Error("RFQ_PREMIUM_RAW melebihi RFQ_MAX_PREMIUM_RAW");
  if (mainnet && maxNotional === 0n) throw new Error("mainnet: RFQ_MAX_NOTIONAL_RAW harus lebih dari 0");
  return { chainId, auction, vaults, premium, maxPremium, maxNotional, deadlineSecs: 900 };
}

/** Memvalidasi badan permintaan dari keeper. Melempar galat bila bentuknya salah. */
export function parseRfqRequest(json: unknown): RfqRequest {
  if (!json || typeof json !== "object") throw new Error("badan permintaan harus objek JSON");
  const o = json as Record<string, unknown>;
  const chainId = Number(o.chainId);
  if (!Number.isInteger(chainId) || chainId < 1) throw new Error("chainId tidak valid");
  return {
    chainId, auction: addr(o.auction, "auction"), vault: addr(o.vault, "vault"),
    round: uint(o.round, "round", U64), strikeE18: uint(o.strikeE18, "strikeE18", U256), expiry: uint(o.expiry, "expiry", U64),
    notional: uint(o.notional, "notional", U256), minPremium: uint(o.minPremium, "minPremium", U256),
  };
}

/** Kebijakan: hanya chain, auction, dan vault yang dikenal; round belum expiry; premi = max(tetap, minPremium) dan tidak melewati batas. */
export function decideQuote(r: RfqRequest, p: RfqPolicy, nowSec: number): Decision {
  if (r.chainId !== p.chainId) return { ok: false, reason: "chainId tidak cocok" };
  if (lc(r.auction) !== lc(p.auction)) return { ok: false, reason: "auction tidak dikenal" };
  if (!p.vaults.some((v) => lc(v) === lc(r.vault))) return { ok: false, reason: "vault tidak ada di daftar" };
  if (r.expiry <= BigInt(nowSec)) return { ok: false, reason: "round sudah lewat expiry" };
  if (p.maxNotional > 0n && r.notional > p.maxNotional) return { ok: false, reason: "notional melewati batas RFQ_MAX_NOTIONAL_RAW" };
  const premium = p.premium > r.minPremium ? p.premium : r.minPremium;
  if (premium > p.maxPremium) return { ok: false, reason: "minPremium melewati batas RFQ_MAX_PREMIUM_RAW" };
  return { ok: true, premium, deadline: BigInt(nowSec + p.deadlineSecs) };
}

export function quoteTypedData(r: RfqRequest, picker: Address, premium: bigint, deadline: bigint) {
  return {
    domain: { name: "EspalierHarvestAuction", version: "1", chainId: r.chainId, verifyingContract: r.auction },
    types: QUOTE_TYPES,
    primaryType: "Quote" as const,
    message: { vault: r.vault, picker, round: r.round, strikeE18: r.strikeE18, expiry: r.expiry, notional: r.notional, premium, deadline },
  };
}
