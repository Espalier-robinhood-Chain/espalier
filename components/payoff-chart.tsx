import { graftResult, holdResult, spurResult, type PayoffInput } from "@/lib/docs/payoff";
import { pct } from "@/lib/format";
import { Reveal } from "./reveal";

// Diagram ilustratif hasil per saham pada expiry. Server component, SVG polos, tanpa data produk.
// Garis putus-putus = hanya memegang saham; garis tebal = di dalam vault. Dua garis dibedakan
// oleh gaya garis dan label langsung, bukan hanya warna.
const W = 360, H = 232, L = 44, R = 14, T = 16, B = 38;

const CFG = {
  spur: { input: { start: 100, strike: 110, premiumPct: 0.9 } as PayoffInput, x: [80, 140], y: [-20, 40], fn: spurResult, name: "Spur Vault" },
  graft: { input: { start: 100, strike: 90, premiumPct: 0.9 } as PayoffInput, x: [60, 120], y: [-40, 20], fn: graftResult, name: "Graft Vault" },
} as const;

export function PayoffChart({ kind, titleId }: { kind: "spur" | "graft"; titleId: string }) {
  const c = CFG[kind];
  const { start, strike, premiumPct } = c.input;
  const [x0, x1] = c.x, [y0, y1] = c.y;
  const sx = (p: number) => L + ((p - x0) / (x1 - x0)) * (W - L - R);
  const sy = (r: number) => T + ((y1 - r) / (y1 - y0)) * (H - T - B);
  const line = (pts: number[], f: (p: number) => number) => pts.map((p, i) => `${i ? "L" : "M"}${sx(p).toFixed(1)} ${sy(f(p)).toFixed(1)}`).join("");
  const hold = line([x0, x1], (p) => holdResult(p, start));
  const vault = line([x0, strike, x1], (p) => c.fn(p, c.input));
  const yTicks: number[] = [];
  for (let t = y0; t <= y1; t += 20) yTicks.push(t);
  const desc = kind === "spur"
    ? `Illustrative chart. Start price ${start}, strike ${strike}, premium ${premiumPct}%. Below the strike, a Spur Vault tracks the stock with a small premium on top. Above the strike, the result stays flat at the cap while holding the stock keeps rising.`
    : `Illustrative chart. Start price ${start}, strike ${strike}, premium ${premiumPct}%. Above the strike, a Graft Vault earns only the premium. Below the strike, it loses value as the price falls, with the premium as a small cushion.`;
  const capY = c.fn(x1, c.input);

  return (
    <Reveal className="w-full max-w-md">
    <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-labelledby={titleId} className="h-auto w-full text-bark">
      <title id={titleId}>{kind === "spur" ? "Spur Vault result compared with holding the stock" : "Graft Vault result compared with buying the stock"}</title>
      <desc>{desc}</desc>
      {yTicks.map((t) => (
        <g key={t}>
          <line x1={L} x2={W - R} y1={sy(t)} y2={sy(t)} className={t === 0 ? "stroke-bark" : "stroke-wire"} strokeWidth={t === 0 ? 1 : 0.75} />
          <text x={L - 6} y={sy(t) + 4} textAnchor="end" className="fill-bark font-mono" fontSize="11">{t === 0 ? "0%" : pct(t, 0)}</text>
        </g>
      ))}
      <line x1={sx(strike)} x2={sx(strike)} y1={T} y2={H - B} className="stroke-bark" strokeWidth="1" strokeDasharray="2 3" />
      <line x1={sx(start)} x2={sx(start)} y1={T} y2={H - B} className="stroke-wire" strokeWidth="0.75" />
      <text x={sx(start)} y={H - B + 16} textAnchor="middle" className="fill-ink" fontSize="12">Start</text>
      <text x={sx(strike)} y={H - B + 16} textAnchor="middle" className="fill-ink" fontSize="12">Strike</text>
      <text x={(L + W - R) / 2} y={H - 4} textAnchor="middle" className="fill-bark" fontSize="12">Price at expiry</text>
      <path d={hold} fill="none" className="fade stroke-bark" style={{ "--d": "0ms" } as React.CSSProperties} strokeWidth="1.5" strokeDasharray="5 4" />
      <path d={vault} fill="none" pathLength={1} className="draw stroke-leaf" style={{ "--d": "300ms", "--dur": "1100ms" } as React.CSSProperties} strokeWidth="2.75" strokeLinejoin="round" strokeLinecap="round" />
      <circle cx={sx(start)} cy={sy(c.fn(start, c.input))} r="4.5" className="fruit fill-fruit stroke-leaf" style={{ "--d": "1300ms" } as React.CSSProperties} strokeWidth="1.5" />
      <text x={W - R - 34} y={sy(holdResult(x1, start)) + 6} textAnchor="end" className="fill-bark" fontSize="12">{kind === "spur" ? "Holding the stock" : "Buying the stock"}</text>
      <text x={W - R - 2} y={kind === "graft" ? sy(capY) + 20 : sy(capY) - 8} textAnchor="end" className="fill-leaf" fontSize="12" fontWeight="600">{c.name}</text>
    </svg>
    </Reveal>
  );
}
