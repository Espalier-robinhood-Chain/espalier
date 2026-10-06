"use client";
// Panel deposit/withdraw Spur sungguhan: approve -> simulate -> kirim -> tunggu receipt, lewat wagmi + @espalier/sdk.
// Hanya dirender bila spurLive(symbol) (lihat trade-panels.tsx), jadi WagmiProvider pasti ada.
//
// Aturan SpurVault yang tercermin di sini (contracts/src/SpurVault.sol):
//  * deposit masuk antrean dan baru menjadi share saat roll berikutnya; sebelum itu bisa dibatalkan penuh (cancelDeposit);
//  * penarikan (requestWithdraw) diminta dalam SHARE, dihitung pada harga per share saat roll berikutnya, lalu diambil
//    lewat claimWithdraw; selama antre, share tetap menanggung risiko dan tetap berhak atas premium round yang berjalan;
//  * premium USDG diklaim terpisah (claimPremium); jeda hanya menutup deposit, jalan keluar tidak pernah ditutup.
import { decodeSpurError, readSpurAccount, readSpurInfo, spurWriteAbi, type SpurAccountState, type SpurVaultInfo } from "@espalier/sdk";
import { useCallback, useEffect, useMemo, useState } from "react";
import { erc20Abi, type Hash, type PublicClient } from "viem";
import { useAccount, usePublicClient, useSwitchChain, useWriteContract } from "wagmi";
import { robinhoodMainnet, robinhoodTestnet } from "@/lib/web3/chains";
import { web3Env } from "@/lib/web3/env";
import { capRoom, checkDeposit, planWithdraw, queuedDeposit, queuedWithdrawShares, sharesToAssets, spurErrorMessage, withdrawableShares } from "@/lib/web3/spur";
import { formatAmount, isUserRejection, parseAmount } from "@/lib/web3/trade";
import { Button, Panel } from "./ui";
import { AmountField, Segmented, note } from "./trade-fields";

type Status = { kind: "idle" } | { kind: "busy"; text: string } | { kind: "ok"; text: string; hash?: Hash } | { kind: "error"; text: string };

const REFRESH_MS = 30_000; // roll, settlement, dan klaim terjadi tanpa interaksi pengguna
const explorerOf = (chainId: number) => [robinhoodMainnet, robinhoodTestnet].find((c) => c?.id === chainId)?.blockExplorers?.default.url;

