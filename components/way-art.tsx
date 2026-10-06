// Ilustrasi garis tiga produk di Landing (dari espalier.html). Server component, SVG polos, dekoratif.
// Satu warna kulit kayu (--bark), buah emas hanya sebagai fill. Garis dan buah tumbuh bertahap saat terlihat:
// kelas .draw/.fruit hanya aktif di dalam <Reveal> (lihat globals.css) dan mati bila pengguna meminta reduced motion.
const S = { fill: "none", stroke: "var(--bark)", strokeWidth: 1.25, strokeLinecap: "round" } as const;
const d = (ms: number) => ({ "--d": `${ms}ms` }) as React.CSSProperties;
const Draw = ({ path, ms = 0 }: { path: string; ms?: number }) => <path {...S} className="draw" pathLength={1} style={d(ms)} d={path} />;

export function WayArt({ kind }: { kind: "cordon" | "spur" | "graft" }) {
  return (
    <svg viewBox="0 0 300 120" aria-hidden className="mb-4 block h-auto w-full max-w-[300px]">
      {kind === "cordon" && (
        <>
          <Draw path="M150 120V20" />
          <Draw path="M150 60H40q-12 0-12-14" ms={300} />
          <Draw path="M150 60h110q12 0 12-14" ms={400} />
          <g fill="var(--fruit)" stroke="var(--bark)" strokeWidth="1">
            {[60, 90, 120, 180, 210, 240].map((x, i) => <circle key={x} className="fruit" style={d(800 + i * 60)} cx={x} cy="60" r="4" />)}
            <circle className="fruit" style={d(1160)} cx="150" cy="20" r="4" />
          </g>
        </>
      )}
      {kind === "spur" && (
        <>
          <Draw path="M20 80H280" />
          <Draw path="M90 80q0-24 14-34" ms={400} />
          <Draw path="M170 80q0-24-14-34" ms={500} />
          <Draw path="M230 80q0-24 14-34" ms={600} />
          <line x1="20" x2="280" y1="40" y2="40" stroke="var(--wire)" strokeDasharray="4 6" />
          <g fill="var(--fruit)" stroke="var(--bark)">
            <circle className="fruit" style={d(900)} cx="105" cy="44" r="6" />
            <circle className="fruit" style={d(1050)} cx="155" cy="44" r="6" />
            <circle className="fruit" style={d(1200)} cx="245" cy="44" r="6" />
          </g>
        </>
      )}
      {kind === "graft" && (
        <>
          <Draw path="M150 120V64" />
          <Draw path="M150 64l-6-10 6-10 6 10z" ms={400} />
          <Draw path="M150 44V12M150 30H110M150 22h44" ms={600} />
          <line x1="60" x2="240" y1="64" y2="64" stroke="var(--wire)" strokeDasharray="4 6" />
        </>
      )}
    </svg>
  );
}
