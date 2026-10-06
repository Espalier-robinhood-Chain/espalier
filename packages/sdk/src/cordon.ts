import {
  BaseError,
  ContractFunctionRevertedError,
  type Address,
  type PublicClient,
} from "viem";
import { cordonVaultAbi } from "./abis.ts";

/** Nama error kontrak `CordonVault` yang bisa dikembalikan ke UI. */
export type CordonErrorName =
  | "ZeroAmount"
  | "SlippageExceeded"
  | "ShortReceipt"
  | "NotSeeded"
  | "AssetPaused"
  | "InvalidMask"
  | "LengthMismatch"
  | "PriceUnavailable"
  | "ZeroAddress"
  /** Error OpenZeppelin yang bocor dari token/vault saat `transferFrom` (tidak menyebut token mana). */
  | "ERC20InsufficientAllowance"
  | "ERC20InsufficientBalance"
  | "Unknown";

export interface CordonError {
  name: CordonErrorName;
  /** Indeks komponen bila error menyebutnya (SlippageExceeded, ShortReceipt, PriceUnavailable). */
  index?: number;
  /** Alamat token bila error menyebutnya (AssetPaused). */
  token?: Address;
}

const KNOWN = new Set<string>([
  "ZeroAmount", "SlippageExceeded", "ShortReceipt", "NotSeeded", "AssetPaused",
  "InvalidMask", "LengthMismatch", "PriceUnavailable", "ZeroAddress",
  "ERC20InsufficientAllowance", "ERC20InsufficientBalance",
]);

/** Ubah error viem (simulate/write) jadi bentuk terstruktur. Tidak pernah melempar. */
export function decodeCordonError(err: unknown): CordonError {
  if (!(err instanceof BaseError)) return { name: "Unknown" };
  const revert = err.walk((e) => e instanceof ContractFunctionRevertedError);
  if (!(revert instanceof ContractFunctionRevertedError)) return { name: "Unknown" };
  const name = revert.data?.errorName;
  if (!name || !KNOWN.has(name)) return { name: "Unknown" };
  const args = (revert.data?.args ?? []) as readonly unknown[];
  const out: CordonError = { name: name as CordonErrorName };
  if (name === "SlippageExceeded" || name === "ShortReceipt" || name === "PriceUnavailable") {
    if (typeof args[0] === "bigint") out.index = Number(args[0]);
  }
  if (name === "AssetPaused" && typeof args[0] === "string") out.token = args[0] as Address;
  return out;
}

const BPS = 10_000n;

/** Batas atas setoran: jumlah × (1 + bps/10000), dibulatkan ke atas. Komponen 0 tetap 0. */
export function maxWithSlippage(amounts: readonly bigint[], slippageBps: number): bigint[] {
  assertBps(slippageBps);
  const s = BigInt(slippageBps);
  return amounts.map((a) => (a * (BPS + s) + BPS - 1n) / BPS);
}

/** Batas bawah penerimaan: jumlah × (1 − bps/10000), dibulatkan ke bawah. */
export function minWithSlippage(amounts: readonly bigint[], slippageBps: number): bigint[] {
  assertBps(slippageBps);
  const s = BigInt(slippageBps);
  return amounts.map((a) => (a * (BPS - s)) / BPS);
}

function assertBps(bps: number): void {
  if (!Number.isInteger(bps) || bps < 0 || bps > 10_000) throw new RangeError("slippageBps harus 0..10000");
}

/** Mask semua komponen (bit 0..n-1 menyala). n maks. 16 (batas kontrak). */
export function fullMask(n: number): bigint {
  if (!Number.isInteger(n) || n < 1 || n > 16) throw new RangeError("jumlah komponen harus 1..16");
  return (1n << BigInt(n)) - 1n;
}

export interface VaultInfo {
  address: Address;
  symbol: string;
  decimals: number;
  components: readonly Address[];
  targetWeightsBps: readonly number[];
  totalSupply: bigint;
}

