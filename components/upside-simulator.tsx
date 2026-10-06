"use client";
import { useId, useState } from "react";
import { Delta } from "./data";

// Batang hasil dipusatkan di nol (garis tengah), skala simetris. Nilai tetap ditulis sebagai teks (Delta), bukan hanya panjang batang.
const SCALE = 45;
const pos = (v: number) => Math.max(0, Math.min(100, 50 + (v / SCALE) * 50));
function Bar({ label, value, kind, strike }: { label: string; value: number; kind: "hold" | "spur"; strike?: number }) {
  const a = pos(0), b = pos(value);
  const color = value < 0 ? "var(--blight)" : kind === "spur" ? "var(--leaf)" : "color-mix(in srgb, var(--bark) 55%, var(--wall))";
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

// spotLabel: acuan harga untuk batas upside. Default "today" (Landing); Page E memakai harga awal round.
export function UpsideSimulator({ symbol, spot, strike, weeklyPremiumPct, spotLabel = "today" }: { symbol: string; spot: number; strike: number; weeklyPremiumPct: number; spotLabel?: string }) {
  const id = useId();
  const [move, setMove] = useState(20);
  const cap = (strike / spot - 1) * 100;
  const withSpur = Math.min(move, cap) + weeklyPremiumPct;
  return (
    <div className="rounded-[22px] bg-panel p-[30px]">
      <div className="mb-2.5 flex items-baseline justify-between gap-3">
        <label htmlFor={id} className="font-medium">If {symbol} moves this week:</label>
        <output htmlFor={id} className="font-mono text-2xl font-medium">{move > 0 ? "+" : ""}{move}%</output>
      </div>
      <input id={id} type="range" min={-20} max={40} value={move} onChange={(e) => setMove(Number(e.target.value))} className="range-fruit" />
      <div aria-hidden className="-mt-0.5 flex justify-between text-xs text-bark"><span>−20%</span><span>0</span><span>+40%</span></div>
      <div className="mt-[26px] mb-[18px] flex flex-col gap-3.5">
        <Bar label="Holding the stock" value={move} kind="hold" strike={cap} />
        <Bar label="In a Spur Vault" value={withSpur} kind="spur" strike={cap} />
      </div>
      <p className="m-0 rounded-r-[10px] border-l-[3px] border-fruit bg-wall px-4 py-3.5 text-[.96rem]">
        Spurs cap your upside at the strike ({cap.toFixed(1)}% above {spotLabel}). <span className="font-display text-[1.05em] italic">That is the trade.</span> Illustrative, not a forecast.
      </p>
    </div>
  );
}
