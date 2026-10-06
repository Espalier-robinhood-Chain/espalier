import type { Metadata } from "next";
import { Footer, Header } from "@/components/layout-parts";
import { TrellisBackground } from "@/components/motif";
import { ROUND_STATUS, RoundHistoryTable } from "@/components/product";
import { RoundCountdown } from "@/components/round-countdown";
import { Timeline, type TimelineStep } from "@/components/timeline";
import { ButtonLink, EmptyState, Panel } from "@/components/ui";
import { ConfigError } from "@/lib/api/http";
import { getVault, listVaults } from "@/lib/api/queries";
import { shortAddr, usd } from "@/lib/format";

// Round berubah tiap minggu: jangan dibekukan saat build.
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Harvest — Espalier",
  description: "The weekly round: when it opens, when it expires, and how it settles. Demo preview.",
};

type Vault = NonNullable<Awaited<ReturnType<typeof getVault>>>;
type Loaded = { kind: "ok"; vault: Vault | null } | { kind: "unconfigured" } | { kind: "error" };

// Halaman ini membaca satu Spur Vault: yang punya round aktif, kalau tidak ada maka Spur pertama.
async function load(): Promise<Loaded> {
  try {
    const spurs = (await listVaults()).filter((v) => v.kind === "spur");
    const pick = spurs.find((v) => v.currentRound) ?? spurs[0];
    return { kind: "ok", vault: pick ? await getVault(pick.symbol) : null };
  } catch (e) {
    if (e instanceof ConfigError) return { kind: "unconfigured" };
    console.error(e);
    return { kind: "error" };
  }
}

// Kata-kata sengaja netral soal hari dan jam: aturan settlement belum final (lihat halaman vault).
const ritual: TimelineStep[] = [
  { when: "Start of round", title: "Round opens", text: "Queued deposits join. The strike is set." },
  { when: "Same round", title: "Picker pays", text: "The premium arrives up front, in USDG." },
  { when: "Expiry", title: "Expiry", text: "The bell rings. The round stops growing." },
  { when: "After the close", title: "Settlement", text: "The round settles at the first oracle price after expiry. Settlement rules are not final yet." },
  { when: "Next morning in Asia", title: "Harvest Card", text: "Your realized harvest, ready to share." },
];

const expiryFmt = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
const qtyFmt = new Intl.NumberFormat("en-US", { maximumFractionDigits: 4 });
const H2 = "font-display text-[clamp(2rem,4.4vw,3.3rem)] leading-[1.02] font-normal tracking-[-.025em]";
const HISTORY_MAX = 20;