export async function readVaultInfo(client: PublicClient, vault: Address): Promise<VaultInfo> {
  const base = { address: vault, abi: cordonVaultAbi } as const;
  const [symbol, decimals, components, targetWeightsBps, totalSupply] = await Promise.all([
    client.readContract({ ...base, functionName: "symbol" }),
    client.readContract({ ...base, functionName: "decimals" }),
    client.readContract({ ...base, functionName: "components" }),
    client.readContract({ ...base, functionName: "targetWeightsBps" }),
    client.readContract({ ...base, functionName: "totalSupply" }),
  ]);
  return { address: vault, symbol, decimals, components, targetWeightsBps, totalSupply };
}

export interface MintQuote {
  shares: bigint;
  /** Jumlah tiap komponen yang akan ditarik (sudah termasuk fee mint). */
  amounts: readonly bigint[];
  /** Fee mint dalam share (dicetak ke penerima fee di atas `shares`). */
  feeShares: bigint;
}

export async function quoteMint(client: PublicClient, vault: Address, shares: bigint): Promise<MintQuote> {
  const base = { address: vault, abi: cordonVaultAbi } as const;
  const [amounts, feeShares] = await Promise.all([
    client.readContract({ ...base, functionName: "previewMint", args: [shares] }),
    client.readContract({ ...base, functionName: "feeOnMint", args: [shares] }),
  ]);
  return { shares, amounts, feeShares };
}

export interface RedeemQuote {
  shares: bigint;
  /** Jumlah tiap komponen bila SEMUA komponen diambil. */
  amounts: readonly bigint[];
  feeShares: bigint;
}

export async function quoteRedeem(client: PublicClient, vault: Address, shares: bigint): Promise<RedeemQuote> {
  const base = { address: vault, abi: cordonVaultAbi } as const;
  const [amounts, feeShares] = await Promise.all([
    client.readContract({ ...base, functionName: "previewRedeem", args: [shares] }),
    client.readContract({ ...base, functionName: "feeOnRedeem", args: [shares] }),
  ]);
  return { shares, amounts, feeShares };
}

export interface NavReading {
  ok: boolean;
  totalValueE18: bigint;
  navPerShareE18: bigint;
}

/** NAV dengan harga acuan router. `ok=false` = ada komponen tanpa harga valid; jangan tampilkan angkanya. */
export async function readNav(client: PublicClient, vault: Address): Promise<NavReading> {
  const [ok, totalValueE18, navPerShareE18] = await client.readContract({
    address: vault,
    abi: cordonVaultAbi,
    functionName: "tryNav",
  });
  return { ok, totalValueE18, navPerShareE18 };
}

/** Cek token mana yang kurang: saldo < jumlah, atau allowance < jumlah. Urutan sama dengan komponen. */
export interface ComponentReadiness {
  token: Address;
  needed: bigint;
  balance: bigint;
  allowance: bigint;
  enoughBalance: boolean;
  needsApproval: boolean;
}

const erc20ReadAbi = [
  { type: "function", name: "balanceOf", stateMutability: "view", inputs: [{ name: "a", type: "address" }], outputs: [{ type: "uint256" }] },
  { type: "function", name: "allowance", stateMutability: "view", inputs: [{ name: "o", type: "address" }, { name: "s", type: "address" }], outputs: [{ type: "uint256" }] },
] as const;

export async function checkReadiness(
  client: PublicClient,
  vault: Address,
  owner: Address,
  components: readonly Address[],
  needed: readonly bigint[],
): Promise<ComponentReadiness[]> {
  if (components.length !== needed.length) throw new RangeError("components dan needed beda panjang");
  return Promise.all(
    components.map(async (token, i) => {
      const [balance, allowance] = await Promise.all([
        client.readContract({ address: token, abi: erc20ReadAbi, functionName: "balanceOf", args: [owner] }),
        client.readContract({ address: token, abi: erc20ReadAbi, functionName: "allowance", args: [owner, vault] }),
      ]);
      const need = needed[i] ?? 0n;
      return { token, needed: need, balance, allowance, enoughBalance: balance >= need, needsApproval: allowance < need };
    }),
  );
}
