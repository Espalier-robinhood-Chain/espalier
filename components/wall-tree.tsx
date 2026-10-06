import { generateTree, type TreeInput } from "@/lib/tree";
import { Reveal } from "./reveal";

const d = (ms: number, dur?: number) => ({ "--d": `${ms}ms`, ...(dur ? { "--dur": `${dur}ms` } : {}) }) as React.CSSProperties;

// tone="onLeaf": pohon di atas latar daun (Harvest Card), jadi garis memakai --on-leaf agar tetap terbaca di terang maupun gelap.
export function WallTree({ input, className = "w-full max-w-xs", tone = "default", animate = false }: { input: TreeInput; className?: string; tone?: "default" | "onLeaf"; animate?: boolean }) {
  const t = generateTree(input);
  const line = tone === "onLeaf" ? "var(--on-leaf)" : "var(--bark)";
  const leaf = tone === "onLeaf" ? "var(--on-leaf)" : "var(--leaf)";
  const fruitEdge = tone === "onLeaf" ? "var(--leaf)" : "var(--bark)";
  // animate: batang, cabang, daun, lalu buah tumbuh bertahap saat terlihat (drawTree di espalier.html). Statis bila tidak.
  const svg = (
    <svg viewBox={t.viewBox} role="img" className={animate ? "block h-auto w-full" : className}
      aria-label={`Espalier ${t.shape}: ${t.branches.length} cordons, ${input.harvests} harvests`} fill="none" strokeLinecap="round">
      <path d={t.trunk} stroke={line} strokeWidth="2" {...(animate && { className: "draw", pathLength: 1, style: d(0, 700) })} />
      {t.branches.map((b, bi) => (
        <g key={b.id}>
          <path d={b.d} stroke={line} strokeWidth="1.5" {...(animate && { className: "draw", pathLength: 1, style: d(250 + bi * 140, 700) })} />
          {b.leaves.map(([x, y], i) => <ellipse key={i} cx={x} cy={y} rx="5" ry="2.5" fill={leaf} fillOpacity=".55" stroke={leaf} strokeWidth=".5" {...(animate && { className: "leafs", style: d(700 + bi * 140 + i * 40) })} />)}
          {b.fruits.map(([x, y], i) => <circle key={i} cx={x} cy={y} r="3.5" fill="var(--fruit)" stroke={fruitEdge} strokeWidth=".75" {...(animate && { className: "fruit", style: d(1200 + bi * 140 + i * 80) })} />)}
        </g>
      ))}
      {t.hiddenFruits > 0 && <text x="290" y="16" textAnchor="end" className={`${tone === "onLeaf" ? "fill-on-leaf" : "fill-bark"} font-mono text-[11px]`}>+{t.hiddenFruits}</text>}
    </svg>
  );
  return animate ? <Reveal className={className}>{svg}</Reveal> : svg;
}
