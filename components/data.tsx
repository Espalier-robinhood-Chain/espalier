import { pct } from "@/lib/format";
import { Reveal } from "./reveal";

export function Delta({ value }: { value: number }) {
  return <span className={`inline-flex items-center gap-1 font-medium ${value < 0 ? "text-blight" : "text-leaf"}`}>{value < 0 ? "▼" : "▲"} {pct(value)}</span>;
}
// Titik terisi = pasar/oracle hidup; titik kosong = tutup. Teks status selalu ada, jadi bukan hanya soal warna.
const STATES = { regular: ["fill", "Regular session"], extended: ["fill", "Extended hours"], overnight: ["ring", "Overnight"], closed: ["ring", "Closed"], paused: ["pause", "Oracle paused"] } as const;
export function MarketStatusPill({ state, next, prefix }: { state: keyof typeof STATES; next?: string; prefix?: string }) {
  const [icon, label] = STATES[state];
  return (
    <span role="status" className="inline-flex items-center gap-2 whitespace-nowrap rounded-full border border-wire py-[5px] pr-3 pl-2.5 text-[.82rem] font-medium">
      {icon === "pause"
        ? <span aria-hidden className="text-[.7rem] leading-none">⏸</span>
        : <span aria-hidden className={`size-[9px] rounded-full border-[1.5px] ${icon === "fill" ? "border-leaf bg-leaf" : "border-bark bg-transparent"}`} />}
      {prefix && <span className="font-normal text-bark">{prefix} ·</span>}{label}{next && <span className="font-normal text-bark"> · {next}</span>}
    </span>
  );
}
export function RiskCallout({ children }: { children: React.ReactNode }) {
  return (
    <aside role="note" className="grid grid-cols-[24px_1fr] gap-3 rounded-[14px] border border-[color-mix(in_srgb,var(--blight)_35%,transparent)] bg-[color-mix(in_srgb,var(--blight)_8%,var(--wall))] px-[18px] py-4 text-[.92rem]">
      <svg viewBox="0 0 24 24" fill="none" stroke="var(--blight)" strokeWidth="1.6" aria-hidden className="size-[22px]"><path d="M12 3 2.5 20h19z" /><path d="M12 10v4.5M12 17.2v.3" strokeLinecap="round" /></svg>
      <p><strong className="font-display font-medium">Risk. </strong>{children}</p>
    </aside>
  );
}
// Warna segmen mengikuti pola espalier.html: daun, daun 72%, kulit kayu 80% (tiap kelipatan 3).
const segColor = (i: number) => i % 3 === 2 ? "color-mix(in srgb, var(--bark) 80%, var(--wall))" : i % 2 === 1 ? "color-mix(in srgb, var(--leaf) 72%, var(--wall))" : "var(--leaf)";
export function CompositionBar({ items }: { items: { label: string; weightBps: number }[] }) {
  return (
    <Reveal>
      <div className="mb-3 flex h-10 gap-[3px] overflow-hidden rounded-[10px]" aria-hidden>
        {items.map((it, i) => <span key={it.label} className="comp-seg block" style={{ "--w": `${it.weightBps / 100}%`, "--d": `${i * 60}ms`, background: segColor(i) } as React.CSSProperties} />)}
      </div>
      <ul className="grid grid-cols-[repeat(auto-fill,minmax(92px,1fr))] gap-x-3 gap-y-1.5 text-[.84rem]">
        {items.map((it) => (
          <li key={it.label} className="flex justify-between gap-1.5 border-b border-dotted border-wire pb-[3px]">
            <span className="font-mono">{it.label}</span><span className="text-bark">{(it.weightBps / 100).toFixed(1)}%</span>
          </li>
        ))}
      </ul>
    </Reveal>
  );
}
