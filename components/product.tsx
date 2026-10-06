import Link from "next/link";
import { pct, usd } from "@/lib/format";
import { Delta } from "./data";
import { Sparkline } from "./sparkline";
import { Tilt } from "./tilt";
import { buttonClass } from "./ui";

// Kartu daftar = "row-card" di espalier.html: ticker serif di kiri, angka di tengah, tombol di kanan.
const rowCard = "grid items-center gap-6 rounded-[20px] border border-wire bg-wall px-[26px] py-6 transition-colors hover:border-bark hover:bg-[color-mix(in_srgb,var(--panel)_50%,var(--wall))] focus-visible:outline-2 focus-visible:outline-leaf md:grid-cols-[minmax(150px,1.1fr)_2fr_auto]";
const tk = "font-display text-[2rem] leading-none font-[450] tracking-[-.02em]";
const mid = "grid grid-cols-[repeat(auto-fit,minmax(110px,1fr))] gap-x-5 gap-y-3";
const stat = "flex flex-col gap-0.5 text-[.86rem] [&>span]:text-bark [&>b]:font-mono [&>b]:text-[1.05rem] [&>b]:font-medium";
const demo = <span className="ml-2 rounded-full border border-wire px-2 py-px align-middle font-sans text-xs font-medium text-bark">demo</span>;
const dash = (why: string) => <>—<span className="sr-only"> {why}</span></>;

export function CordonCard({ symbol, name, nav, change, assets, tvlUsd, composition, trend, isDemo }: {
  symbol: string; name: string; nav: number | null; change: number | null; assets: number; tvlUsd?: number | null;
  composition?: { label: string; weightBps: number }[]; trend?: number[]; isDemo?: boolean;
}) {
  return (
    <Tilt max={3} className="h-full rounded-[20px]"><Link href={`/cordons/${symbol}`} className={`${rowCard} h-full`}>
      <div>
        <h3 className={tk}>{symbol}{isDemo && demo}</h3>
        <p className="mt-1.5 text-[.84rem] text-bark">{name} · {assets} assets</p>
        {composition && composition.length > 0 && (
          <ul className="mt-2.5 flex flex-wrap gap-1.5" aria-label="Components">
            {composition.map((c) => <li key={c.label} className="rounded-full border border-wire px-[9px] py-0.5 font-mono text-[.76rem] text-bark">{c.label}</li>)}
          </ul>
        )}
      </div>
      <div className={mid}>
        <div className={stat}><span>NAV per share</span><b>{nav === null ? dash("no NAV yet") : usd(nav)}</b></div>
        {change !== null && <div className={stat}><span>Since last close</span><b><Delta value={change} /></b></div>}
        {tvlUsd != null && <div className={stat}><span>Total value</span><b>{usd(tvlUsd)}</b></div>}
        {trend && <div className={stat}><span>Last 3 months</span><b><Sparkline values={trend} label={`${symbol} NAV trend, last 3 months, from ${usd(trend[0] ?? 0)} to ${usd(trend[trend.length - 1] ?? 0)}`} /></b></div>}
      </div>
      <span aria-hidden className={`${buttonClass("primary")} whitespace-nowrap`}>View Cordon</span>
    </Link></Tilt>
  );
}
const expiryFmt = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
export const ROUND_STATUS: Record<string, string> = { open: "open", auctioned: "premium auctioned" };

// apy dan strike boleh null: vault baru belum punya round settled (APY) atau belum punya round aktif (strike).
export function VaultCard({ symbol, kind, underlying, apy, strike, round, isDemo }: {
  symbol: string; kind: "spur" | "graft"; underlying?: string; apy: number | null; strike: number | null;
  round?: { no: number; status: string; expiry: string } | null; isDemo?: boolean;
}) {
  const type = kind === "spur" ? "Spur Vault · covered call" : "Graft Vault · cash-secured put";
  return (
    <Tilt max={3} className="h-full rounded-[20px]"><Link href={`/vaults/${symbol}`} className={`${rowCard} h-full`}>
      <div>
        <h3 className={tk}>{symbol}{isDemo && demo}</h3>
        <p className="mt-1.5 text-[.84rem] text-bark">{type}{underlying && ` on ${underlying}`}</p>
      </div>
      <div className={mid}>
        <div className={stat}><span>Strike this week</span><b>{strike === null ? dash("no open round") : usd(strike)}</b></div>
        <div className={stat}>
          <span>Realized APY</span>
          <b>{apy === null
            ? dash("no settled rounds yet")
            : <span className="inline-flex items-center gap-1.5 text-leaf"><i aria-hidden className="inline-block size-[9px] rounded-full border border-bark bg-fruit" />{pct(apy, 1)}</span>}</b>
        </div>
        <div className={stat}>
          <span>{round ? `Round #${round.no} · ${ROUND_STATUS[round.status] ?? round.status}` : "Round"}</span>
          <b className="!text-[.9rem]">{round
            ? <>expires <time dateTime={round.expiry}>{expiryFmt.format(new Date(round.expiry))} ET</time></>
            : <span className="font-sans font-normal text-bark">No round open</span>}</b>
        </div>
      </div>
      <span aria-hidden className={`${buttonClass("primary")} whitespace-nowrap`}>View vault</span>
    </Link></Tilt>
  );
}
// premiumUsdg dan settlementPrice boleh null: round yang belum dilelang atau belum settle.
export type RoundRow = { no: number; strike: number; expiry: string; premiumUsdg: number | null; settlementPrice?: number | null; status: string };
const th = "whitespace-nowrap border-b border-wire py-2.5 pr-3 text-[.82rem] font-medium text-bark";
const td = "whitespace-nowrap border-b border-dotted border-wire py-3 pr-3 font-mono";
export function RoundHistoryTable({ rounds }: { rounds: RoundRow[] }) {
  const heads: [string, boolean][] = [["Round", false], ["Strike", true], ["Expiry", false], ["Premium", true], ["Settled at", true], ["Status", false]];
  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-left text-[.92rem]">
        <caption className="sr-only">Harvest history</caption>
        <thead><tr>{heads.map(([h, r]) => <th key={h} scope="col" className={`${th} ${r ? "text-right" : ""}`}>{h}</th>)}</tr></thead>
        <tbody>
          {rounds.map((r) => (
            <tr key={r.no}>
              <th scope="row" className={`${td} !font-sans font-medium`}>#{r.no}</th>
              <td className={`${td} text-right`}>{usd(r.strike)}</td>
              <td className={td}>{r.expiry.slice(0, 10)}</td>
              <td className={`${td} text-right`}>{r.premiumUsdg === null ? "—" : usd(r.premiumUsdg)}</td>
              <td className={`${td} text-right`}>{r.settlementPrice ? usd(r.settlementPrice) : "—"}</td>
              <td className={`${td} !font-sans`}>{r.status}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
export function PositionList({ items }: { items: { id: string; label: string; valueUsd: number; weightBps: number }[] }) {
  return (
    <ul className="grid gap-y-1.5 text-[.9rem]">
      {items.map((p) => (
        <li key={p.id} className="flex items-baseline justify-between gap-3 border-b border-dotted border-wire pb-[3px]">
          <span><span className="font-mono">{p.label}</span> <span className="text-[.84rem] text-bark">{(p.weightBps / 100).toFixed(1)}%</span></span>
          <span className="font-mono">{usd(p.valueUsd)}</span>
        </li>
      ))}
    </ul>
  );
}
