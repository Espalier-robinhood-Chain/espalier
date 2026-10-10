import type { Metadata } from "next";
import { MarketStatusPill, RiskCallout } from "@/components/data";
import { Footer, Header } from "@/components/layout-parts";
import { CordonDivider, TrellisBackground } from "@/components/motif";
import { CordonCard } from "@/components/product";
import { ButtonLink, EmptyState } from "@/components/ui";
import { ConfigError } from "@/lib/api/http";
import { marketState, nextChange } from "@/lib/api/market";
import { getNav, listCordons } from "@/lib/api/queries";

// Data berubah (NAV, sesi pasar): jangan dibekukan saat build.
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Cordons — Espalier",
  description: "One token, one basket. See the NAV and composition of each Cordon. Demo preview.",
};

const sessionFmt = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", weekday: "short", hour: "numeric", minute: "2-digit" });

// Basket pasca-MVP. Komposisi = mainnet (cCHIP: NVDA AMD TSM MU; cVOLT: TSLA PLTR RKLB IONQ, bobot 25% x 4 = asumsi). Bukan produk live: tanpa link, tanpa angka.
const planned = [
  { symbol: "cCHIP", name: "Semiconductors", chips: ["NVDA", "AMD", "TSM", "MU"], weighting: "Equal" },
  { symbol: "cVOLT", name: "Volt", chips: ["TSLA", "PLTR", "RKLB", "IONQ"], weighting: "Equal" },
];

type Loaded = { kind: "ok"; cordons: Awaited<ReturnType<typeof listCordons>>; trends: Record<string, number[]> } | { kind: "unconfigured" } | { kind: "error" };

async function load(): Promise<Loaded> {
  try {
    const cordons = await listCordons();
    // Tren 3 bulan untuk sparkline. Kegagalan satu Cordon hanya menghilangkan garisnya, bukan halaman.
    const navs = await Promise.allSettled(cordons.map((c) => getNav(c.symbol, 90)));
    const trends: Record<string, number[]> = {};
    navs.forEach((r, i) => { if (r.status === "fulfilled" && r.value) trends[cordons[i].symbol] = r.value.points.map((p) => p.nav); });
    return { kind: "ok", cordons, trends };
  }
  catch (e) {
    if (e instanceof ConfigError) return { kind: "unconfigured" };
    console.error(e);
    return { kind: "error" };
  }
}

