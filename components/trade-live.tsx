"use client";
// Panel mint/redeem sungguhan (tahap 2 di Alur Kerja): approve -> simulate -> kirim -> tunggu receipt, lewat wagmi + @espalier/sdk.
// Hanya dirender bila tradeLive(symbol) (lihat trade-panels.tsx), jadi WagmiProvider pasti ada.
import { cordonVaultAbi, checkReadiness, decodeCordonError, fullMask, maxWithSlippage, minWithSlippage, quoteMint, quoteRedeem, readVaultInfo, type VaultInfo } from "@espalier/sdk";
import { useCallback, useEffect, useId, useMemo, useState } from "react";
import { erc20Abi, type Address, type Hash, type PublicClient } from "viem";
import { useAccount, usePublicClient, useSwitchChain, useWriteContract } from "wagmi";
import { robinhoodMainnet, robinhoodTestnet } from "@/lib/web3/chains";
import { web3Env } from "@/lib/web3/env";
import { cordonErrorMessage, formatAmount, isUserRejection, parseAmount, pendingApprovals, SLIPPAGE_OPTIONS, type SlippageLabel } from "@/lib/web3/trade";
import { Button, Panel } from "./ui";
import { AmountField, Radio, Segmented, note } from "./trade-fields";

type Comp = { token: Address; symbol: string; decimals: number };
type Quote = { amounts: bigint[]; limits: bigint[]; allowances: bigint[]; balances: bigint[] };
type Status = { kind: "idle" } | { kind: "busy"; text: string } | { kind: "ok"; text: string; hash?: Hash } | { kind: "error"; text: string };

const explorerOf = (chainId: number) =>
  [robinhoodMainnet, robinhoodTestnet].find((c) => c?.id === chainId)?.blockExplorers?.default.url;

