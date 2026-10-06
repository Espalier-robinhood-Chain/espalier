import { Reveal } from "./reveal";

export type TimelineStep = { when: string; title: string; text: string };
const COLS: Record<number, string> = { 3: "lg:grid-cols-3", 4: "lg:grid-cols-4", 5: "lg:grid-cols-5" };

// Linimasa "kalender" dari espalier.html: garis kulit kayu yang tumbuh, lalu satu buah emas muncul di tiap langkah.
// horizontal=false: selalu vertikal (kolom sempit di Landing). horizontal=true: vertikal di layar sempit, mendatar di lg.
export function Timeline({ steps, horizontal = false, className = "" }: { steps: TimelineStep[]; horizontal?: boolean; className?: string }) {
  const n = steps.length, gap = n <= 3 ? 450 : n === 4 ? 300 : 350;
  const line = horizontal
    ? "grow-line grow-line-h max-lg:inset-y-0 max-lg:left-0 max-lg:w-[1.5px] lg:inset-x-0 lg:top-0 lg:h-[1.5px]"
    : "grow-line inset-y-0 left-0 w-[1.5px]";
  const list = horizontal
    ? `grid gap-6 sm:grid-cols-2 ${COLS[n] ?? "lg:grid-cols-4"} max-lg:pl-[33.5px] lg:pt-[33.5px]`
    : "space-y-6 pl-[33.5px]";
  const dot = horizontal ? "max-lg:top-1.5 max-lg:-left-[38.75px] lg:-top-[38px] lg:left-0" : "top-1.5 -left-[38.75px]";
  return (
    <Reveal className={`relative ${className}`}>
      <span aria-hidden className={line} style={{ "--dur": n > 4 ? "1800ms" : "1400ms" } as React.CSSProperties} />
      <ol className={list}>
        {steps.map((st, i) => (
          <li key={st.title} className="relative">
            <span aria-hidden className={`fruit absolute size-3 rounded-full border border-bark bg-fruit ${dot}`} style={{ "--d": `${200 + i * gap}ms` } as React.CSSProperties} />
            <p className="font-mono text-[.82rem] text-bark">{st.when}</p>
            <p className="font-display text-[1.2rem] leading-snug font-medium">{st.title}</p>
            <p className={`text-bark ${horizontal ? "text-sm" : ""}`}>{st.text}</p>
          </li>
        ))}
      </ol>
    </Reveal>
  );
}
