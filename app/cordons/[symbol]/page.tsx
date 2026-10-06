import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { CompositionBar, Delta, MarketStatusPill, RiskCallout } from "@/components/data";
import { LiveUpdates } from "@/components/live-updates";
import { Footer, Header } from "@/components/layout-parts";
import { TrellisBackground } from "@/components/motif";
import { NavChart } from "@/components/nav-chart";
import { MintRedeemPanel } from "@/components/trade-panels";
import { tradeLive, web3Env } from "@/lib/web3/env";
import { EmptyState, Panel } from "@/components/ui";
import { changePct } from "@/lib/api/derive";
import { ConfigError, SYMBOL } from "@/lib/api/http";
import { marketState, nextChange } from "@/lib/api/market";
import { getCordonPage, getNav, getPrunings } from "@/lib/api/queries";
import { RANGES, parseRange } from "@/lib/api/range";
import { cordonTopics } from "@/lib/realtime/live";
import { usd } from "@/lib/format";

// NAV dan sesi pasar berubah: jangan dibekukan saat build.
export const dynamic = "force-dynamic";

type Props = { params: Promise<{ symbol: string }>; searchParams: Promise<{ range?: string | string[] }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { symbol } = await params;
  const safe = SYMBOL.test(symbol) ? symbol : "Cordon";
  return { title: `${safe} — Espalier`, description: `NAV, composition, and mint/redeem for ${safe}. Demo preview.` };
}

const dayFmt = new Intl.DateTimeFormat("en-US", { timeZone: "UTC", month: "short", day: "numeric", year: "numeric" });
const shareFmt = new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 });
const sinceFmt = new Intl.DateTimeFormat("en-US", { timeZone: "UTC", month: "short", day: "numeric" });
const sessionFmt = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", weekday: "short", hour: "numeric", minute: "2-digit" });
const asOfFmt = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

type Loaded =
  | { kind: "ok"; cordon: NonNullable<Awaited<ReturnType<typeof getCordonPage>>>; nav: NonNullable<Awaited<ReturnType<typeof getNav>>>; prunings: Awaited<ReturnType<typeof getPrunings>> }
  | { kind: "missing" }
  | { kind: "unconfigured" }
  | { kind: "error" };

async function load(symbol: string, days: number): Promise<Loaded> {
  try {
    // Riwayat pruning opsional: bila tabelnya belum ada (migrasi 0005 belum dijalankan), halaman tetap tampil dan panelnya memberi tahu.
    const [cordon, nav, prunings] = await Promise.all([getCordonPage(symbol), getNav(symbol, days), getPrunings(symbol).catch((e) => { console.error(e); return null; })]);
    if (!cordon || !nav) return { kind: "missing" };
    return { kind: "ok", cordon, nav, prunings };
  } catch (e) {
    if (e instanceof ConfigError) return { kind: "unconfigured" };
    console.error(e);
    return { kind: "error" };
  }
}

