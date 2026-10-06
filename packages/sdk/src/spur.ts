import { BaseError, ContractFunctionRevertedError, erc20Abi, parseAbi, type Address, type PublicClient } from "viem";
import { spurVaultAbi } from "./abis.ts";

/**
 * Error kontrak `SpurVault` (dan error OpenZeppelin yang ikut bocor) yang bisa dikembalikan ke UI.
 * Error token (ERC20Insufficient*) datang dari kontrak token lewat SafeERC20, bukan dari ABI vault, jadi ABI untuk
 * simulate/write adalah `spurWriteAbi` (ABI vault + kedua error itu).
 */
export type SpurErrorName =
  | "DepositTooSmall" | "DepositCapExceeded" | "InsufficientShares" | "NothingToClaim" | "NothingToCancel"
  | "NotIdle" | "NotActive" | "InvalidExpiry" | "RoundMismatch" | "AlreadySold" | "NotSold"
  | "FillWindowClosed" | "FillWindowOpen" | "PremiumBelowFloor" | "PremiumNotReceived" | "NotExpired"
  | "SettlementUnavailable" | "NotGuardian" | "NotAuction" | "ZeroAddress" | "InvalidConfig"
  | "EnforcedPause" | "ExpectedPause" | "ReentrancyGuardReentrantCall" | "SafeERC20FailedOperation"
  | "ERC20InsufficientAllowance" | "ERC20InsufficientBalance"
  | "Unknown";

export interface SpurError { name: SpurErrorName }

/** Error token yang bisa muncul dari `transferFrom` di dalam `deposit`. */
export const spurTokenErrorsAbi = parseAbi([
  "error ERC20InsufficientBalance(address sender, uint256 balance, uint256 needed)",
  "error ERC20InsufficientAllowance(address spender, uint256 allowance, uint256 needed)",
]);

/** ABI untuk `simulateContract`/`writeContract` ke SpurVault: supaya error token ikut ter-decode. */
export const spurWriteAbi = [...spurVaultAbi, ...spurTokenErrorsAbi] as const;

const KNOWN = new Set<string>([
  "DepositTooSmall", "DepositCapExceeded", "InsufficientShares", "NothingToClaim", "NothingToCancel",
  "NotIdle", "NotActive", "InvalidExpiry", "RoundMismatch", "AlreadySold", "NotSold",
  "FillWindowClosed", "FillWindowOpen", "PremiumBelowFloor", "PremiumNotReceived", "NotExpired",
  "SettlementUnavailable", "NotGuardian", "NotAuction", "ZeroAddress", "InvalidConfig",
  "EnforcedPause", "ExpectedPause", "ReentrancyGuardReentrantCall", "SafeERC20FailedOperation",
  "ERC20InsufficientAllowance", "ERC20InsufficientBalance",
]);

/** Ubah error viem (simulate/write) jadi bentuk terstruktur. Tidak pernah melempar. */
export function decodeSpurError(err: unknown): SpurError {
  if (!(err instanceof BaseError)) return { name: "Unknown" };
  const revert = err.walk((e) => e instanceof ContractFunctionRevertedError);
  if (!(revert instanceof ContractFunctionRevertedError)) return { name: "Unknown" };
  const name = revert.data?.errorName;
  return { name: name && KNOWN.has(name) ? (name as SpurErrorName) : "Unknown" };
}

/** Konstanta vault: dibaca sekali per klien. */
export interface SpurVaultInfo {
  asset: Address;
  assetSymbol: string;
  assetDecimals: number;
  premium: Address;
  premiumSymbol: string;
  premiumDecimals: number;
  minDeposit: bigint;
  /** type(uint256).max = tanpa batas. */
  depositCap: bigint;
}

export async function readSpurInfo(client: PublicClient, vault: Address): Promise<SpurVaultInfo> {
  const base = { address: vault, abi: spurVaultAbi } as const;
  const [asset, premium, minDeposit, depositCap] = await Promise.all([
    client.readContract({ ...base, functionName: "ASSET" }),
    client.readContract({ ...base, functionName: "PREMIUM" }),
    client.readContract({ ...base, functionName: "MIN_DEPOSIT" }),
    client.readContract({ ...base, functionName: "depositCap" }),
  ]);
  const [assetSymbol, assetDecimals, premiumSymbol, premiumDecimals] = await Promise.all([
    client.readContract({ address: asset, abi: erc20Abi, functionName: "symbol" }),
    client.readContract({ address: asset, abi: erc20Abi, functionName: "decimals" }),
    client.readContract({ address: premium, abi: erc20Abi, functionName: "symbol" }),
    client.readContract({ address: premium, abi: erc20Abi, functionName: "decimals" }),
  ]);
  return { asset, assetSymbol, assetDecimals, premium, premiumSymbol, premiumDecimals, minDeposit, depositCap };
}

/** Keadaan vault dan satu akun pada saat yang sama (satu pembacaan, tanpa multicall). Semua nilai mentah dari kontrak. */
export interface SpurAccountState {
  round: bigint;
  active: boolean;
  paused: boolean;
  totalShares: bigint;
  managedAssets: bigint;
  pendingDeposits: bigint;
  /** Share akun termasuk setoran yang sudah diproses roll tapi belum disinkron, dikurangi penarikan yang sudah diproses. */
  shares: bigint;
  /** Nilai Stock Token dari `shares` pada harga per share saat ini (belum memperhitungkan opsi yang berjalan). */
  assets: bigint;
  depositRound: bigint;
  depositAmount: bigint;
  withdrawRound: bigint;
  withdrawShares: bigint;
  /** Stock Token dari penarikan yang sudah diproses roll dan bisa diambil. */
  claimableAssets: bigint;
  /** Premium USDG yang bisa diklaim sekarang. */
  pendingPremium: bigint;
  assetBalance: bigint;
  assetAllowance: bigint;
}

export async function readSpurAccount(client: PublicClient, vault: Address, info: Pick<SpurVaultInfo, "asset">, account: Address): Promise<SpurAccountState> {
  const base = { address: vault, abi: spurVaultAbi } as const;
  const [round, active, paused, totalShares, managedAssets, pendingDeposits, shares, assets, dep, wd, claimableAssets, pendingPremium, assetBalance, assetAllowance] =
    await Promise.all([
      client.readContract({ ...base, functionName: "round" }),
      client.readContract({ ...base, functionName: "active" }),
      client.readContract({ ...base, functionName: "paused" }),
      client.readContract({ ...base, functionName: "totalShares" }),
      client.readContract({ ...base, functionName: "managedAssets" }),
      client.readContract({ ...base, functionName: "pendingDeposits" }),
      client.readContract({ ...base, functionName: "sharesOf", args: [account] }),
      client.readContract({ ...base, functionName: "assetsOf", args: [account] }),
      client.readContract({ ...base, functionName: "depositOf", args: [account] }),
      client.readContract({ ...base, functionName: "withdrawOf", args: [account] }),
      client.readContract({ ...base, functionName: "pendingWithdrawAssets", args: [account] }),
      client.readContract({ ...base, functionName: "pendingPremium", args: [account] }),
      client.readContract({ address: info.asset, abi: erc20Abi, functionName: "balanceOf", args: [account] }),
      client.readContract({ address: info.asset, abi: erc20Abi, functionName: "allowance", args: [account, vault] }),
    ]);
  return {
    round, active, paused, totalShares, managedAssets, pendingDeposits, shares, assets,
    depositRound: dep[0], depositAmount: dep[1], withdrawRound: wd[0], withdrawShares: wd[1],
    claimableAssets, pendingPremium, assetBalance, assetAllowance,
  };
}
