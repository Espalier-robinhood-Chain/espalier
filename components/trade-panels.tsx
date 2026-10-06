"use client";
import { useId, useState } from "react";
import { graftLive, spurLive, tradeLive } from "@/lib/web3/env";
import { AmountField, Radio, Segmented, note } from "./trade-fields";
import { LiveDepositWithdrawPanel } from "./spur-live";
import { LiveMintRedeemPanel } from "./trade-live";
import { Button, Panel } from "./ui";

const DEMO = "Demo: no transaction was sent.";

function DemoMintRedeemPanel({ symbol, marketOpen, nextOpen }: { symbol: string; marketOpen: boolean; nextOpen?: string }) {
  const [mode, setMode] = useState<"mint" | "redeem">("mint");
  const [to, setTo] = useState<"in-kind" | "usdg">("in-kind");
  const [amount, setAmount] = useState("");
  const [msg, setMsg] = useState("");
  const needsLive = mode === "mint" || to === "usdg";
  const blocked = needsLive && !marketOpen;
  const rid = useId();
  return (
    <Panel title={`${mode === "mint" ? "Mint" : "Redeem"} ${symbol}`}>
      <div className="space-y-4">
        <Segmented label="Mint or redeem" value={mode} options={["mint", "redeem"]} onChange={setMode} />
        <AmountField label={mode === "mint" ? "You pay" : "You redeem"} unit={mode === "mint" ? "USDG" : symbol} value={amount} onChange={setAmount} />
        {mode === "redeem" && (
          <fieldset className="m-0 border-0 p-0">
            <legend className="sr-only">Redeem to</legend>
            <Radio name={`${rid}-to`} value="in-kind" checked={to === "in-kind"} onChange={() => setTo("in-kind")} title="In-kind" hint="Receive every component pro-rata. Always available." />
            <Radio name={`${rid}-to`} value="usdg" checked={to === "usdg"} onChange={() => setTo("usdg")} title="To USDG" hint="Needs live prices. Only while the market is open." />
          </fieldset>
        )}
        {blocked && <p role="status" className="rounded-xl border border-dashed border-wire px-3.5 py-3 text-[.88rem] text-blight">Market closed: this action needs live prices.{nextOpen && ` Opens ${nextOpen}.`} In-kind redeem stays available.</p>}
        <Button disabled={blocked || !Number(amount)} onClick={() => setMsg(DEMO)} className="w-full">{mode === "mint" ? "Mint" : "Redeem"}</Button>
        {msg && <p role="status" className={note}>{msg}</p>}
      </div>
    </Panel>
  );
}
// unit: label satuan di kolom jumlah (mis. ticker underlying); default memakai `asset`.
function DemoDepositWithdrawPanel({ symbol, asset, unit }: { symbol: string; asset: "stock" | "USDG"; unit?: string }) {
  const [mode, setMode] = useState<"deposit" | "withdraw">("deposit");
  const [amount, setAmount] = useState("");
  const [msg, setMsg] = useState("");
  return (
    <Panel title={`${mode === "deposit" ? "Deposit to" : "Withdraw from"} ${symbol}`}>
      <div className="space-y-4">
        <Segmented label="Deposit or withdraw" value={mode} options={["deposit", "withdraw"]} onChange={setMode} />
        <AmountField label={mode === "deposit" ? "You deposit" : "You withdraw"} unit={unit ?? asset} value={amount} onChange={setAmount} />
        <p className={note}>{mode === "deposit" ? "Deposits join the next round." : "Withdrawals queue to the next round. Deposits not yet in a round can be withdrawn instantly."}</p>
        <Button disabled={!Number(amount)} onClick={() => setMsg(DEMO)} className="w-full capitalize">{mode}</Button>
        {msg && <p role="status" className={note}>{msg}</p>}
      </div>
    </Panel>
  );
}

// Sungguhan bila wallet aktif dan vault untuk `symbol` dikonfigurasi: Spur (asset "stock") lewat NEXT_PUBLIC_SPUR_VAULT_*,
// Graft (asset "USDG") lewat NEXT_PUBLIC_GRAFT_VAULT_*. Selain itu simulasi (tanpa transaksi).
export function DepositWithdrawPanel(p: { symbol: string; asset: "stock" | "USDG"; unit?: string }) {
  if (p.asset === "stock" && spurLive(p.symbol)) return <LiveDepositWithdrawPanel kind="spur" symbol={p.symbol} unit={p.unit} />;
  if (p.asset === "USDG" && graftLive(p.symbol)) return <LiveDepositWithdrawPanel kind="graft" symbol={p.symbol} unit={p.unit} />;
  return <DemoDepositWithdrawPanel {...p} />;
}

// Sungguhan bila wallet aktif dan vault untuk `symbol` dikonfigurasi (NEXT_PUBLIC_CORDON_VAULT_*); selain itu simulasi seperti sebelumnya.
export function MintRedeemPanel(p: { symbol: string; marketOpen: boolean; nextOpen?: string }) {
  return tradeLive(p.symbol) ? <LiveMintRedeemPanel {...p} /> : <DemoMintRedeemPanel {...p} />;
}
