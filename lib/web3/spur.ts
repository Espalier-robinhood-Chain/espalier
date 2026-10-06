// Logika murni untuk panel deposit/withdraw Spur (tanpa viem/wagmi/React) supaya bisa dites dengan node --test.
// Hanya `import type`: aman dihapus oleh Node dan tidak menarik SDK ke tes.
import type { GraftVaultInfo, SpurAccountState, SpurError, SpurVaultInfo } from "@espalier/sdk";
import { formatAmount } from "./trade.ts";

/**
 * GraftVault: aset vault = USDG = premium (kontrak tidak punya getter PREMIUM terpisah di SDK), jadi info Graft dipetakan ke bentuk
 * `SpurVaultInfo` supaya panel, `checkDeposit`, dan `spurErrorMessage` dipakai bersama tanpa cabang per jenis vault.
 */
export function graftInfoToSpurInfo(g: GraftVaultInfo): SpurVaultInfo {
  return {
    asset: g.asset, assetSymbol: g.assetSymbol, assetDecimals: g.assetDecimals,
    premium: g.asset, premiumSymbol: g.assetSymbol, premiumDecimals: g.assetDecimals,
    minDeposit: g.minDeposit, depositCap: g.depositCap,
  };
}

export const UINT256_MAX = (1n << 256n) - 1n;

type State = Pick<SpurAccountState, "round" | "active" | "paused" | "totalShares" | "managedAssets" | "pendingDeposits" | "shares" | "assets" | "depositRound" | "depositAmount" | "withdrawRound" | "withdrawShares" | "assetBalance" | "assetAllowance">;
type Info = Pick<SpurVaultInfo, "minDeposit" | "depositCap" | "assetDecimals">;

/**
 * Setoran yang masih antre (belum diubah jadi share oleh roll). Receipt dengan round <= round berjalan sudah diproses roll
 * (belum disinkron di storage, tapi sudah masuk `shares`), jadi tidak lagi bisa dibatalkan (`cancelDeposit` menolaknya).
 */
export function queuedDeposit(s: Pick<State, "round" | "depositRound" | "depositAmount">): bigint {
  return s.depositAmount > 0n && s.depositRound > s.round ? s.depositAmount : 0n;
}

/** Share yang sedang antre untuk ditarik di roll berikutnya. Aturannya sama dengan `queuedDeposit`. */
export function queuedWithdrawShares(s: Pick<State, "round" | "withdrawRound" | "withdrawShares">): bigint {
  return s.withdrawShares > 0n && s.withdrawRound > s.round ? s.withdrawShares : 0n;
}

/** Share yang masih bisa diantrikan untuk ditarik (`requestWithdraw` menolak lebih dari ini). */
export function withdrawableShares(s: Pick<State, "shares" | "round" | "withdrawRound" | "withdrawShares">): bigint {
  const free = s.shares - queuedWithdrawShares(s);
  return free > 0n ? free : 0n;
}

/** Sisa ruang sebelum batas setoran. null = tanpa batas. */
export function capRoom(info: Pick<Info, "depositCap">, s: Pick<State, "managedAssets" | "pendingDeposits">): bigint | null {
  if (info.depositCap === UINT256_MAX) return null;
  const used = s.managedAssets + s.pendingDeposits;
  return info.depositCap > used ? info.depositCap - used : 0n;
}

/** Nilai Stock Token dari `shares` pada harga per share saat ini (dibulatkan ke bawah, sama dengan kontrak). */
export function sharesToAssets(shares: bigint, s: Pick<State, "totalShares" | "managedAssets">): bigint {
  return s.totalShares === 0n ? 0n : (shares * s.managedAssets) / s.totalShares;
}

export type WithdrawPlan =
  | { ok: true; shares: bigint; all: boolean; estAssets: bigint }
  | { ok: false; reason: "noShares" | "tooMuch" | "tooSmall" };

/**
 * Pengguna mengetik jumlah Stock Token, kontrak meminta jumlah share. Konversi dibulatkan ke bawah supaya tidak pernah
 * meminta lebih dari yang dimiliki, dan jumlah yang sama dengan atau di atas nilai seluruh share bebas = tarik semuanya
 * (menghindari debu pembulatan yang tertinggal).
 */
export function planWithdraw(amount: bigint, s: Pick<State, "shares" | "round" | "withdrawRound" | "withdrawShares" | "totalShares" | "managedAssets">): WithdrawPlan {
  const free = withdrawableShares(s);
  if (free === 0n) return { ok: false, reason: "noShares" };
  const freeValue = sharesToAssets(free, s);
  if (amount > freeValue) return { ok: false, reason: "tooMuch" };
  if (amount === freeValue) return { ok: true, shares: free, all: true, estAssets: freeValue };
  if (s.managedAssets === 0n) return { ok: false, reason: "tooSmall" };
  const shares = (amount * s.totalShares) / s.managedAssets;
  if (shares === 0n) return { ok: false, reason: "tooSmall" };
  return { ok: true, shares, all: false, estAssets: sharesToAssets(shares, s) };
}

export type DepositCheck =
  | { ok: true; needsApproval: boolean }
  | { ok: false; reason: "paused" | "tooSmall" | "overBalance" | "overCap" };

/** Pemeriksaan sebelum deposit. Urutannya = urutan yang paling berguna ditampilkan ke pengguna. */
export function checkDeposit(amount: bigint, info: Pick<Info, "minDeposit" | "depositCap">, s: Pick<State, "paused" | "managedAssets" | "pendingDeposits" | "assetBalance" | "assetAllowance">): DepositCheck {
  if (s.paused) return { ok: false, reason: "paused" };
  if (amount < info.minDeposit) return { ok: false, reason: "tooSmall" };
  if (amount > s.assetBalance) return { ok: false, reason: "overBalance" };
  const room = capRoom(info, s);
  if (room !== null && amount > room) return { ok: false, reason: "overCap" };
  return { ok: true, needsApproval: s.assetAllowance < amount };
}

/** Pesan untuk pengguna dari error kontrak SpurVault. `info` dipakai agar angka (setoran minimum) ikut tampil. */
export function spurErrorMessage(e: SpurError, info?: Pick<Info, "minDeposit" | "assetDecimals"> & { assetSymbol?: string }): string {
  switch (e.name) {
    case "DepositTooSmall":
      return info ? `Minimum deposit is ${formatAmount(info.minDeposit, info.assetDecimals)}${info.assetSymbol ? ` ${info.assetSymbol}` : ""}.` : "The deposit is below the minimum.";
    case "DepositCapExceeded": return "This vault has reached its deposit limit. Try a smaller amount.";
    case "EnforcedPause": return "Deposits are paused right now. Withdrawing and claiming still work.";
    case "InsufficientShares": return "That is more than you can withdraw right now.";
    case "NothingToClaim": return "There is nothing to claim yet.";
    case "NothingToCancel": return "Nothing to cancel: this deposit or withdrawal has already been processed by a round.";
    case "ERC20InsufficientAllowance": return "Token allowance is too low. Approve the token first.";
    case "ERC20InsufficientBalance": return "Your balance is too low for this amount.";
    case "SafeERC20FailedOperation": return "The token transfer failed. Nothing was sent.";
    case "ReentrancyGuardReentrantCall": return "Another transaction is in progress. Try again in a moment.";
    default: return "The transaction would fail on-chain. Nothing was sent.";
  }
}
