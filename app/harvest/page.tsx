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
import { graftLive, spurLive, web3Env } from "@/lib/web3/env";

// Round berubah tiap minggu: jangan dibekukan saat build.
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Harvest — Espalier",
  description: "The weekly round: when it opens, when it expires, and how it settles.",
};

type Vault = NonNullable<Awaited<ReturnType<typeof getVault>>>;
type Loaded = { kind: "ok"; spur: Vault | null; graft: Vault | null } | { kind: "unconfigured" } | { kind: "error" };

// Halaman ini membaca satu Spur dan satu Graft Vault: yang punya round aktif, kalau tidak ada maka yang pertama.
async function load(): Promise<Loaded> {
  try {
    const all = await listVaults();
    const pick = (kind: "spur" | "graft") => { const vs = all.filter((v) => v.kind === kind); return vs.find((v) => v.currentRound) ?? vs[0]; };
    const [s, g] = [pick("spur"), pick("graft")];
    const [spur, graft] = await Promise.all([s ? getVault(s.symbol) : null, g ? getVault(g.symbol) : null]);
    return { kind: "ok", spur, graft };
  } catch (e) {
    if (e instanceof ConfigError) return { kind: "unconfigured" };
    console.error(e);
    return { kind: "error" };
  }
}

// Vault yang dikonfigurasi live (env + wallet aktif) tetapi belum ada di Supabase (indexer belum jalan): tetap tampil sebagai
// vault tanpa round, sama seperti halaman /vaults, jadi tidak jatuh ke placeholder "after MVP".
const configuredSymbol = (kind: "spur" | "graft") => {
  const t = kind === "spur" ? web3Env.spur : web3Env.graft;
  return t && (kind === "spur" ? spurLive(t.symbol) : graftLive(t.symbol)) ? t.symbol : null;
};

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

// Kartu hero satu vault: round aktifnya sendiri (nomor, status, hitung mundur). Spur dan Graft punya round masing-masing.
function HeroRoundCard({ vault, fallback, kind, hasSpur }: { vault: Vault | null; fallback: string | null; kind: "spur" | "graft"; hasSpur: boolean }) {
  const symbol = vault?.symbol ?? fallback;
  if (!symbol) return null;
  const cur = vault?.currentRound ?? null;
  const id = `round-title-${kind}`;
  return (
    <section aria-labelledby={id} className={`wrap ${kind === "spur" || !hasSpur ? "pt-11" : "pt-6"}`}>
      <div className="relative overflow-hidden rounded-[28px] bg-panel px-7 py-12 md:px-14">
        <TrellisBackground />
        <div className="relative grid items-center gap-8 md:grid-cols-[1fr_auto]">
          <div className="max-w-[56ch] space-y-4">
            <p className="m-0 font-mono text-[.82rem] text-bark">{symbol} · {kind === "spur" ? "Spur" : "Graft"}</p>
            <h2 id={id} className={H2}>{cur ? `Round #${cur.no}` : "No round is open"}</h2>
            <p className="text-bark">
              {!cur && "The next round opens soon. Past rounds are listed below."}
              {cur?.status === "auctioned" && "Premium is already paid. The round is waiting for expiry."}
              {cur?.status === "open" && "The round is open. A Picker has not paid the premium yet."}
            </p>
            <div className="flex flex-wrap gap-3">
              <ButtonLink href={`/vaults/${symbol}`} variant="ghost">Open {symbol}</ButtonLink>
            </div>
          </div>
          {cur && <div className="md:min-w-[320px]"><RoundCountdown expiry={cur.expiry} label="Time to expiry" /></div>}
        </div>
      </div>
    </section>
  );
}

function VaultRoundPanel({ vault, fallback, kind }: { vault: Vault | null; fallback: string | null; kind: "spur" | "graft" }) {
  const label = kind === "spur" ? "Spur Vault" : "Graft Vault";
  const symbol = vault?.symbol ?? fallback;
  const cur = vault?.currentRound ?? null;
  if (!symbol) {
    // Belum ada di data dan belum dikonfigurasi: placeholder tanpa angka.
    return (
      <Panel dashed title={kind === "spur" ? "Spur Vault" : "gNVDA"} sub={`${label} · not connected yet`}>
        <p className="text-bark">This vault is not connected to the site yet.</p>
        <ButtonLink href={`/vaults?kind=${kind}`} variant="ghost" className="mt-5">See {kind === "spur" ? "Spurs" : "Grafts"}</ButtonLink>
      </Panel>
    );
  }
  return (
    <Panel title={symbol} sub={label}>
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
      <ButtonLink href={`/vaults/${symbol}`} variant="ghost" className="mt-5">Open {symbol}</ButtonLink>
    </Panel>
  );
}

export default async function HarvestPage() {
  const data = await load();
  const spur = data.kind === "ok" ? data.spur : null;
  const graft = data.kind === "ok" ? data.graft : null;
  const history = [spur, graft].flatMap((v) => (v && v.rounds.length > 0 ? [v] : []));
  const anyDemo = !!(spur?.isDemo || graft?.isDemo);

  return (
    <>
      <Header />
      <main>
        <section aria-labelledby="harvest-title" className="relative overflow-hidden border-b border-wire py-14 max-md:py-9">
          <TrellisBackground className="!opacity-35 [mask-image:linear-gradient(90deg,transparent_30%,black)]" />
          <div className="wrap relative space-y-4">
            <h1 id="harvest-title" className="font-display text-[clamp(2.6rem,6vw,4.6rem)] leading-none font-normal tracking-[-.03em]">Harvest</h1>
            <p className="max-w-[56ch] text-[1.08rem] text-bark">The garden bears fruit every week. One round, one expiry, one settlement price.</p>
            {anyDemo && <p><span className="rounded-full border border-wire px-3 py-1 text-sm text-bark">Demo data · not live prices</span></p>}
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
            <HeroRoundCard kind="spur" hasSpur vault={spur} fallback={configuredSymbol("spur")} />
            <HeroRoundCard kind="graft" hasSpur={!!(spur ?? configuredSymbol("spur"))} vault={graft} fallback={configuredSymbol("graft")} />

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
                <VaultRoundPanel kind="spur" vault={spur} fallback={configuredSymbol("spur")} />
                <VaultRoundPanel kind="graft" vault={graft} fallback={configuredSymbol("graft")} />
              </div>
            </section>

            <section aria-labelledby="past-title" className="wrap pb-[72px]">
              <div className="mb-8 grid items-end gap-6 md:grid-cols-2 md:gap-12">
                <h2 id="past-title" className={H2}>Past rounds</h2>
                <p className="max-w-[52ch] text-bark">Premium is the total paid by the Picker to the vault.</p>
              </div>
              {history.length > 0 ? (
                <div className="space-y-10">
                  {history.map((v) => {
                    const shown = v.rounds.slice(0, HISTORY_MAX);
                    return (
                      <div key={v.symbol}>
                        <h3 className="mb-3 font-display text-[1.4rem] font-[450]">{v.symbol}</h3>
                        <RoundHistoryTable rounds={shown} />
                        {v.rounds.length > shown.length && <p className="mt-3 text-sm text-bark">Showing the latest {shown.length} of {v.rounds.length} rounds.</p>}
                      </div>
                    );
                  })}
                </div>
              ) : <p className="text-bark">No rounds yet. The first Harvest will show up here.</p>}
            </section>
          </>
        )}
      </main>
      <Footer />
    </>
  );
}