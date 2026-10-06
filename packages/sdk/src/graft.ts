import { BaseError, ContractFunctionRevertedError, erc20Abi, type Address, type PublicClient } from "viem";
import { graftVaultAbi } from "./abis.ts";
import { spurTokenErrorsAbi, type SpurAccountState, type SpurErrorName } from "./spur.ts";

/**
 * GraftVault (cash-secured put) mencerminkan SpurVault: error, akuntansi, dan getter akun sama.
 * Bedanya: aset vault = USDG (collateral), premium = USDG yang sama, dan `UNDERLYING` = Stock Token acuan harga
 * (tidak pernah dipegang vault). Karena itu `GraftAccountState` memakai bentuk `SpurAccountState`,
 * hanya semantiknya yang beda: `assets`/`claimableAssets`/`assetBalance` dalam USDG.
 */
export type GraftErrorName = SpurErrorName;
export interface GraftError { name: GraftErrorName }
export type GraftAccountState = SpurAccountState;

export const graftWriteAbi = [...graftVaultAbi, ...spurTokenErrorsAbi] as const;

const KNOWN = new Set<string>([
  "DepositTooSmall", "DepositCapExceeded", "InsufficientShares", "NothingToClaim", "NothingToCancel",
  "NotIdle", "NotActive", "InvalidExpiry", "RoundMismatch", "AlreadySold", "NotSold",
  "FillWindowClosed", "FillWindowOpen", "PremiumBelowFloor", "PremiumNotReceived", "NotExpired",
  "SettlementUnavailable", "NotGuardian", "NotAuction", "ZeroAddress", "InvalidConfig",
  "EnforcedPause", "ExpectedPause", "ReentrancyGuardReentrantCall", "SafeERC20FailedOperation",
  "ERC20InsufficientAllowance", "ERC20InsufficientBalance",
]);

/** Ubah error viem (simulate/write) jadi bentuk terstruktur. Tidak pernah melempar. */
export function decodeGraftError(err: unknown): GraftError {
  if (!(err instanceof BaseError)) return { name: "Unknown" };
  const revert = err.walk((e) => e instanceof ContractFunctionRevertedError);
  if (!(revert instanceof ContractFunctionRevertedError)) return { name: "Unknown" };
  const name = revert.data?.errorName;
  return { name: name && KNOWN.has(name) ? (name as GraftErrorName) : "Unknown" };
}

/** Konstanta vault: dibaca sekali per klien. `asset` = USDG (collateral dan premium). */
export interface GraftVaultInfo {
  asset: Address;
  assetSymbol: string;
  assetDecimals: number;
  /** Stock Token acuan harga. */
  underlying: Address;
  underlyingSymbol: string;
  underlyingDecimals: number;
  minDeposit: bigint;
  /** type(uint256).max = tanpa batas. */
  depositCap: bigint;
}

export async function readGraftInfo(client: PublicClient, vault: Address): Promise<GraftVaultInfo> {
  const base = { address: vault, abi: graftVaultAbi } as const;
  const [asset, underlying, minDeposit, depositCap] = await Promise.all([
    client.readContract({ ...base, functionName: "ASSET" }),
    client.readContract({ ...base, functionName: "UNDERLYING" }),
    client.readContract({ ...base, functionName: "MIN_DEPOSIT" }),
    client.readContract({ ...base, functionName: "depositCap" }),
  ]);
  const [assetSymbol, assetDecimals, underlyingSymbol, underlyingDecimals] = await Promise.all([
    client.readContract({ address: asset, abi: erc20Abi, functionName: "symbol" }),
    client.readContract({ address: asset, abi: erc20Abi, functionName: "decimals" }),
    client.readContract({ address: underlying, abi: erc20Abi, functionName: "symbol" }),
    client.readContract({ address: underlying, abi: erc20Abi, functionName: "decimals" }),
  ]);
  return { asset, assetSymbol, assetDecimals, underlying, underlyingSymbol, underlyingDecimals, minDeposit, depositCap };
}

/** Keadaan vault dan satu akun (nilai mentah dari kontrak). Saldo/allowance dibaca dari USDG. */
export async function readGraftAccount(client: PublicClient, vault: Address, info: Pick<GraftVaultInfo, "asset">, account: Address): Promise<GraftAccountState> {
  const base = { address: vault, abi: graftVaultAbi } as const;
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