export function LiveDepositWithdrawPanel({ symbol, unit }: { symbol: string; unit?: string }) {
  const target = web3Env.spur!; // dijamin oleh spurLive()
  const { address: account, chainId: walletChain, isConnected } = useAccount();
  const client = usePublicClient({ chainId: target.chainId }) as unknown as PublicClient | undefined;
  const { switchChainAsync } = useSwitchChain();
  const { writeContractAsync } = useWriteContract();

  const [mode, setMode] = useState<"deposit" | "withdraw">("deposit");
  const [amount, setAmount] = useState("");
  const [info, setInfo] = useState<SpurVaultInfo | null>(null);
  // Keadaan disimpan bersama akunnya: saat akun berganti atau terputus, keadaan lama otomatis tidak dipakai (tanpa setState di effect).
  const [read, setRead] = useState<{ account: string; state: SpurAccountState } | null>(null);
  const st = read && account && read.account === account ? read.state : null;
  const [status, setStatus] = useState<Status>({ kind: "idle" });
  const [nonce, setNonce] = useState(0); // naik setelah transaksi (dan berkala): baca ulang keadaan

  const vault = target.address;
  const onTargetChain = walletChain === target.chainId;
  const busy = status.kind === "busy";
  const assetUnit = unit ?? info?.assetSymbol ?? "token";
  const dec = info?.assetDecimals ?? 18;
  const amountRaw = useMemo(() => (info ? parseAmount(amount, dec) : null), [amount, info, dec]);

  // Konstanta vault: sekali per klien.
  useEffect(() => {
    if (!client) return;
    let off = false;
    readSpurInfo(client, vault)
      .then((i) => { if (!off) setInfo(i); })
      .catch(() => { if (!off) setStatus({ kind: "error", text: "Could not read the vault on-chain. Check the vault address and network." }); });
    return () => { off = true; };
  }, [client, vault]);

  // Keadaan vault dan akun. Berkala, karena roll dan settlement terjadi tanpa interaksi pengguna.
  useEffect(() => {
    const t = setInterval(() => setNonce((n) => n + 1), REFRESH_MS);
    return () => clearInterval(t);
  }, []);
  useEffect(() => {
    if (!client || !info || !account) return;
    let off = false;
    readSpurAccount(client, vault, info, account)
      .then((s) => { if (!off) setRead({ account, state: s }); })
      .catch(() => { if (!off) setRead(null); });
    return () => { off = true; };
  }, [client, info, account, vault, nonce]);

  const send = useCallback(async (label: string, fn: () => Promise<Hash>, done: string) => {
    if (!client) return;
    setStatus({ kind: "busy", text: `${label}: confirm in your wallet…` });
    try {
      const hash = await fn();
      setStatus({ kind: "busy", text: `${label}: waiting for confirmation…` });
      const rc = await client.waitForTransactionReceipt({ hash });
      if (rc.status !== "success") { setStatus({ kind: "error", text: `${label} reverted on-chain.` }); return; }
      setStatus({ kind: "ok", text: done, hash });
      setAmount("");
      setNonce((n) => n + 1);
    } catch (e) {
      setStatus(isUserRejection(e) ? { kind: "idle" } : { kind: "error", text: spurErrorMessage(decodeSpurError(e), info ? { ...info, assetSymbol: assetUnit } : undefined) });
    }
  }, [client, info, assetUnit]);

  // Simulasi dulu (error kontrak muncul sebagai pesan, bukan transaksi yang gagal), lalu kirim.
  const call = useCallback(async (fn: "deposit" | "cancelDeposit" | "requestWithdraw" | "cancelWithdraw" | "claimWithdraw" | "claimPremium", args: readonly bigint[]) => {
    if (!client || !account) throw new Error("not ready");
    const req = { address: vault, abi: spurWriteAbi, functionName: fn, args } as never;
    await client.simulateContract({ ...(req as object), account } as never);
    return writeContractAsync({ ...(req as object), chainId: target.chainId } as never) as Promise<Hash>;
  }, [client, account, vault, writeContractAsync, target.chainId]);

  const ensureChain = async () => {
    if (onTargetChain) return true;
    try { await switchChainAsync({ chainId: target.chainId }); } catch { setStatus({ kind: "error", text: "Switch your wallet to the right network to continue." }); }
    return false;
  };

  // ---- turunan
  const queuedDep = st ? queuedDeposit(st) : 0n;
  const queuedWd = st ? queuedWithdrawShares(st) : 0n;
  const free = st ? withdrawableShares(st) : 0n;
  const freeValue = st ? sharesToAssets(free, st) : 0n;
  const dep = info && st && amountRaw !== null ? checkDeposit(amountRaw, info, st) : null;
  const wd = st && amountRaw !== null ? planWithdraw(amountRaw, st) : null;
  const room = info && st ? capRoom(info, st) : null;

  const act = async () => {
    if (!client || !account || !info || !st || amountRaw === null) return;
    if (!(await ensureChain())) return;
    if (mode === "deposit") {
      if (!dep || !dep.ok) return;
      if (dep.needsApproval) {
        // Hanya sebesar jumlah setoran (bukan tak terbatas): paling aman bila vault bermasalah.
        await send(`Approve ${assetUnit}`, async () => {
          await client.simulateContract({ account, address: info.asset, abi: erc20Abi, functionName: "approve", args: [vault, amountRaw] });
          return writeContractAsync({ address: info.asset, abi: erc20Abi, functionName: "approve", args: [vault, amountRaw], chainId: target.chainId });
        }, `${assetUnit} approved. Now deposit.`);
        return;
      }
      await send("Deposit", () => call("deposit", [amountRaw]), `Deposited ${amount} ${assetUnit}. It joins the next round.`);
      return;
    }
    if (!wd || !wd.ok) return;
    await send("Withdraw", () => call("requestWithdraw", [wd.shares]), `Withdrawal queued. It is priced when the next round starts.`);
  };

  let cta = mode === "deposit" ? "Deposit" : "Queue withdrawal";
  if (!isConnected) cta = "Connect wallet first";
  else if (!onTargetChain) cta = "Switch network";
  else if (mode === "deposit" && dep?.ok && dep.needsApproval) cta = `Approve ${assetUnit}`;
  const blockedReason = mode === "deposit"
    ? (dep && !dep.ok ? dep.reason : null)
    : (wd && !wd.ok ? wd.reason : null);
  const disabled = busy || !isConnected || !info || (onTargetChain && (!st || amountRaw === null || blockedReason !== null));
  const explorer = explorerOf(target.chainId);
  const fmt = (v: bigint) => formatAmount(v, dec);

  const problem = (() => {
    if (!onTargetChain || amountRaw === null || !blockedReason || !info) return null;
    switch (blockedReason) {
      case "paused": return "Deposits are paused right now. Withdrawing and claiming still work.";
      case "tooSmall": return mode === "deposit" ? `Minimum deposit is ${fmt(info.minDeposit)} ${assetUnit}.` : "That amount is too small to withdraw.";
      case "overBalance": return `You hold ${fmt(st?.assetBalance ?? 0n)} ${assetUnit} in your wallet.`;
      case "overCap": return `The vault only has room for ${fmt(room ?? 0n)} more ${assetUnit}.`;
      case "noShares": return "You have nothing to withdraw right now.";
      case "tooMuch": return `You can withdraw up to ${fmt(freeValue)} ${assetUnit} now.`;
      default: return null;
    }
  })();

  const hasPosition = st && (st.shares > 0n || queuedDep > 0n || st.claimableAssets > 0n || st.pendingPremium > 0n);
  const premDec = info?.premiumDecimals ?? 6;
  const premSym = info?.premiumSymbol ?? "USDG";

  return (
    <Panel title={`${mode === "deposit" ? "Deposit to" : "Withdraw from"} ${symbol}`}>
      <div className="space-y-4">
        <Segmented label="Deposit or withdraw" value={mode} options={["deposit", "withdraw"]} onChange={(m) => { setMode(m); setAmount(""); setStatus({ kind: "idle" }); }} />
        <AmountField label={mode === "deposit" ? "You deposit" : "You withdraw"} unit={assetUnit} value={amount} onChange={(v) => { setAmount(v); setStatus({ kind: "idle" }); }} />
        {st && (
          <button type="button" className="text-[.86rem] text-bark underline" onClick={() => setAmount(formatAmount(mode === "deposit" ? st.assetBalance : freeValue, dec, dec))}>
            Use max ({fmt(mode === "deposit" ? st.assetBalance : freeValue)} {assetUnit})
          </button>
        )}
        <p className={note}>
          {mode === "deposit"
            ? "Deposits join the next round. Until then you can cancel and get everything back."
            : "Withdrawals queue to the next round and are priced then, after this round's option settles. Until the round ends your shares still earn its premium."}
        </p>
        {st && (
          <p className={note} aria-live="polite">
            {st.active ? `Round #${st.round.toString()} is running.` : "No round is running right now."}
            {st.paused && " Deposits are paused."}
            {room !== null && ` Room left: ${fmt(room)} ${assetUnit}.`}
          </p>
        )}
        {problem && <p role="status" className="text-[.88rem] text-blight">{problem}</p>}
        <Button disabled={disabled} onClick={act} className="w-full">{cta}</Button>

        {hasPosition && st && (
          <div className="space-y-2 rounded-xl border border-wire px-3.5 py-3 text-[.88rem]" aria-live="polite">
            <p className="text-bark">Your position</p>
            <ul className="space-y-0.5 font-mono">
              <li className="flex justify-between gap-3"><span>In rounds</span><span>≈ {fmt(st.assets)} {assetUnit}</span></li>
              {queuedDep > 0n && <li className="flex justify-between gap-3"><span>Deposit queued</span><span>{fmt(queuedDep)} {assetUnit}</span></li>}
              {queuedWd > 0n && <li className="flex justify-between gap-3"><span>Withdrawal queued</span><span>≈ {fmt(sharesToAssets(queuedWd, st))} {assetUnit}</span></li>}
              {st.claimableAssets > 0n && <li className="flex justify-between gap-3"><span>Ready to withdraw</span><span>{fmt(st.claimableAssets)} {assetUnit}</span></li>}
              {st.pendingPremium > 0n && <li className="flex justify-between gap-3"><span>Premium to claim</span><span>{formatAmount(st.pendingPremium, premDec)} {premSym}</span></li>}
            </ul>
            <div className="flex flex-wrap gap-2 pt-1">
              {st.claimableAssets > 0n && <Button variant="ghost" disabled={busy || !onTargetChain} onClick={async () => { if (await ensureChain()) await send("Claim", () => call("claimWithdraw", []), `Withdrew ${fmt(st.claimableAssets)} ${assetUnit} to your wallet.`); }}>Claim {assetUnit}</Button>}
              {st.pendingPremium > 0n && <Button variant="ghost" disabled={busy || !onTargetChain} onClick={async () => { if (await ensureChain()) await send("Claim premium", () => call("claimPremium", []), `Claimed ${formatAmount(st.pendingPremium, premDec)} ${premSym}.`); }}>Claim premium</Button>}
              {queuedDep > 0n && <Button variant="ghost" disabled={busy || !onTargetChain} onClick={async () => { if (await ensureChain()) await send("Cancel deposit", () => call("cancelDeposit", [queuedDep]), `Deposit cancelled. ${fmt(queuedDep)} ${assetUnit} returned to your wallet.`); }}>Cancel deposit</Button>}
              {queuedWd > 0n && <Button variant="ghost" disabled={busy || !onTargetChain} onClick={async () => { if (await ensureChain()) await send("Cancel withdrawal", () => call("cancelWithdraw", [queuedWd]), "Withdrawal cancelled. Your shares stay in the vault."); }}>Cancel withdrawal</Button>}
            </div>
          </div>
        )}

        {status.kind !== "idle" && (
          <p role="status" className={status.kind === "error" ? "text-[.88rem] text-blight" : note}>
            {status.text}
            {status.kind === "ok" && status.hash && explorer && <> <a className="underline" href={`${explorer}/tx/${status.hash}`} target="_blank" rel="noreferrer">View transaction</a></>}
          </p>
        )}
      </div>
    </Panel>
  );
}