export function LiveMintRedeemPanel({ symbol, marketOpen, nextOpen }: { symbol: string; marketOpen: boolean; nextOpen?: string }) {
  const target = web3Env.vault!; // dijamin oleh tradeLive()
  const { address: account, chainId: walletChain, isConnected } = useAccount();
  const client = usePublicClient({ chainId: target.chainId }) as unknown as PublicClient | undefined;
  const { switchChainAsync } = useSwitchChain();
  const { writeContractAsync } = useWriteContract();

  const [mode, setMode] = useState<"mint" | "redeem">("mint");
  const [amount, setAmount] = useState("");
  const [slip, setSlip] = useState<SlippageLabel>("0.5%");
  const [info, setInfo] = useState<VaultInfo | null>(null);
  const [comps, setComps] = useState<Comp[]>([]);
  // Hasil baca disimpan bersama kuncinya (akun / input kuotasi); bila kunci berubah, hasil lama otomatis tidak dipakai (tanpa setState sinkron di effect).
  const [shareRead, setShareRead] = useState<{ account: string; balance: bigint | null } | null>(null);
  const [quoteRead, setQuoteRead] = useState<{ key: string; quote: Quote } | null>(null);
  const [status, setStatus] = useState<Status>({ kind: "idle" });
  const [nonce, setNonce] = useState(0); // naik setelah transaksi: baca ulang saldo dan allowance
  const rid = useId();

  const vault = target.address;
  const shares = useMemo(() => (info ? parseAmount(amount, info.decimals) : null), [amount, info]);
  const onTargetChain = walletChain === target.chainId;
  const symbols = comps.map((c) => c.symbol);
  const shareBalance = shareRead && account && shareRead.account === account ? shareRead.balance : null;
  const quoteKey = `${account ?? ""}|${vault}|${mode}|${slip}|${shares === null ? "x" : shares.toString()}|${nonce}`;
  const quote = quoteRead && quoteRead.key === quoteKey ? quoteRead.quote : null;

  // Metadata vault dan token komponen: sekali per klien.
  useEffect(() => {
    if (!client) return;
    let off = false;
    (async () => {
      try {
        const v = await readVaultInfo(client, vault);
        const metas = await Promise.all(v.components.map(async (token) => {
          const [sym, dec] = await Promise.all([
            client.readContract({ address: token, abi: erc20Abi, functionName: "symbol" }),
            client.readContract({ address: token, abi: erc20Abi, functionName: "decimals" }),
          ]);
          return { token, symbol: sym, decimals: dec };
        }));
        if (!off) { setInfo(v); setComps(metas); }
      } catch {
        if (!off) setStatus({ kind: "error", text: "Could not read the vault on-chain. Check the vault address and network." });
      }
    })();
    return () => { off = true; };
  }, [client, vault]);

  // Saldo share pemilik (untuk redeem).
  useEffect(() => {
    if (!client || !account) return;
    let off = false;
    client.readContract({ address: vault, abi: cordonVaultAbi, functionName: "balanceOf", args: [account] })
      .then((b) => { if (!off) setShareRead({ account, balance: b }); })
      .catch(() => { if (!off) setShareRead({ account, balance: null }); });
    return () => { off = true; };
  }, [client, account, vault, nonce]);

  // Kuotasi (ditunda 400 ms setelah mengetik). Batas slippage dan allowance dihitung dari kuotasi yang sama.
  useEffect(() => {
    if (!client || !info || shares === null) return;
    let off = false;
    const t = setTimeout(async () => {
      try {
        const bps = SLIPPAGE_OPTIONS[slip];
        const amounts = [...(mode === "mint" ? (await quoteMint(client, vault, shares)).amounts : (await quoteRedeem(client, vault, shares)).amounts)];
        const limits = mode === "mint" ? maxWithSlippage(amounts, bps) : minWithSlippage(amounts, bps);
        let allowances = amounts.map(() => 0n);
        let balances = amounts.map(() => 0n);
        if (mode === "mint" && account) {
          const r = await checkReadiness(client, vault, account, info.components, limits);
          allowances = r.map((x) => x.allowance);
          balances = r.map((x) => x.balance);
        }
        if (!off) setQuoteRead({ key: quoteKey, quote: { amounts, limits, allowances, balances } });
      } catch (e) {
        if (!off) setStatus({ kind: "error", text: cordonErrorMessage(decodeCordonError(e), symbols) });
      }
    }, 400);
    return () => { off = true; clearTimeout(t); };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- symbols hanya dipakai untuk teks error
  }, [client, info, shares, mode, slip, account, vault, nonce, quoteKey]);

  const needsMarket = mode === "mint";
  const blocked = needsMarket && !marketOpen;
  const approvals = quote && mode === "mint" ? pendingApprovals(quote.allowances, quote.limits) : [];
  const lacking = quote && mode === "mint" ? quote.amounts.findIndex((a, i) => (quote.balances[i] ?? 0n) < a) : -1;
  const overBalance = mode === "redeem" && shares !== null && shareBalance !== null && shares > shareBalance;
  const busy = status.kind === "busy";

  const send = useCallback(async (label: string, fn: () => Promise<Hash>, done: string) => {
    if (!client) return;
    setStatus({ kind: "busy", text: `${label}: confirm in your wallet…` });
    try {
      const hash = await fn();
      setStatus({ kind: "busy", text: `${label}: waiting for confirmation…` });
      const rc = await client.waitForTransactionReceipt({ hash });
      if (rc.status !== "success") { setStatus({ kind: "error", text: `${label} reverted on-chain.` }); return; }
      setStatus({ kind: "ok", text: done, hash });
      setNonce((n) => n + 1);
    } catch (e) {
      setStatus(isUserRejection(e) ? { kind: "idle" } : { kind: "error", text: cordonErrorMessage(decodeCordonError(e), symbols) });
    }
  }, [client, symbols]);

  const act = async () => {
    if (!client || !account || !info || shares === null || !quote) return;
    if (!onTargetChain) {
      try { await switchChainAsync({ chainId: target.chainId }); }
      catch { setStatus({ kind: "error", text: "Switch your wallet to the right network to continue." }); }
      return;
    }
    if (mode === "mint") {
      const i = approvals[0];
      if (i !== undefined) {
        const c = comps[i]!;
        // Hanya sebesar batas setoran (bukan tak terbatas): paling aman bila vault bermasalah.
        await send(`Approve ${c.symbol}`, () => writeContractAsync({ address: c.token, abi: erc20Abi, functionName: "approve", args: [vault, quote.limits[i]!], chainId: target.chainId }), `${c.symbol} approved.`);
        return;
      }
      await send("Mint", async () => {
        await client.simulateContract({ account, address: vault, abi: cordonVaultAbi, functionName: "mint", args: [shares, account, quote.limits] });
        return writeContractAsync({ address: vault, abi: cordonVaultAbi, functionName: "mint", args: [shares, account, quote.limits], chainId: target.chainId });
      }, `Minted ${amount} ${symbol}.`);
      return;
    }
    const mask = fullMask(info.components.length);
    await send("Redeem", async () => {
      await client.simulateContract({ account, address: vault, abi: cordonVaultAbi, functionName: "redeem", args: [shares, account, mask, quote.limits] });
      return writeContractAsync({ address: vault, abi: cordonVaultAbi, functionName: "redeem", args: [shares, account, mask, quote.limits], chainId: target.chainId });
    }, `Redeemed ${amount} ${symbol} in-kind.`);
  };

  let cta = mode === "mint" ? "Mint" : "Redeem";
  if (!isConnected) cta = "Connect wallet first";
  else if (!onTargetChain) cta = "Switch network";
  else if (mode === "mint" && approvals[0] !== undefined) cta = `Approve ${comps[approvals[0]]?.symbol ?? "token"} (${approvals.length} left)`;
  const disabled = busy || !isConnected || !info || (onTargetChain && (blocked || shares === null || !quote || lacking >= 0 || overBalance));
  const explorer = explorerOf(target.chainId);

  return (
    <Panel title={`${mode === "mint" ? "Mint" : "Redeem"} ${symbol}`}>
      <div className="space-y-4">
        <Segmented label="Mint or redeem" value={mode} options={["mint", "redeem"]} onChange={(m) => { setMode(m); setStatus({ kind: "idle" }); }} />
        <AmountField label={mode === "mint" ? "You receive" : "You redeem"} unit={symbol} value={amount} onChange={(v) => { setAmount(v); setStatus({ kind: "idle" }); }} />
        {mode === "redeem" && (
          <fieldset className="m-0 border-0 p-0">
            <legend className="sr-only">Redeem to</legend>
            <Radio name={`${rid}-to`} value="in-kind" checked onChange={() => {}} title="In-kind" hint="Receive every component pro-rata. Always available." />
            <Radio name={`${rid}-to`} value="usdg" checked={false} disabled onChange={() => {}} title="To USDG" hint="Not available on-chain yet. The vault only pays out in-kind." />
          </fieldset>
        )}
        <div className="flex items-center justify-between gap-3">
          <span className={note}>Slippage</span>
          <Segmented label="Slippage" value={slip} options={Object.keys(SLIPPAGE_OPTIONS) as SlippageLabel[]} onChange={setSlip} />
        </div>
        {shares !== null && info && (
          <div className="rounded-xl border border-wire px-3.5 py-3 text-[.88rem]" aria-live="polite">
            <p className="mb-1 text-bark">{mode === "mint" ? "You pay (max, incl. fee):" : "You receive (min, after fee):"}</p>
            {!quote ? <p className="text-bark">Getting quote…</p> : (
              <ul className="space-y-0.5 font-mono">
                {comps.map((c, i) => (
                  <li key={c.token} className="flex justify-between gap-3">
                    <span>{c.symbol}</span>
                    <span>≈ {formatAmount(quote.amounts[i] ?? 0n, c.decimals)}<span className="text-bark"> ({mode === "mint" ? "≤" : "≥"} {formatAmount(quote.limits[i] ?? 0n, c.decimals)})</span></span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
        {lacking >= 0 && <p role="status" className="text-[.88rem] text-blight">Not enough {comps[lacking]?.symbol ?? "token"} in your wallet for this amount.</p>}
        {overBalance && <p role="status" className="text-[.88rem] text-blight">You hold {formatAmount(shareBalance!, info?.decimals ?? 18)} {symbol}.</p>}
        {blocked && <p role="status" className="rounded-xl border border-dashed border-wire px-3.5 py-3 text-[.88rem] text-blight">Market closed: minting needs live prices.{nextOpen && ` Opens ${nextOpen}.`} In-kind redeem stays available.</p>}
        <Button disabled={disabled} onClick={act} className="w-full">{cta}</Button>
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
