"use client";
import { useId, useState } from "react";
import { graftResult, spurResult } from "@/lib/docs/payoff";
import { Delta } from "./data";

// Batang hasil dipusatkan di nol (garis tengah), skala simetris. Nilai tetap ditulis sebagai teks (Delta), bukan hanya panjang batang.
const SCALE = 45;
const pos = (v: number) => Math.max(0, Math.min(100, 50 + (v / SCALE) * 50));
function Bar({ label, value, kind, strike }: { label: string; value: number; kind: "hold" | "vault"; strike?: number }) {
  const a = pos(0), b = pos(value);
  const color = value < 0 ? "var(--blight)" : kind === "vault" ? "var(--leaf)" : "color-mix(in srgb, var(--bark) 55%, var(--wall))";
  return (
    <div className="grid grid-cols-[96px_1fr_84px] items-center gap-3 text-[.9rem]">
      <span>{label}</span>
      <span aria-hidden className="relative h-4 before:absolute before:inset-y-[-4px] before:left-1/2 before:w-px before:bg-bark">
        {strike !== undefined && <span className="absolute inset-y-[-6px] w-0 border-l-[1.5px] border-dashed border-fruit" style={{ left: `${pos(strike)}%` }} />}
        <span className="absolute top-0 h-full rounded-[3px] transition-[left,width,background-color] duration-300" style={{ left: `${Math.min(a, b)}%`, width: `${Math.abs(b - a)}%`, background: color }} />
      </span>
      <span className="text-right font-mono font-medium"><Delta value={value} /></span>
    </div>
  );
}

// spotLabel: acuan harga untuk strike. Default "today" (Landing); halaman vault memakai harga awal round.
// kind "spur" (covered call): upside dibatasi di strike. kind "graft" (cash-secured put): di bawah strike vault membayar selisihnya.
// Hasil dihitung dengan rumus yang sama dengan diagram di Docs (lib/docs/payoff).
export function UpsideSimulator({ symbol, spot, strike, weeklyPremiumPct, spotLabel = "today", kind = "spur" }: { symbol: string; spot: number; strike: number; weeklyPremiumPct: number; spotLabel?: string; kind?: "spur" | "graft" }) {
  const id = useId();
  const isGraft = kind === "graft";
  // Graft dibuka di sisi turun supaya risikonya langsung terlihat; Spur di sisi naik supaya batasnya terlihat.
  const [move, setMove] = useState(isGraft ? -15 : 20);
  const strikePct = (strike / spot - 1) * 100;
  const input = { start: spot, strike, premiumPct: weeklyPremiumPct };
  const price = spot * (1 + move / 100);
  const withVault = (isGraft ? graftResult : spurResult)(price, input);
  return (
    <div className="rounded-[22px] bg-panel p-[30px]">
      <div className="mb-2.5 flex items-baseline justify-between gap-3">
        <label htmlFor={id} className="font-medium">If {symbol} moves this week:</label>
        <output htmlFor={id} className="font-mono text-2xl font-medium">{move > 0 ? "+" : ""}{move}%</output>
      </div>
      <input id={id} type="range" min={-20} max={40} value={move} onChange={(e) => setMove(Number(e.target.value))} className="range-fruit" />
      <div aria-hidden className="-mt-0.5 flex justify-between text-xs text-bark"><span>−20%</span><span>0</span><span>+40%</span></div>
      <div className="mt-[26px] mb-[18px] flex flex-col gap-3.5">
        <Bar label={isGraft ? "Buying the stock" : "Holding the stock"} value={move} kind="hold" strike={strikePct} />
        <Bar label={isGraft ? "In a Graft Vault" : "In a Spur Vault"} value={withVault} kind="vault" strike={strikePct} />
      </div>
      <p className="m-0 rounded-r-[10px] border-l-[3px] border-fruit bg-wall px-4 py-3.5 text-[.96rem]">
        {isGraft ? (
          <>Grafts take the downside below the strike ({Math.abs(strikePct).toFixed(1)}% {strikePct < 0 ? "below" : "above"} {spotLabel}): the vault pays out the shortfall. <span className="font-display text-[1.05em] italic">That is the trade.</span> Illustrative, not a forecast.</>
        ) : (
          <>Spurs cap your upside at the strike ({strikePct.toFixed(1)}% above {spotLabel}). <span className="font-display text-[1.05em] italic">That is the trade.</span> Illustrative, not a forecast.</>
        )}
      </p>
    </div>
  );
}
