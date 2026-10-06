"use client";
import { useSyncExternalStore } from "react";

const subscribe = (cb: () => void) => { const id = setInterval(cb, 1000); return () => clearInterval(id); };
const p2 = (n: number) => String(n).padStart(2, "0");

// Hitung mundur gaya ".cd-units" espalier.html. Server dan hidrasi awal memakai "--" supaya HTML tidak berbeda dari klien.
export function RoundCountdown({ expiry, label = "Next harvest in" }: { expiry: string; label?: string }) {
  const now = useSyncExternalStore(subscribe, () => Math.floor(Date.now() / 1000), () => null);
  const left = now === null ? null : Math.floor(new Date(expiry).getTime() / 1000) - now;
  const units: [string, string][] = left === null || left <= 0
    ? [["--", "days"], ["--", "hours"], ["--", "min"], ["--", "sec"]]
    : [[String(Math.floor(left / 86400)), "days"], [p2(Math.floor((left % 86400) / 3600)), "hours"], [p2(Math.floor((left % 3600) / 60)), "min"], [p2(left % 60), "sec"]];
  return (
    <div className="flex flex-wrap items-end gap-x-7 gap-y-4 border-t border-wire pt-5">
      <p className="m-0 -mb-2 basis-full text-[.88rem] text-bark">{label}</p>
      {left !== null && left <= 0
        ? <time dateTime={expiry} className="font-display text-2xl">Harvesting now</time>
        : (
          <time dateTime={expiry} role="timer" aria-live="off" className="flex gap-4 font-mono"
            aria-label={left === null ? "Loading countdown" : `${units[0][0]} days ${units[1][0]} hours ${units[2][0]} minutes ${units[3][0]} seconds`}>
            {units.map(([v, u]) => (
              <span key={u} aria-hidden className="flex min-w-[2.2ch] flex-col">
                <b className="text-[2rem] leading-none font-medium">{v}</b>
                <small className="mt-1 font-sans text-xs text-bark">{u}</small>
              </span>
            ))}
          </time>
        )}
    </div>
  );
}
