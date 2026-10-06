"use client";
import { useSyncExternalStore } from "react";
import { nextHarvestClose, splitDuration, whenLabels } from "@/lib/schedule";

// Hitung mundur ILUSTRATIF ke Jumat 16:00 ET (demo). Bukan aturan settlement: lihat lib/schedule.ts.
// Server dan hidrasi awal memakai snapshot null (tanda "--"), supaya HTML server tidak berbeda dari klien.
const subscribe = (cb: () => void) => { const id = setInterval(cb, 1000); return () => clearInterval(id); };
const p2 = (n: number) => String(n).padStart(2, "0");

export function DemoCountdown({ className = "" }: { className?: string }) {
  const now = useSyncExternalStore(subscribe, () => Math.floor(Date.now() / 1000), () => null);
  const target = now === null ? null : nextHarvestClose(new Date(now * 1000));
  const left = target && now !== null ? splitDuration(Math.floor(target.getTime() / 1000) - now) : null;
  const when = target ? whenLabels(target) : null;
  const units: [string, string][] = left
    ? [[String(left.d), "days"], [p2(left.h), "hours"], [p2(left.m), "min"], [p2(left.s), "sec"]]
    : [["--", "days"], ["--", "hours"], ["--", "min"], ["--", "sec"]];
  return (
    <div className={`flex max-w-[520px] flex-wrap items-end gap-x-7 gap-y-4 border-t border-wire pt-5 ${className}`}>
      <p className="-mb-2 flex basis-full flex-wrap items-center gap-x-3 text-[.88rem] text-bark">
        Next Harvest in
        <span className="rounded-full border border-dashed border-wire px-2.5 text-xs font-medium">Illustrative schedule</span>
      </p>
      <time dateTime={target?.toISOString()} role="timer" aria-live="off" className="flex gap-4 font-mono"
        aria-label={left ? `${left.d} days ${left.h} hours ${left.m} minutes ${left.s} seconds` : "Loading countdown"}>
        {units.map(([v, label]) => (
          <span key={label} aria-hidden className="flex min-w-[2.2ch] flex-col">
            <b className="text-[2rem] leading-none font-medium">{v}</b>
            <small className="mt-1 font-sans text-xs text-bark">{label}</small>
          </span>
        ))}
      </time>
      <p className="text-[.88rem] leading-snug text-bark">
        {when ? <>{when.et}<br />{when.wib}</> : <>Friday 16:00 ET</>}
      </p>
      <p className="basis-full text-xs text-bark">Demo only. The real round time is not set yet.</p>
    </div>
  );
}
