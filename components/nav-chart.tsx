export function NavChart({ points, harvests = [], label = "NAV per share" }: { points: { ts: number; nav: number }[]; harvests?: number[]; label?: string }) {
  if (points.length < 2) return null;
  const W = 600, H = 220, P = 28;
  const ts = points.map((p) => p.ts), ns = points.map((p) => p.nav);
  const [t0, t1] = [Math.min(...ts), Math.max(...ts)], [lo, hi] = [Math.min(...ns), Math.max(...ns)];
  const x = (t: number) => P + ((t - t0) / (t1 - t0 || 1)) * (W - 2 * P);
  const y = (n: number) => H - P - ((n - lo) / (hi - lo || 1)) * (H - 2 * P);
  const d = points.map((p, i) => `${i ? "L" : "M"}${x(p.ts).toFixed(1)} ${y(p.nav).toFixed(1)}`).join("");
  const last = points[points.length - 1];
  // Area tipis di bawah garis + tiga garis bantu putus-putus: tampilan "kertas kebun", bukan grid dashboard.
  const area = `${d}L${x(last.ts).toFixed(1)} ${H - P}L${x(points[0].ts).toFixed(1)} ${H - P}Z`;
  const mid = (lo + hi) / 2;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`${label}: low ${lo.toFixed(2)}, high ${hi.toFixed(2)}${harvests.length ? "; gold dots mark Harvests" : ""}`} className="block h-auto w-full overflow-visible">
      {[hi, mid, lo].map((n) => <line key={n} x1={P} x2={W - P} y1={y(n)} y2={y(n)} stroke="var(--wire)" strokeWidth="0.75" strokeDasharray="2 4" />)}
      <path d={area} fill="var(--leaf)" fillOpacity=".08" />
      <path d={d} fill="none" stroke="var(--bark)" strokeWidth="1.75" strokeLinejoin="round" strokeLinecap="round" />
      {harvests.map((h) => {
        const p = points.find((q) => q.ts >= h);
        return p ? <circle key={h} cx={x(p.ts)} cy={y(p.nav)} r="4.5" fill="var(--fruit)" stroke="var(--bark)" /> : null;
      })}
      <circle cx={x(last.ts)} cy={y(last.nav)} r="3.5" fill="var(--leaf)" />
      <text x={P} y={12} className="fill-bark font-mono text-[11px]">{hi.toFixed(2)}</text>
      <text x={P} y={H - 6} className="fill-bark font-mono text-[11px]">{lo.toFixed(2)}</text>
    </svg>
  );
}