export default async function CordonDetailPage({ params, searchParams }: Props) {
  const { symbol } = await params;
  if (!SYMBOL.test(symbol)) notFound();
  const range = parseRange((await searchParams).range);
  const data = await load(symbol, range.days);
  if (data.kind === "missing") notFound();

  const now = new Date(), state = marketState(now), next = nextChange(now);
  const nextLabel = next ? `${sessionFmt.format(new Date(next))} ET` : undefined;
  // Feed Stock Token 24/5: hanya "closed" (akhir pekan) yang menahan aksi berbasis harga live.
  const marketOpen = state !== "closed";

  return (
    <>
      <Header />
      <main>
        <section aria-labelledby="cordon-title" className="relative overflow-hidden border-b border-wire py-12 max-md:py-8">
          <TrellisBackground className="!opacity-35 [mask-image:linear-gradient(90deg,transparent_30%,black)]" />
          <div className="wrap relative space-y-4">
            <nav aria-label="Breadcrumb" className="flex items-center gap-2 text-sm text-bark">
              <Link href="/cordons" className="underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-leaf">Cordons</Link>
              <span aria-hidden>/</span><span aria-current="page">{symbol}</span>
            </nav>
            <div className="grid items-end gap-6 md:grid-cols-[1fr_auto] md:gap-12">
              <div className="space-y-3">
                <h1 id="cordon-title" className="font-display text-[clamp(2.6rem,6vw,4.6rem)] leading-none font-normal tracking-[-.03em]">
                  {symbol}
                  {data.kind === "ok" && data.cordon.isDemo && <span className="ml-3 rounded-full border border-wire px-2.5 py-0.5 align-middle font-sans text-xs font-medium tracking-normal text-bark">demo</span>}
                </h1>
                {data.kind === "ok" && <p className="max-w-[44ch] text-[1.08rem] text-bark">{data.cordon.name}. One token holds the whole basket, and its value follows the stocks inside.</p>}
              </div>
              {data.kind === "ok" && <HeadNav cordon={data.cordon} nav={data.nav} />}
            </div>
            <div className="flex flex-wrap items-center gap-3 pt-1">
              <MarketStatusPill state={state} next={nextLabel && `until ${nextLabel}`} />
              {data.kind === "ok" && data.cordon.isDemo && <span className="rounded-full border border-wire px-3 py-1 text-sm text-bark">Demo data · not live prices</span>}
            </div>
            <p className="text-sm text-bark">Session times are approximate and do not yet reflect exchange holidays.</p>
            {data.kind === "ok" && (
              <LiveUpdates topics={cordonTopics(data.cordon.id)} announcement={data.cordon.navPerShare === null ? "" : `${symbol} NAV per share is now ${usd(data.cordon.navPerShare)}`} />
            )}
          </div>
        </section>

        {data.kind === "unconfigured" && (
          <div className="wrap py-12">
            <EmptyState title="Data is not connected yet" text="This preview could not reach its data source, so this Cordon cannot be shown.">
              {process.env.NODE_ENV !== "production" && (
                <p className="font-mono text-xs text-bark">Dev: fill NEXT_PUBLIC_SUPABASE_URL and a publishable key in .env.local, then apply the migrations.</p>
              )}
            </EmptyState>
          </div>
        )}
        {data.kind === "error" && (
          <div className="wrap py-12">
            <EmptyState title="The garden is out of reach" text="We could not load this Cordon just now. Try again in a moment." />
          </div>
        )}

        {data.kind === "ok" && <Body symbol={symbol} data={data} rangeKey={range.key} rangeLabel={range.label} marketOpen={marketOpen} nextLabel={nextLabel} />}

      </main>
      <Footer />
    </>
  );
}

const RISK = "A Cordon keeps the ups and downs of its basket. Its Stock Tokens are tokenised debt securities: economic exposure to a stock, not legal rights to the shares. Token prices can sit above the raw share price because dividends are reinvested. Not offered to US persons; other regions are restricted.";

type Okay = Extract<Loaded, { kind: "ok" }>;

// NAV besar di kepala halaman (espalier.html ".big-nav"). Perubahan = titik terakhir vs pertama dalam rentang (lihat catatan item 13).
function HeadNav({ cordon, nav }: { cordon: Okay["cordon"]; nav: Okay["nav"] }) {
  const first = nav.points[0], last = nav.points[nav.points.length - 1];
  const change = first && last && nav.points.length > 1 ? changePct(last.nav, first.nav) : null;
  return (
    <div className="md:text-right">
      <p className="font-mono text-[clamp(2.2rem,5vw,3.4rem)] leading-none font-medium">
        {cordon.navPerShare === null ? <>—<span className="sr-only"> no NAV yet</span></> : usd(cordon.navPerShare)}
      </p>
      <p className="mt-2 text-sm text-bark">
        {change !== null && first && <><span className="font-mono"><Delta value={change} /></span> since {sinceFmt.format(first.ts)}. </>}NAV per share.
      </p>
      {cordon.navPerShare !== null && last && <p className="text-sm text-bark">As of <time dateTime={new Date(last.ts).toISOString()}>{asOfFmt.format(last.ts)} ET</time></p>}
    </div>
  );
}

