// Garis tren kecil untuk kartu daftar (espalier.html: ".spark"). Server component, SVG polos.
// Bukan grafik yang bisa dibaca angkanya: ringkasan arah, dengan label teks untuk pembaca layar.
const W = 120, H = 36, PAD = 3;

export function Sparkline({ values, label }: { values: number[]; label: string }) {
  if (values.length < 2) return <span className="font-mono text-[1.05rem]">—<span className="sr-only"> not enough history yet</span></span>;
  const mn = Math.min(...values), mx = Math.max(...values), span = mx - mn || 1;
  const x = (i: number) => PAD + (i / (values.length - 1)) * (W - PAD * 2);
  const y = (v: number) => H - PAD - ((v - mn) / span) * (H - PAD * 2);
  const d = values.map((v, i) => `${i ? "L" : "M"}${x(i).toFixed(1)} ${y(v).toFixed(1)}`).join("");
  const last = values.length - 1;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={label} className="block h-9 w-[120px]">
      <path d={d} fill="none" stroke="var(--leaf)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
      <circle cx={x(last)} cy={y(values[last])} r="3" fill="var(--fruit)" stroke="var(--bark)" strokeWidth="1" />
    </svg>
  );
}