export default async function CordonsPage() {
  const data = await load();
  const now = new Date(), next = nextChange(now);
  const nextLabel = next ? `until ${sessionFmt.format(new Date(next))} ET` : undefined;
  const anyDemo = data.kind === "ok" && data.cordons.some((c) => c.isDemo);
  // Basket yang sudah ada di database (mis. cCHIP setelah indexer menulisnya) pindah ke "In the garden", bukan lagi "Not yet planted".
  const live = new Set(data.kind === "ok" ? data.cordons.map((c) => c.symbol) : []);
  const stillPlanned = planned.filter((p) => !live.has(p.symbol));

  return (
    <>
      <Header />
      <main>
        <section aria-labelledby="cordons-title" className="relative overflow-hidden border-b border-wire py-14 max-md:py-9">
          <TrellisBackground className="!opacity-35 [mask-image:linear-gradient(90deg,transparent_30%,black)]" />
          <div className="wrap relative space-y-4">
            <h1 id="cordons-title" className="font-display text-[clamp(2.6rem,6vw,4.6rem)] leading-none font-normal tracking-[-.03em]">Cordons</h1>
            <p className="max-w-[56ch] text-[1.08rem] text-bark">
              Disciplined baskets of stocks. One token holds the whole basket, and its value follows the stocks inside. Pruned on schedule, so you do not have to.
            </p>
            <div className="flex flex-wrap items-center gap-3 pt-2">
              <MarketStatusPill state={marketState(now)} next={nextLabel} />
              {anyDemo && <span className="rounded-full border border-wire px-3 py-1 text-sm text-bark">Demo data · not live prices</span>}
            </div>
            <p className="text-sm text-bark">Session times are approximate and do not yet reflect exchange holidays.</p>
          </div>
        </section>

        <section aria-labelledby="live-title" className="wrap py-12">
          <h2 id="live-title" className="font-display text-2xl">In the garden</h2>
          <div className="mt-6">
            {data.kind === "ok" && data.cordons.length > 0 && (
              <ul className="grid gap-4">
                {data.cordons.map((c) => (
                  <li key={c.symbol}>
                    <CordonCard symbol={c.symbol} name={c.name} nav={c.navPerShare} change={c.change} assets={c.assets} tvlUsd={c.tvlUsd}
                      composition={c.composition.map((x) => ({ label: x.ticker, weightBps: x.weightBps }))} trend={data.trends[c.symbol]} isDemo={c.isDemo} />
                  </li>
                ))}
              </ul>
            )}
            {data.kind === "ok" && data.cordons.length === 0 && (
              <EmptyState title="No Cordons planted yet" text="The first basket has not been set. Check back soon.">
                <ButtonLink href="/docs" variant="ghost" className="mt-2">Read how Cordons work</ButtonLink>
              </EmptyState>
            )}
            {data.kind === "unconfigured" && (
              <EmptyState title="Data is not connected yet" text="This preview could not reach its data source, so no baskets are shown.">
                {process.env.NODE_ENV !== "production" && (
                  <p className="font-mono text-xs text-bark">Dev: fill NEXT_PUBLIC_SUPABASE_URL and a publishable key in .env.local, then apply the migrations.</p>
                )}
              </EmptyState>
            )}
            {data.kind === "error" && (
              <EmptyState title="The garden is out of reach" text="We could not load the baskets just now. Try again in a moment." />
            )}
          </div>
        </section>

        <div className="wrap"><CordonDivider /></div>

        <section aria-labelledby="planned-title" className="wrap py-12">
          <h2 id="planned-title" className="font-display text-2xl">Not yet planted</h2>
          <p className="mt-2 max-w-prose text-bark">Planned baskets. Not live, and not available to mint.</p>
          <ul className="mt-6 grid gap-4">
            {stillPlanned.map((p) => (
              <li key={p.symbol} className="grid items-center gap-6 rounded-[20px] border border-dashed border-wire px-[26px] py-6 md:grid-cols-[minmax(150px,1.1fr)_2fr_auto]">
                <div>
                  <h3 className="font-display text-[2rem] leading-none font-[450] tracking-[-.02em]">{p.symbol}</h3>
                  <p className="mt-1.5 text-[.84rem] text-bark">{p.name}</p>
                  <ul className="mt-2.5 flex flex-wrap gap-1.5" aria-label="Planned components">
                    {p.chips.map((c) => <li key={c} className="rounded-full border border-wire px-[9px] py-0.5 font-mono text-[.76rem] text-bark">{c}</li>)}
                  </ul>
                </div>
                <dl className="grid grid-cols-[repeat(auto-fit,minmax(110px,1fr))] gap-x-5 gap-y-3 text-[.86rem]">
                  <div><dt className="text-bark">Status</dt><dd className="font-medium">After MVP</dd></div>
                  {p.weighting && <div><dt className="text-bark">Weighting</dt><dd className="font-medium">{p.weighting}</dd></div>}
                </dl>
                <span className="w-fit rounded-full border border-wire px-3 py-1 text-xs font-medium text-bark">Not planted yet</span>
              </li>
            ))}
          </ul>
        </section>

        <section aria-labelledby="risk-title" className="wrap pb-12">
          <h2 id="risk-title" className="sr-only">Risks</h2>
          <RiskCallout>
            A Cordon keeps the ups and downs of its basket. Its Stock Tokens are tokenised debt securities: economic exposure to a stock, not legal rights to the shares. Token prices can sit above the raw share price because dividends are reinvested. Not offered to US persons; other regions are restricted.
          </RiskCallout>
        </section>
      </main>
      <Footer />
    </>
  );
}