function Body({ symbol, data, rangeKey, rangeLabel, marketOpen, nextLabel }: {
  symbol: string; data: Okay; rangeKey: string; rangeLabel: string; marketOpen: boolean; nextLabel?: string;
}) {
  const { cordon, nav, prunings } = data;
  const composition = cordon.assets.map((a) => ({ label: a.ticker, weightBps: a.weightBps }));

  return (
    <div className="wrap grid gap-6 py-12 md:grid-cols-[1fr_22.5rem] md:items-start">
      <div className="min-w-0 space-y-6">
        <section aria-labelledby="nav-title" className="rounded-[22px] bg-panel p-7">
          <div className="mb-4 flex flex-wrap items-start justify-between gap-4">
            <div>
              <h2 id="nav-title" className="font-display text-[1.6rem] font-[450] tracking-[-.01em]">NAV</h2>
              <p className="text-[.92rem] text-bark">{rangeLabel}{cordon.tvlUsd !== null && <> · TVL <span className="font-mono">{usd(cordon.tvlUsd)}</span></>}</p>
            </div>
            <nav aria-label="NAV range" className="flex gap-1 rounded-full border border-wire p-1">
              {RANGES.map((r) => (
                <Link key={r.key} href={`?range=${r.key}`} scroll={false} aria-current={r.key === rangeKey ? "true" : undefined}
                  className={`inline-flex min-h-9 min-w-11 items-center justify-center rounded-full px-3 text-sm font-medium focus-visible:outline-2 focus-visible:outline-leaf ${r.key === rangeKey ? "bg-leaf text-on-leaf" : "text-bark hover:bg-wire/30"}`}>
                  {r.label}
                </Link>
              ))}
            </nav>
          </div>
          {nav.points.length >= 2
            ? <NavChart points={nav.points} label={`${symbol} NAV per share, ${rangeLabel}`} />
            : <p className="rounded-xl border border-dashed border-wire p-6 text-center text-bark">Not enough NAV history in this range to draw a chart.</p>}
          <p className="mt-3 text-sm text-bark">NAV is the total value of the basket divided by shares outstanding. Demo values in this preview.</p>
        </section>

        <Panel title="Composition" sub="Target weights. The basket is pruned on schedule to stay close to them, so live weights drift between prunings.">
          {composition.length > 0 ? (
            <>
              <CompositionBar items={composition} />
              <div className="mt-4 overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <caption className="sr-only">Target weight of each component of {symbol}</caption>
                  <thead className="border-b border-wire"><tr><th scope="col" className="py-2 pr-4 font-medium">Stock Token</th><th scope="col" className="py-2 text-right font-medium">Target weight</th></tr></thead>
                  <tbody className="font-mono">
                    {composition.map((c) => (
                      <tr key={c.label} className="border-b border-wire/60"><th scope="row" className="py-2 pr-4 font-medium">{c.label}</th><td className="py-2 text-right">{(c.weightBps / 100).toFixed(1)}%</td></tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          ) : <p className="text-bark">No components have been set for this Cordon yet.</p>}
        </Panel>

        <Panel title="Pruning history" sub="Rebalancing back to target weights, with every trade checked against the oracle price.">
          {prunings === null ? <p className="text-bark">Pruning history is not available right now.</p>
            : prunings.length === 0 ? <p className="text-bark">No prunings yet. The first one will show up here.</p>
            : (
              <div className="overflow-x-auto">
                <table className="w-full border-collapse text-left text-[.92rem]">
                  <caption className="sr-only">Pruning history of {symbol}</caption>
                  <thead><tr>{["Date", "Largest drift before", "After", "Trades"].map((h, i) => <th key={h} scope="col" className={`whitespace-nowrap border-b border-wire py-2.5 pr-3 text-[.82rem] font-medium text-bark ${i ? "text-right" : ""}`}>{h}</th>)}</tr></thead>
                  <tbody className="font-mono">
                    {prunings.map((r) => (
                      <tr key={r.ts}>
                        <th scope="row" className="whitespace-nowrap border-b border-dotted border-wire py-3 pr-3 text-left !font-sans font-medium"><time dateTime={r.ts}>{dayFmt.format(new Date(r.ts))}</time></th>
                        <td className="border-b border-dotted border-wire py-3 pr-3 text-right">{r.driftBeforePct.toFixed(1)}%</td>
                        <td className="border-b border-dotted border-wire py-3 pr-3 text-right">{r.driftAfterPct.toFixed(1)}%</td>
                        <td className="border-b border-dotted border-wire py-3 pr-3 text-right">{r.trades}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
        </Panel>

        <Panel title="Parameters" sub="Hard limits written into the contract. An admin role sets the actual fees, and they can never go above these.">
          <dl className="grid gap-x-8 gap-y-4 sm:grid-cols-2">
            {([
              ["Management fee ceiling", "2.00% / yr"],
              ["Mint fee ceiling", "1.00%"],
              ["Redeem fee ceiling", "1.00%"],
              ["Shares outstanding", cordon.totalSupply === null ? null : shareFmt.format(cordon.totalSupply)],
            ] as const).map(([k, v]) => (
              <div key={k} className="border-b border-wire/60 pb-2">
                <dt className="text-[.86rem] text-bark">{k}</dt>
                <dd className="font-mono text-[1.05rem] font-medium">{v ?? <>—<span className="sr-only"> no NAV point yet</span></>}</dd>
              </div>
            ))}
          </dl>
        </Panel>
      </div>

      <aside aria-label="Mint, redeem, and risk" className="min-w-0 space-y-4 md:sticky md:top-20">
        <MintRedeemPanel symbol={symbol} marketOpen={marketOpen} nextOpen={nextLabel} />
        <p className="text-sm text-bark">{tradeLive(symbol) ? `Transactions are sent from your wallet and settle on-chain. ${web3Env.mode === "testnet" ? "This is a test deployment: use test assets only. " : ""}` : "Simulation only. No transaction is sent in this preview. "}Redeeming in-kind (a share of every component) stays available whenever markets are closed.</p>
        <RiskCallout>{RISK}</RiskCallout>
      </aside>
    </div>
  );
}