export default async function HarvestPage() {
  const data = await load();
  const vault = data.kind === "ok" ? data.vault : null;
  const cur = vault?.currentRound ?? null;
  const rounds = vault?.rounds.slice(0, HISTORY_MAX) ?? [];

  return (
    <>
      <Header />
      <main>
        <section aria-labelledby="harvest-title" className="relative overflow-hidden border-b border-wire py-14 max-md:py-9">
          <TrellisBackground className="!opacity-35 [mask-image:linear-gradient(90deg,transparent_30%,black)]" />
          <div className="wrap relative space-y-4">
            <h1 id="harvest-title" className="font-display text-[clamp(2.6rem,6vw,4.6rem)] leading-none font-normal tracking-[-.03em]">Harvest</h1>
            <p className="max-w-[56ch] text-[1.08rem] text-bark">The garden bears fruit every week. One round, one expiry, one settlement price.</p>
            {vault?.isDemo && <p><span className="rounded-full border border-wire px-3 py-1 text-sm text-bark">Demo data · not live prices</span></p>}
          </div>
        </section>

        {data.kind === "unconfigured" && (
          <div className="wrap py-12">
            <EmptyState title="Data is not connected yet" text="This preview could not reach its data source, so no round is shown.">
              {process.env.NODE_ENV !== "production" && (
                <p className="font-mono text-xs text-bark">Dev: fill NEXT_PUBLIC_SUPABASE_URL and a publishable key in .env.local, then apply the migrations.</p>
              )}
            </EmptyState>
          </div>
        )}
        {data.kind === "error" && <div className="wrap py-12"><EmptyState title="The garden is out of reach" text="We could not load the round just now. Try again in a moment." /></div>}

        {data.kind === "ok" && (
          <>
            <section aria-labelledby="round-title" className="wrap pt-11">
              <div className="relative overflow-hidden rounded-[28px] bg-panel px-7 py-12 md:px-14">
                <TrellisBackground />
                <div className="relative grid items-center gap-8 md:grid-cols-[1fr_auto]">
                  <div className="max-w-[56ch] space-y-4">
                    <h2 id="round-title" className={H2}>{cur ? `Round #${cur.no}` : "No round is open"}</h2>
                    <p className="text-bark">
                      {!cur && "The next round opens soon. Past rounds are listed below."}
                      {cur?.status === "auctioned" && "Premium is already paid. The round is waiting for expiry."}
                      {cur?.status === "open" && "The round is open. A Picker has not paid the premium yet."}
                    </p>
                    {vault && <ButtonLink href={`/vaults/${vault.symbol}`} variant="ghost">Open {vault.symbol}</ButtonLink>}
                  </div>
                  {cur && <div className="md:min-w-[320px]"><RoundCountdown expiry={cur.expiry} label="Time to expiry" /></div>}
                </div>
              </div>
            </section>

            <section aria-labelledby="ritual-title" className="wrap py-[72px]">
              <div className="mb-11 grid items-end gap-6 md:grid-cols-2 md:gap-12">
                <h2 id="ritual-title" className={H2}>The weekly ritual</h2>
                <p className="max-w-[52ch] text-bark">Runs on the US market clock. If expiry falls on a market holiday, it moves to the last trading day of the week. The schedule shown on the site is illustrative until it is set.</p>
              </div>
              <Timeline steps={ritual} horizontal />
            </section>

            <section aria-labelledby="this-title" className="wrap pb-[72px]">
              <div className="mb-11 grid items-end gap-6 md:grid-cols-2 md:gap-12">
                <h2 id="this-title" className={H2}>This round</h2>
                <p className="max-w-[52ch] text-bark">Every round records its strike, expiry, notional, premium, Picker and settlement price.</p>
              </div>
              <div className="grid gap-7 md:grid-cols-2">
                <Panel title={vault?.symbol ?? "Spur Vault"} sub="Spur Vault">
                  {cur ? (
                    <dl className="grid gap-x-8 gap-y-4 sm:grid-cols-2">
                      {([
                        ["Strike", usd(cur.strike)],
                        ["Expires", `${expiryFmt.format(new Date(cur.expiry))} ET`],
                        ["Notional", `${qtyFmt.format(cur.notional)} ${vault?.underlying ?? ""}`],
                        ["Premium paid", cur.premiumUsdg === null ? "Not auctioned yet" : usd(cur.premiumUsdg)],
                        ["Picker", cur.picker ? shortAddr(cur.picker) : "—"],
                        ["Status", ROUND_STATUS[cur.status] ?? cur.status],
                      ] as const).map(([k, v]) => (
                        <div key={k} className="border-b border-wire/60 pb-2"><dt className="text-[.86rem] text-bark">{k}</dt><dd className="font-mono text-[1.05rem] font-medium">{v}</dd></div>
                      ))}
                    </dl>
                  ) : <p className="text-bark">No round is open right now.</p>}
                </Panel>
                <Panel dashed title="gNVDA" sub="Graft Vault · after MVP">
                  <dl className="grid gap-x-8 gap-y-4 sm:grid-cols-2">
                    {["Strike", "Notional", "Premium paid"].map((k) => (
                      <div key={k} className="border-b border-wire/60 pb-2"><dt className="text-[.86rem] text-bark">{k}</dt><dd className="font-mono text-[1.05rem] font-medium">—<span className="sr-only"> not live yet</span></dd></div>
                    ))}
                  </dl>
                  <ButtonLink href="/vaults?kind=graft" variant="ghost" className="mt-5">Preview Grafts</ButtonLink>
                </Panel>
              </div>
            </section>

            <section aria-labelledby="past-title" className="wrap pb-[72px]">
              <div className="mb-8 grid items-end gap-6 md:grid-cols-2 md:gap-12">
                <h2 id="past-title" className={H2}>Past rounds</h2>
                <p className="max-w-[52ch] text-bark">{vault ? `All rounds for ${vault.symbol}. ` : ""}Premium is the total paid by the Picker to the vault.</p>
              </div>
              {rounds.length > 0
                ? <><RoundHistoryTable rounds={rounds} />{vault && vault.rounds.length > rounds.length && <p className="mt-3 text-sm text-bark">Showing the latest {rounds.length} of {vault.rounds.length} rounds.</p>}</>
                : <p className="text-bark">No rounds yet. The first Harvest will show up here.</p>}
            </section>
          </>
        )}
      </main>
      <Footer />
    </>
  );
}
