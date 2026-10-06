// Dekoratif (aria-hidden). Murni CSS (keyframes di globals.css) supaya Landing tidak memuat
// library Motion di jalur kritis. Cabang tumbuh ±600ms ease-out, buah muncul 150ms stagger.
// prefers-reduced-motion: langsung tampil utuh (animasi dimatikan di CSS).
const FRUITS: [number, number][] = [[212, 14], [252, 14], [292, 14]];

export function HeroBranch({ className = "" }: { className?: string }) {
  return (
    <svg aria-hidden viewBox="0 0 320 40" className={`h-10 w-60 ${className}`} fill="none">
      <path className="hero-branch-path" pathLength={1} d="M2 30H120C150 30 150 14 180 14H318" stroke="var(--bark)" strokeWidth="1.5" />
      {FRUITS.map(([cx, cy], i) => (
        <circle key={cx} className="hero-branch-fruit" style={{ "--i": i } as React.CSSProperties} cx={cx} cy={cy} r="4" fill="var(--fruit)" stroke="var(--bark)" strokeWidth=".75" />
      ))}
    </svg>
  );
}
