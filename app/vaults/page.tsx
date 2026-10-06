import type { Metadata } from "next";
import Link from "next/link";
import { RiskCallout } from "@/components/data";
import { Footer, Header } from "@/components/layout-parts";
import { TrellisBackground } from "@/components/motif";
import { VaultCard } from "@/components/product";
import { ButtonLink, EmptyState } from "@/components/ui";
import { ConfigError } from "@/lib/api/http";
import { listVaults } from "@/lib/api/queries";

// Round dan APY berubah tiap minggu: jangan dibekukan saat build.
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Spurs & Grafts — Espalier",
  description: "Weekly vaults. See each vault's realized APY and this week's strike. Demo preview.",
};

type Props = { searchParams: Promise<{ kind?: string | string[] }> };
const FILTERS = [{ key: "all", label: "All" }, { key: "spur", label: "Spurs" }, { key: "graft", label: "Grafts" }] as const;
type Filter = (typeof FILTERS)[number]["key"];
// Nilai tak dikenal jatuh ke "all".
const parseFilter = (v: string | string[] | undefined): Filter => { const k = Array.isArray(v) ? v[0] : v; return k === "spur" || k === "graft" ? k : "all"; };

type Vaults = Awaited<ReturnType<typeof listVaults>>;
type Loaded = { kind: "ok"; vaults: Vaults } | { kind: "unconfigured" } | { kind: "error" };

async function load(): Promise<Loaded> {
  try { return { kind: "ok", vaults: await listVaults() }; }
  catch (e) {
    if (e instanceof ConfigError) return { kind: "unconfigured" };
    console.error(e);
    return { kind: "error" };
  }
}

// Graft Vault di luar MVP (brief §6). Jika belum ada di data, tampil sebagai "belum live": tanpa link, tanpa angka.
const plannedGraft = { symbol: "gNVDA", text: "Graft Vault. Cash-secured put on NVDA." };

function VaultList({ vaults }: { vaults: Vaults }) {
  return (
    <>
      {vaults.map((v) => (
        <li key={v.symbol}>
          <VaultCard symbol={v.symbol} kind={v.kind} underlying={v.underlying} apy={v.realizedApy}
            strike={v.currentRound?.strike ?? null} round={v.currentRound} isDemo={v.isDemo} />
        </li>
      ))}
    </>
  );
}

