import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { RiskCallout } from "@/components/data";
import { NavChart } from "@/components/nav-chart";
import { RoundCountdown } from "@/components/round-countdown";
import { LiveUpdates } from "@/components/live-updates";
import { Footer, Header } from "@/components/layout-parts";
import { Timeline } from "@/components/timeline";
import { TrellisBackground } from "@/components/motif";
import { ROUND_STATUS, RoundHistoryTable } from "@/components/product";
import { DepositWithdrawPanel } from "@/components/trade-panels";
import { EmptyState, Panel } from "@/components/ui";
import { UpsideSimulator } from "@/components/upside-simulator";
import { ConfigError, SYMBOL } from "@/lib/api/http";
import { getVault } from "@/lib/api/queries";
import { spurLive } from "@/lib/web3/env";
import { vaultTopics } from "@/lib/realtime/live";
import { pct, usd } from "@/lib/format";

// Round, strike, dan APY berubah tiap minggu: jangan dibekukan saat build.
export const dynamic = "force-dynamic";

type Props = { params: Promise<{ symbol: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { symbol } = await params;
  const safe = SYMBOL.test(symbol) ? symbol : "Vault";
  return { title: `${safe} — Espalier`, description: `Harvest history, deposit, and withdraw for ${safe}. Demo preview.` };
}

const expiryFmt = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
const qtyFmt = new Intl.NumberFormat("en-US", { maximumFractionDigits: 4 });
const HISTORY_MAX = 20;

type Vault = NonNullable<Awaited<ReturnType<typeof getVault>>>;
type Loaded = { kind: "ok"; vault: Vault } | { kind: "missing" } | { kind: "unconfigured" } | { kind: "error" };

// Kalimat untuk pembaca layar saat data round berubah: round aktif (status, premium) atau round terakhir.
function roundAnnouncement(v: Vault) {
  const r = v.currentRound ?? v.rounds[0];
  if (!r) return "No rounds yet";
  const status = ROUND_STATUS[r.status] ?? r.status;
  return `${v.symbol} round ${r.no} is ${status}${r.premiumUsdg === null ? "" : `, premium ${usd(r.premiumUsdg)}`}${v.currentRound ? "" : ". No round is open"}`;
}

async function load(symbol: string): Promise<Loaded> {
  try {
    const vault = await getVault(symbol);
    return vault ? { kind: "ok", vault } : { kind: "missing" };
  } catch (e) {
    if (e instanceof ConfigError) return { kind: "unconfigured" };
    console.error(e);
    return { kind: "error" };
  }
}

export default async function VaultDetailPage({ params }: Props) {
  const { symbol } = await params;
  if (!SYMBOL.test(symbol)) notFound();
  const data = await load(symbol);
  if (data.kind === "missing") notFound();
  const vault = data.kind === "ok" ? data.vault : null;

  return (
    <>
      <Header />
      <main>
        <section aria-labelledby="vault-title" className="relative overflow-hidden border-b border-wire py-12 max-md:py-8">
          <TrellisBackground className="!opacity-35 [mask-image:linear-gradient(90deg,transparent_30%,black)]" />
          <div className="wrap relative space-y-4">
            <nav aria-label="Breadcrumb" className="flex items-center gap-2 text-sm text-bark">
              <Link href="/vaults" className="underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-leaf">Spurs &amp; Grafts</Link>
              <span aria-hidden>/</span><span aria-current="page">{symbol}</span>
            </nav>
            <div className="grid items-end gap-6 md:grid-cols-[1fr_auto] md:gap-12">
              <div className="space-y-3">
                <h1 id="vault-title" className="font-display text-[clamp(2.6rem,6vw,4.6rem)] leading-none font-normal tracking-[-.03em]">
                  {symbol}
                  {vault?.isDemo && <span className="ml-3 rounded-full border border-wire px-2.5 py-0.5 align-middle font-sans text-xs font-medium tracking-normal text-bark">demo</span>}
                </h1>
                {vault && <p className="max-w-[44ch] text-[1.08rem] text-bark">{vault.kind === "spur" ? "Spur Vault. Covered call" : "Graft Vault. Cash-secured put"} on {vault.underlying}. A Picker pays premium up front each round.</p>}
              </div>
              {vault && (
                <div className="md:text-right">
                  <p className="text-sm text-bark">Realized APY</p>
                  <p className="font-mono text-[clamp(2.2rem,5vw,3.4rem)] leading-none font-medium">
                    {vault.realizedApy === null
                      ? <>—<span className="sr-only"> no settled rounds yet</span></>
                      : <span className="inline-flex items-center gap-2.5"><i aria-hidden className="inline-block size-3 rounded-full border border-bark bg-fruit" />{pct(vault.realizedApy, 1)}</span>}
                  </p>
                  <p className="mt-2 text-sm text-bark">{vault.settledRounds > 0 ? `Average of ${vault.settledRounds} settled ${vault.settledRounds === 1 ? "round" : "rounds"}. Not a forecast.` : "No settled rounds yet."}</p>
                </div>
              )}
            </div>
            {vault?.isDemo && <p><span className="rounded-full border border-wire px-3 py-1 text-sm text-bark">Demo data · not live prices</span></p>}
            {vault && <LiveUpdates topics={vaultTopics(vault.id)} announcement={roundAnnouncement(vault)} />}
          </div>
        </section>

        {data.kind === "unconfigured" && (
          <div className="wrap py-12">
            <EmptyState title="Data is not connected yet" text="This preview could not reach its data source, so this vault cannot be shown.">
              {process.env.NODE_ENV !== "production" && (
                <p className="font-mono text-xs text-bark">Dev: fill NEXT_PUBLIC_SUPABASE_URL and a publishable key in .env.local, then apply the migrations.</p>
              )}
            </EmptyState>
          </div>
        )}
        {data.kind === "error" && (
          <div className="wrap py-12">
            <EmptyState title="The garden is out of reach" text="We could not load this vault just now. Try again in a moment." />
          </div>
        )}

        {vault && <Body vault={vault} />}

      </main>
      <Footer />
    </>
  );
}

function Risk({ kind }: { kind: "spur" | "graft" }) {
  return (
    <RiskCallout>
      {kind === "graft"
        ? "In a Graft, if the price ends below the strike, the vault pays out the shortfall in USDG and you keep only what is left plus the premium. "
        : "Spurs cap your upside. That is the trade. If the stock ends above the strike, the vault pays the difference in tokens and you keep the premium. "}
      Past rounds do not predict future ones. Stock Tokens are tokenised debt securities: economic exposure to a stock, not legal rights to the shares. Token prices can sit above the raw share price because dividends are reinvested. Not offered to US persons; other regions are restricted.
    </RiskCallout>
  );
}

const roundSteps = [
  { when: "Start of round", title: "Roll", text: "Queued deposits join. The strike is set." },
  { when: "Same round", title: "Sell", text: "A Picker fills a signed quote and pays the premium up front." },
  { when: "Expiry", title: "Settle", text: "The round ends at its expiry. Settlement rules are not final yet." },
  { when: "After", title: "Harvest", text: "The premium is yours to claim in USDG." },
];

function Body({ vault }: { vault: Vault }) {
  const { kind, underlying, symbol, currentRound: cur, rounds, premiumHint } = vault;
  const isSpur = kind === "spur";
  // Simulator wajib sebelum deposit ke Spur (brief §4). Butuh strike dan harga awal round aktif.
  const sim = isSpur && cur && cur.spotStart ? { spot: cur.spotStart, strike: cur.strike, premiumPct: premiumHint?.pct ?? 0 } : null;
  // Panel live: deposit hanya mengantre untuk roll berikutnya, dan vault yang baru di-deploy (atau yang sedang di antara dua
  // round) tidak punya round aktif. Tanpa pengecualian ini round pertama tidak pernah bisa dimulai lewat UI (roll tanpa share
  // dilewati). Simulator tetap tampil bila ada round aktif; bila tidak ada, panel menjelaskan bahwa strike ditetapkan saat roll.
  const live = isSpur && spurLive(symbol);
  const canDeposit = !isSpur || sim !== null || live;
  const shown = rounds.slice(0, HISTORY_MAX);
  // Premium kumulatif dari round settled (lama ke baru). Garis hanya digambar bila ada minimal dua titik.
  const settledAsc = [...rounds].filter((r) => r.status === "settled" && r.premiumUsdg !== null)
    .sort((x, y) => new Date(x.expiry).getTime() - new Date(y.expiry).getTime());
  const cumulative = settledAsc.map((r, i) => ({
    ts: new Date(r.expiry).getTime(),
    nav: settledAsc.slice(0, i + 1).reduce((acc, x) => acc + (x.premiumUsdg ?? 0), 0),
  }));

  return (
    <div className="wrap grid gap-6 py-12 md:grid-cols-[1fr_22.5rem] md:items-start">
      <div className="min-w-0 space-y-6">
        {kind === "graft" && (
          <p className="flex gap-3 rounded-[16px] border border-dashed border-wire p-4 text-[.95rem]"><span aria-hidden>◌</span><span><b>After MVP.</b> This vault is a preview. Graft Vaults are demo only for now.</span></p>
        )}

        <Panel title="Current round" sub={cur ? `Round #${cur.no} · ${ROUND_STATUS[cur.status] ?? cur.status}` : undefined}>
          {cur ? (
            <>
              <dl className="grid gap-x-8 gap-y-4 sm:grid-cols-2">
                {([
                  ["Strike", <span key="s" className="font-mono">{usd(cur.strike)}</span>],
                  ["Expires", <time key="e" dateTime={cur.expiry} className="font-mono">{expiryFmt.format(new Date(cur.expiry))} ET</time>],
                  ["Notional", <span key="n" className="font-mono">{qtyFmt.format(cur.notional)} {underlying}</span>],
                  ["Premium", <span key="p" className="font-mono">{cur.premiumUsdg === null ? "Not auctioned yet" : usd(cur.premiumUsdg)}</span>],
                ] as const).map(([k, v]) => (
                  <div key={k} className="border-b border-wire/60 pb-2"><dt className="text-[.86rem] text-bark">{k}</dt><dd className="text-[1.05rem] font-medium">{v}</dd></div>
                ))}
              </dl>
              <div className="mt-5"><RoundCountdown expiry={cur.expiry} label="Time to expiry" /></div>
            </>
          ) : <p className="text-bark">No round is open right now.</p>}
          <p className="mt-4 text-sm text-bark">
            {isSpur
              ? "If the price at settlement ends above the strike, the vault pays the Picker the difference in tokens. At or below the strike, nothing is paid and you keep your tokens and the premium."
              : "If the price at settlement ends below the strike, the vault pays the Picker the shortfall in USDG. At or above the strike, nothing is paid and you keep your USDG and the premium."}{" "}
            Premium is paid in USDG. Settlement rules are not final yet.
          </p>
        </Panel>

        {sim && (
          <section aria-labelledby="sim-title">
            <h2 id="sim-title" className="font-display text-[1.6rem] font-[450] tracking-[-.01em]">If {underlying} moves this week</h2>
            <p className="mt-1 mb-4 text-[.92rem] text-bark">Slide to see a week play out against the strike. Demo numbers, not a forecast.</p>
            <UpsideSimulator symbol={underlying} spot={sim.spot} strike={sim.strike} weeklyPremiumPct={sim.premiumPct} spotLabel="the round's starting price" />
            <p className="mt-3 text-sm text-bark">
              {premiumHint?.source === "round" && "Uses this round's premium."}
              {premiumHint?.source === "last" && "This round has no premium yet, so this uses the last settled round's premium."}
              {!premiumHint && "No premium is set for this round yet, so this shows the cap only."}
            </p>
          </section>
        )}

        <Panel title="Harvest history" sub="Realized, round by round.">
          {cumulative.length >= 2 && (
            <div className="mb-5">
              <NavChart points={cumulative} harvests={cumulative.map((c) => c.ts)} label="Cumulative premium harvested, USDG" />
              <p className="mt-1 text-sm text-bark">Cumulative premium from settled rounds. Gold dots mark each Harvest.</p>
            </div>
          )}
          {shown.length > 0 ? (
            <>
              <RoundHistoryTable rounds={shown} />
              {rounds.length > shown.length && <p className="mt-3 text-sm text-bark">Showing the latest {shown.length} of {rounds.length} rounds.</p>}
            </>
          ) : <p className="text-bark">No rounds yet. The first Harvest will show up here.</p>}
        </Panel>

        <Panel title="How a round works">
          <Timeline steps={roundSteps} horizontal className="mt-5" />
        </Panel>
      </div>

      <aside aria-label="Deposit, withdraw, and risk" className="min-w-0 space-y-4 md:sticky md:top-20">
        {canDeposit
          ? <DepositWithdrawPanel symbol={symbol} asset={isSpur ? "stock" : "USDG"} unit={isSpur ? underlying : undefined} />
          : (
            <Panel title="Deposit">
              <p className="text-bark">Deposits open once a round is set with a strike and a starting price. You will see the upside simulator first.</p>
            </Panel>
          )}
        {live && sim === null && <p className="text-sm text-bark">No round is open right now. A deposit made now joins the next round. Its strike (set above the price when that round starts) and premium are fixed at that moment, and any gain above the strike goes to the Picker.</p>}
        <p className="text-sm text-bark">{live ? "Transactions are sent from your wallet and settle on-chain." : "Simulation only. No transaction is sent in this preview."}</p>
        <Risk kind={kind} />
      </aside>
    </div>
  );
}
