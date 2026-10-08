import { CountUp } from "./count-up";
import type { FeedItem, HomeData } from "@/lib/api/home-derive";

// Bar aktivitas di bawah hero (section.chainbar di espalier.html): empat angka yang naik, dan feed yang berjalan.
// Semua angka dan baris feed berasal dari data nyata (lib/api/queries.ts getHomeData, hanya produk non-demo).
// Tanpa data (belum tersambung atau gagal dimuat) angka tampil sebagai "—", bukan nilai karangan.
const labels: { label: string; key: keyof HomeData["stats"]; format: "usd" | "int"; note: string }[] = [
  { label: "Value planted", key: "valueUsd", format: "usd", note: "in Cordons and open rounds" },
  { label: "Products live", key: "products", format: "int", note: "Cordons and vaults" },
  { label: "Harvests settled", key: "harvests", format: "int", note: "rounds so far" },
  { label: "Premium harvested", key: "premiumUsdg", format: "usd", note: "paid out in USDG" },
];
const Item = ({ a, b, c, dup }: FeedItem & { dup?: boolean }) => (
  <span aria-hidden={dup || undefined} className="inline-flex items-center gap-[9px] font-mono text-[.8rem] whitespace-nowrap text-bark">
    <i aria-hidden className="size-[7px] rounded-full border border-bark bg-fruit" /><b className="font-medium text-ink">{a}</b> {b} {c && <b className="font-medium text-ink">{c}</b>}
  </span>
);

export function ChainBar({ stats, feed }: { stats: HomeData["stats"] | null; feed: FeedItem[] }) {
  return (
    <section aria-label="Protocol activity" className="overflow-hidden border-y border-wire bg-[color-mix(in_srgb,var(--panel)_55%,transparent)] pt-[30px]">
      <dl className="wrap grid grid-cols-2 gap-x-8 gap-y-5 pb-3 md:grid-cols-4">
        {labels.map((s) => (
          <div key={s.label} className="flex flex-col gap-0.5 border-l-[1.5px] border-bark pl-3.5">
            <dt className="text-[.84rem] text-bark">{s.label}</dt>
            <dd className="m-0 font-mono text-[clamp(1.4rem,2.8vw,2.1rem)] font-medium tracking-[-.02em]">
              {stats ? <CountUp end={stats[s.key]} format={s.format} /> : <>—<span className="sr-only"> not available</span></>}
            </dd>
            <dd className="m-0 text-[.76rem] text-bark">{s.note}</dd>
          </div>
        ))}
      </dl>
      <p className="wrap pb-4 text-xs text-bark">{stats ? "Live figures. They change as rounds settle." : "Live figures are not available right now."}</p>
      {feed.length > 0 && (
        <div className="feed border-t border-wire py-3" tabIndex={0} aria-label="Recent activity">
          <div className="feed-track">
            {feed.map((f, i) => <Item key={i} {...f} />)}
            {feed.map((f, i) => <Item key={`d${i}`} {...f} dup />)}
          </div>
        </div>
      )}
    </section>
  );
}