export default async function VaultsPage({ searchParams }: Props) {
  const filter = parseFilter((await searchParams).kind);
  const data = await load();
  const spurs = data.kind === "ok" ? data.vaults.filter((v) => v.kind === "spur") : [];
  const grafts = data.kind === "ok" ? data.vaults.filter((v) => v.kind === "graft") : [];
  const anyDemo = data.kind === "ok" && data.vaults.some((v) => v.isDemo);
  const showPlannedGraft = data.kind === "ok" && !grafts.some((g) => g.symbol === plannedGraft.symbol);
  const shownSpurs = filter === "graft" ? [] : spurs, shownGrafts = filter === "spur" ? [] : grafts;
  const showPlanned = showPlannedGraft && filter !== "spur";

  return (
    <>
      <Header />
      <main>
        <section aria-labelledby="vaults-title" className="relative overflow-hidden border-b border-wire py-14 max-md:py-9">
          <TrellisBackground className="!opacity-35 [mask-image:linear-gradient(90deg,transparent_30%,black)]" />
          <div className="wrap relative space-y-4">
            <h1 id="vaults-title" className="font-display text-[clamp(2.6rem,6vw,4.6rem)] leading-none font-normal tracking-[-.03em]">Spurs &amp; Grafts</h1>
            <p className="max-w-[56ch] text-[1.08rem] text-bark">
              Weekly option vaults. Each round, a Picker pays premium up front for a set strike, and you collect it in USDG. Every number here is realized, never projected. Spurs cap your upside. That is the trade.
            </p>
            {anyDemo && <p><span className="rounded-full border border-wire px-3 py-1 text-sm text-bark">Demo data · not live prices</span></p>}
          </div>
        </section>

        <section aria-labelledby="list-title" className="wrap py-10">
          <h2 id="list-title" className="sr-only">Vaults</h2>
          <nav aria-label="Filter vaults" className="mb-6 inline-flex gap-1 rounded-full border border-wire p-1">
            {FILTERS.map((f) => (
              <Link key={f.key} href={f.key === "all" ? "/vaults" : `/vaults?kind=${f.key}`} scroll={false} aria-current={f.key === filter ? "true" : undefined}
                className={`inline-flex min-h-9 min-w-14 items-center justify-center rounded-full px-4 text-sm font-medium focus-visible:outline-2 focus-visible:outline-leaf ${f.key === filter ? "bg-leaf text-on-leaf" : "text-bark hover:bg-wire/30"}`}>
                {f.label}
              </Link>
            ))}
          </nav>

          {data.kind === "ok" && (shownSpurs.length > 0 || shownGrafts.length > 0 || showPlanned) && (
            <ul className="grid gap-4">
              <VaultList vaults={shownSpurs} />
              <VaultList vaults={shownGrafts} />
              {showPlanned && (
                <li className="grid items-center gap-6 rounded-[20px] border border-dashed border-wire px-[26px] py-6 md:grid-cols-[minmax(150px,1.1fr)_2fr_auto]">
                  <div>
                    <h3 className="font-display text-[2rem] leading-none font-[450] tracking-[-.02em]">{plannedGraft.symbol}</h3>
                    <p className="mt-1.5 text-[.84rem] text-bark">{plannedGraft.text}</p>
                  </div>
                  <dl className="grid grid-cols-[repeat(auto-fit,minmax(110px,1fr))] gap-x-5 gap-y-3 text-[.86rem]">
                    <div><dt className="text-bark">Collateral</dt><dd className="font-medium">USDG</dd></div>
                    <div><dt className="text-bark">Strike</dt><dd className="font-medium">Below today’s price</dd></div>
                    <div><dt className="text-bark">Status</dt><dd className="font-medium">After MVP</dd></div>
                  </dl>
                  <span className="w-fit rounded-full border border-wire px-3 py-1 text-xs font-medium text-bark">Not live</span>
                </li>
              )}
            </ul>
          )}
          {data.kind === "ok" && filter !== "graft" && spurs.length === 0 && (
            <div className={shownGrafts.length > 0 || showPlanned ? "mt-6" : ""}>
              <EmptyState title="No Spur Vaults planted yet" text="The first vault has not been set. Check back soon.">
                <ButtonLink href="/docs" variant="ghost" className="mt-2">Read how Spurs work</ButtonLink>
              </EmptyState>
            </div>
          )}
          {data.kind === "ok" && filter === "graft" && shownGrafts.length === 0 && !showPlanned && (
            <EmptyState title="No Graft Vaults yet" text="Grafts come after the first Spur Vault has run. Check back later." />
          )}
          {data.kind === "unconfigured" && (
            <EmptyState title="Data is not connected yet" text="This preview could not reach its data source, so no vaults are shown.">
              {process.env.NODE_ENV !== "production" && (
                <p className="font-mono text-xs text-bark">Dev: fill NEXT_PUBLIC_SUPABASE_URL and a publishable key in .env.local, then apply the migrations.</p>
              )}
            </EmptyState>
          )}
          {data.kind === "error" && <EmptyState title="The garden is out of reach" text="We could not load the vaults just now. Try again in a moment." />}
        </section>

        <section aria-labelledby="apy-title" className="wrap pb-6">
          <h2 id="apy-title" className="font-display text-xl">How we read the numbers</h2>
          <p className="mt-2 max-w-prose text-sm text-bark">
            Realized APY is the average weekly premium of settled rounds, as a share of the notional at the round&apos;s starting price, times 52. It is simple, without compounding, and looks backward only. Strike this week is the price set for the round that is open now.
          </p>
        </section>

        <section aria-labelledby="risk-title" className="wrap pb-12">
          <h2 id="risk-title" className="sr-only">Risks</h2>
          <RiskCallout>
            In a Spur, if the stock ends above the strike, the vault pays the difference in tokens and you keep the premium: your upside stops at the strike. In a Graft, if the price ends below the strike, the vault pays out the shortfall. Past rounds do not predict future ones. Stock Tokens are tokenised debt securities: economic exposure to a stock, not legal rights to the shares. Not offered to US persons; other regions are restricted.
          </RiskCallout>
        </section>
      </main>
      <Footer />
    </>
  );
}
