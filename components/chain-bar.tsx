import { CountUp } from "./count-up";

// Bar aktivitas di bawah hero (section.chainbar di espalier.html): empat angka yang naik, dan feed yang berjalan.
// SEMUA ANGKA DI SINI ILUSTRATIF (belum ada data hidup) dan diberi label di bar. Jangan dihubungkan ke klaim nyata
// sebelum ada data indexer.
const stats: { label: string; end: number; format: "usd" | "int"; note: string }[] = [
  { label: "Value planted", end: 3_600_000, format: "usd", note: "across cMAG7 and sNVDA" },
  { label: "Gardeners", end: 1284, format: "int", note: "unique wallets" },
  { label: "Harvests settled", end: 24, format: "int", note: "rounds so far" },
  { label: "Premium harvested", end: 61_400, format: "usd", note: "paid out in USDG" },
];
const feed: [string, string, string][] = [
  ["0x4b2e…19c0", "minted", "12.40 cMAG7"], ["Round 24", "filled by Picker", "0x9d1f…77a2"],
  ["0x7a3f…8293", "claimed", "38.12 USDG harvest"], ["cMAG7", "pruned back to", "equal weight"],
  ["0xc03a…e5b1", "queued", "4.00 NVDA into sNVDA"], ["Round 23", "settled at", "$182.40"],
  ["0x51e8…0d4f", "shared a", "cutting"], ["0x2f90…ab37", "redeemed in-kind", "3.10 cMAG7"],
];
const Item = ({ a, b, c, dup }: { a: string; b: string; c: string; dup?: boolean }) => (
  <span aria-hidden={dup || undefined} className="inline-flex items-center gap-[9px] font-mono text-[.8rem] whitespace-nowrap text-bark">
    <i aria-hidden className="size-[7px] rounded-full border border-bark bg-fruit" /><b className="font-medium text-ink">{a}</b> {b} <b className="font-medium text-ink">{c}</b>
  </span>
);

export function ChainBar() {
  return (
    <section aria-label="Protocol activity (demo figures)" className="overflow-hidden border-y border-wire bg-[color-mix(in_srgb,var(--panel)_55%,transparent)] pt-[30px]">
      <dl className="wrap grid grid-cols-2 gap-x-8 gap-y-5 pb-3 md:grid-cols-4">
        {stats.map((s) => (
          <div key={s.label} className="flex flex-col gap-0.5 border-l-[1.5px] border-bark pl-3.5">
            <dt className="text-[.84rem] text-bark">{s.label}</dt>
            <dd className="m-0 font-mono text-[clamp(1.4rem,2.8vw,2.1rem)] font-medium tracking-[-.02em]"><CountUp end={s.end} format={s.format} /></dd>
            <dd className="m-0 text-[.76rem] text-bark">{s.note}</dd>
          </div>
        ))}
      </dl>
      <p className="wrap pb-4 text-xs text-bark">Demo figures. Not live data.</p>
      <div className="feed border-t border-wire py-3" tabIndex={0} aria-label="Illustrative recent activity">
        <div className="feed-track">
          {feed.map(([a, b, c]) => <Item key={a + b} a={a} b={b} c={c} />)}
          {feed.map(([a, b, c]) => <Item key={`d${a}${b}`} a={a} b={b} c={c} dup />)}
        </div>
      </div>
    </section>
  );
}
