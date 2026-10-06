"use client";
import { useId } from "react";

// Tab pil seperti ".tabs" di espalier.html. Tetap grup tombol dengan aria-pressed (bukan tab ARIA) karena tidak ada tabpanel terpisah.
export function Segmented<T extends string>({ value, options, onChange, label }: { value: T; options: T[]; onChange: (v: T) => void; label: string }) {
  return (
    <div role="group" aria-label={label} className="inline-flex gap-0.5 rounded-full bg-panel-2 p-1">
      {options.map((o) => (
        <button key={o} type="button" aria-pressed={o === value} onClick={() => onChange(o)}
          className={`min-h-9 rounded-full px-4 text-[.88rem] font-medium capitalize transition-colors focus-visible:outline-2 focus-visible:outline-leaf ${o === value ? "bg-wall text-ink shadow-[0_1px_2px_color-mix(in_srgb,var(--bark)_25%,transparent)]" : "text-bark hover:text-ink"}`}>{o}</button>
      ))}
    </div>
  );
}
export function AmountField({ label, unit, value, onChange }: { label: string; unit: string; value: string; onChange: (v: string) => void }) {
  const id = useId();
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-[.86rem] text-bark">{label}</label>
      <div className="flex items-center rounded-[14px] border border-bark/70 bg-wall px-3.5 focus-within:outline-2 focus-within:outline-offset-1 focus-within:outline-leaf">
        <input id={id} inputMode="decimal" value={value} onChange={(e) => onChange(e.target.value)} placeholder="0" className="min-h-12 min-w-0 flex-1 bg-transparent font-mono text-[1.3rem] font-medium outline-none placeholder:text-bark/80" />
        <span className="font-mono text-[.9rem] font-medium text-bark">{unit}</span>
      </div>
    </div>
  );
}
export function Radio({ name, value, checked, onChange, title, hint, disabled = false }: { name: string; value: string; checked: boolean; onChange: () => void; title: string; hint: string; disabled?: boolean }) {
  return (
    <label className={`flex items-start gap-2.5 py-2.5 text-[.92rem] ${disabled ? "cursor-not-allowed opacity-55" : "cursor-pointer"}`}>
      <input type="radio" name={name} value={value} checked={checked} onChange={onChange} disabled={disabled} className="mt-1 accent-leaf" />
      <span>{title}<small className="block text-bark">{hint}</small></span>
    </label>
  );
}
export const note = "text-[.86rem] text-bark";
