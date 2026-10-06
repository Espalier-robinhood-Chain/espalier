import { Reveal } from "./reveal";

export function TrellisBackground({ className = "" }: { className?: string }) {
  return <div aria-hidden className={`trellis ${className}`} />;
}
const d = (ms: number) => ({ "--d": `${ms}ms` }) as React.CSSProperties;
// Garis cordon yang tumbuh saat terlihat: batang, tiga tunas, lalu tiga buah (cordon-divider di espalier.html).
export function CordonDivider() {
  const S = { fill: "none", stroke: "var(--bark)", strokeWidth: 1.25, strokeLinecap: "round" } as const;
  return (
    <Reveal className="my-2">
      <svg role="separator" viewBox="0 0 1180 40" className="block h-auto w-full" aria-hidden>
        <path {...S} className="draw" pathLength={1} style={{ "--dur": "1400ms" } as React.CSSProperties} d="M0 30H1180" />
        <path {...S} className="draw" pathLength={1} style={d(500)} d="M300 30q0-14 14-20" />
        <path {...S} className="draw" pathLength={1} style={d(700)} d="M620 30q0-14-14-20" />
        <path {...S} className="draw" pathLength={1} style={d(900)} d="M900 30q0-14 14-20" />
        <g fill="var(--fruit)">
          <circle className="fruit" style={d(1100)} cx="316" cy="9" r="4" />
          <circle className="fruit" style={d(1250)} cx="604" cy="9" r="4" />
          <circle className="fruit" style={d(1400)} cx="916" cy="9" r="4" />
        </g>
      </svg>
    </Reveal>
  );
}
