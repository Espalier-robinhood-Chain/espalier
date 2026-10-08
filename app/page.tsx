import type { Metadata } from 'next';
import Link from 'next/link';
import { RiskCallout } from '@/components/data';
import { Footer, Header } from '@/components/layout-parts';
import { CordonDivider, TrellisBackground } from '@/components/motif';
import { ButtonLink } from '@/components/ui';
import { UpsideSimulator } from '@/components/upside-simulator';
import { RoundCountdown } from '@/components/round-countdown';
import { HeroTree } from '@/components/hero-tree';
import { PayoffChart } from '@/components/payoff-chart';
import { WayArt } from '@/components/way-art';
import { WallTree } from '@/components/wall-tree';
import { ChainBar } from '@/components/chain-bar';
import { Reveal } from '@/components/reveal';
import { Tilt } from '@/components/tilt';
import { Timeline } from '@/components/timeline';
import { ConfigError } from '@/lib/api/http';
import type { HomeData } from '@/lib/api/home-derive';
import { getHomeData } from '@/lib/api/queries';
import { pct, usd } from '@/lib/format';
import { web3Env } from '@/lib/web3/env';

// Angka di halaman ini dibaca dari data nyata dan berubah tiap round: jangan dibekukan saat build.
export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Espalier — Plant stocks. Train them. Harvest weekly.',
  description:
    'Disciplined baskets and weekly covered-call vaults for Stock Tokens.',
};

type Loaded =
  | { kind: 'ok'; home: HomeData }
  | { kind: 'unconfigured' }
  | { kind: 'error' };
async function load(): Promise<Loaded> {
  try {
    return { kind: 'ok', home: await getHomeData() };
  } catch (e) {
    if (e instanceof ConfigError) return { kind: 'unconfigured' };
    console.error(e);
    return { kind: 'error' };
  }
}

// Pohon kosong (hanya batang) bila data belum ada. Bukan pohon contoh.
const EMPTY_GARDEN = {
  address: 'espalier',
  totalValueUsd: 0,
  harvests: 0,
  streak: 0,
  positions: [] as { id: string; weightBps: number }[],
};

const products: {
  art: 'cordon' | 'spur' | 'graft';
  name: string;
  sym: string;
  kind: string;
  href: string;
  cta: string;
  badge?: string;
  text: string;
  trade: string;
}[] = [
  {
    art: 'cordon',
    name: 'Cordon',
    sym: 'cMAG7',
    kind: 'Stock basket',
    href: '/cordons',
    cta: 'Explore Cordons',
    text: 'One token, one basket. cMAG7 holds seven large companies at equal weight, pruned on schedule.',
    trade: 'You keep the basket’s ups and its downs.',
  },
  {
    art: 'spur',
    name: 'Spur Vault',
    sym: 'sNVDA',
    kind: 'Covered-call vault',
    href: '/vaults?kind=spur',
    cta: 'Explore Spurs',
    text: 'Deposit a Stock Token. Pickers pay premium up front for the upside above a strike. You collect it each round.',
    trade: 'Spurs cap your upside. That is the trade.',
  },
  {
    art: 'graft',
    name: 'Graft Vault',
    sym: 'gNVDA',
    kind: 'Cash-secured put vault',
    href: '/vaults?kind=graft',
    cta: 'Explore Grafts',
    text: 'Deposit USDG. Get paid premium while you wait to buy a stock at a lower price.',
    trade:
      'If the price ends below the strike, the vault pays out the shortfall.',
  },
];

const paths = [
  {
    label: 'The Cordon path',
    sub: 'For holding a basket.',
    steps: [
      {
        when: 'Plant',
        title: 'Mint cMAG7',
        text: 'Pay USDG while the market is open. The vault holds the seven stocks for you.',
      },
      {
        when: 'Train',
        title: 'Hold one token',
        text: 'Its NAV follows the basket. Redeem in-kind any time.',
      },
      {
        when: 'Prune',
        title: 'Rebalanced on schedule',
        text: 'Weights drift. The keeper trims them back to equal.',
      },
    ],
  },
  {
    label: 'The vault path',
    sub: 'For a weekly harvest.',
    steps: [
      {
        when: 'Deposit',
        title: 'Join a round',
        text: 'NVDA into a Spur, or USDG into a Graft. Deposits are queued for the next round.',
      },
      {
        when: 'Sell',
        title: 'A Picker pays up front',
        text: 'The premium lands in the vault the moment the option is sold.',
      },
      {
        when: 'Harvest',
        title: 'The round settles',
        text: 'Your premium is ready to claim in USDG. Settlement rules are not final yet.',
      },
    ],
  },
];

const today: {
  kind: string;
  sym: string;
  href: string;
  cta: string;
  type: 'cordon' | 'spur' | 'graft';
  rows: [string, string][];
}[] = [
  {
    kind: 'Cordon',
    sym: 'cMAG7',
    href: '/cordons',
    cta: 'View Cordons',
    type: 'cordon',
    rows: [
      ['Holds', '7 stocks'],
      ['Weights', 'Equal'],
      ['Pays premium', 'No'],
    ],
  },
  {
    kind: 'Spur Vault',
    sym: 'sNVDA',
    href: '/vaults?kind=spur',
    cta: 'View Spurs',
    type: 'spur',
    rows: [
      ['Deposit', 'NVDA'],
      ['Sells', 'Upside above a strike'],
      ['Pays', 'Premium in USDG'],
    ],
  },
  {
    kind: 'Graft Vault',
    sym: 'gNVDA',
    href: '/vaults?kind=graft',
    cta: 'View Grafts',
    type: 'graft',
    rows: [
      ['Collateral', 'USDG'],
      ['Strike', 'Below today’s price'],
      ['Settlement', 'Cash'],
    ],
  },
];

// Baris angka hidup untuk satu kartu "at a glance". Produk yang belum ada di data tampil "Not live yet", bukan angka.
function liveRows(
  t: (typeof today)[number],
  home: HomeData | null,
): [string, string][] {
  if (!home) return [['Live figures', 'Unavailable']];
  if (t.type === 'cordon') {
    const c = home.cordons.find((x) => x.symbol === t.sym);
    return c
      ? [
          ['NAV per share', c.navPerShare === null ? '—' : usd(c.navPerShare)],
          ['Total value', c.tvlUsd === null ? '—' : usd(c.tvlUsd)],
        ]
      : [['Status', 'Not live yet']];
  }
  const v = home.vaults.find((x) => x.symbol === t.sym);
  return v
    ? [
        ['Realized APY', v.apy === null ? '—' : pct(v.apy, 1)],
        [
          'Strike this week',
          v.strike === null ? 'No round open' : usd(v.strike),
        ],
      ]
    : [['Status', 'Not live yet']];
}

const expiryFmt = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/New_York',
  weekday: 'short',
  month: 'short',
  day: 'numeric',
  hour: 'numeric',
  minute: '2-digit',
});
// Hitung mundur ke expiry round berjalan yang paling dekat (data kontrak), bukan jadwal ilustratif.
function NextRound({
  next,
  className = '',
}: {
  next: HomeData['nextRound'] | null;
  className?: string;
}) {
  if (!next)
    return (
      <p
        className={`border-t border-wire pt-5 text-[.88rem] text-bark ${className}`}
      >
        No round is open right now. The next one shows up here.
      </p>
    );
  return (
    <div className={className}>
      <RoundCountdown
        expiry={next.expiry}
        label={`Next Harvest in · ${next.symbol} round #${next.no}`}
      />
      <p className="mt-2 text-xs text-bark">
        Expires{' '}
        <time dateTime={next.expiry}>
          {expiryFmt.format(new Date(next.expiry))} ET
        </time>
      </p>
    </div>
  );
}

const H2 =
  'font-display text-[clamp(2rem,4.4vw,3.3rem)] leading-[1.02] font-normal tracking-[-.025em]';

export default async function Landing() {
  const data = await load();
  const home = data.kind === 'ok' ? data.home : null;
  const garden = home?.garden ?? EMPTY_GARDEN;
  const sim = home?.sim ?? null;
  const chip =
    data.kind === 'ok'
      ? web3Env.mode === 'testnet'
        ? 'Live data on testnet.'
        : 'Live data.'
      : data.kind === 'unconfigured'
        ? 'Data is not connected yet.'
        : 'Live data is unavailable right now.';
  return (
    <>
      <Header />
      <main>
        {/* Hero */}
        <section
          aria-labelledby="hero-title"
          className="relative overflow-hidden pt-14 pb-10 max-md:pt-7"
        >
          <TrellisBackground />
          <div className="wrap relative grid items-center gap-8 md:grid-cols-[1.05fr_.95fr]">
            <div>
              <span className="chip-live">
                <i aria-hidden />
                {chip}
              </span>
              <h1
                id="hero-title"
                className="hero-title mb-6 font-display text-[clamp(2.9rem,7.4vw,6.2rem)] leading-[.96] font-normal tracking-[-.035em]"
              >
                <span>Plant stocks.</span>
                <span>Train them.</span>
                <span>Harvest weekly.</span>
              </h1>
              <p className="mb-7 max-w-[44ch] text-[1.12rem] text-bark">
                Espalier trains Stock Tokens into disciplined baskets and weekly
                covered-call vaults. No noise. A well-kept garden.
              </p>
              <div className="flex flex-wrap gap-3">
                <ButtonLink href="/cordons">Plant your first Cordon</ButtonLink>
                <ButtonLink href="#how" variant="ghost">
                  How the garden works
                </ButtonLink>
              </div>
              <ul
                aria-label="Products"
                className="mt-6 flex flex-wrap gap-2 font-mono text-[.82rem]"
              >
                <li>
                  <Link
                    href="/cordons"
                    className="rounded-full border border-wire px-3 py-1 hover:border-bark"
                  >
                    cMAG7
                  </Link>
                </li>
                <li>
                  <Link
                    href="/cordons"
                    className="rounded-full border border-wire px-3 py-1 hover:border-bark"
                  >
                    cCHIP
                  </Link>
                </li>
                <li>
                  <Link
                    href="/cordons"
                    className="rounded-full border border-wire px-3 py-1 hover:border-bark"
                  >
                    cVOLT
                  </Link>
                </li>
                <li>
                  <Link
                    href="/vaults?kind=spur"
                    className="rounded-full border border-wire px-3 py-1 hover:border-bark"
                  >
                    sNVDA
                  </Link>
                </li>
                <li>
                  <Link
                    href="/vaults?kind=graft"
                    className="rounded-full border border-wire px-3 py-1 hover:border-bark"
                  >
                    gNVDA
                  </Link>
                </li>
              </ul>
              <NextRound
                next={home?.nextRound ?? null}
                className="mt-8 max-w-[520px]"
              />
            </div>
            <figure className="order-first flex flex-col items-center gap-2 md:order-none">
              <HeroTree
                input={garden}
                className="w-full max-w-[460px] md:max-w-[560px]"
              />
              <figcaption className="text-sm text-bark">
                {garden.positions.length > 0
                  ? 'The Espalier garden today, drawn from live data.'
                  : 'A bare wall. Branches appear as products go live.'}
              </figcaption>
            </figure>
          </div>
        </section>

        <ChainBar stats={home?.stats ?? null} feed={home?.feed ?? []} />

        {/* Manifesto */}
        <section
          aria-labelledby="manifesto-title"
          className="wrap grid gap-3 pt-20 pb-14 md:grid-cols-[200px_1fr] md:gap-10"
        >
          <div className="pt-3 text-sm text-bark">
            <svg
              viewBox="0 0 64 40"
              fill="none"
              stroke="var(--bark)"
              strokeWidth="1.2"
              strokeLinecap="round"
              aria-hidden
              className="mb-3.5 block h-auto w-16"
            >
              <path d="M32 40V4M32 14H12q-6 0-6-8M32 14h20q6 0 6-8M32 28H6q-5 0-5-7M32 28h26q5 0 5-7" />
            </svg>
            <h2 id="manifesto-title">Manifesto</h2>
          </div>
          <blockquote className="max-w-[34em] space-y-5 font-display text-[clamp(1.3rem,2.4vw,1.85rem)] leading-[1.42] font-light">
            <p>
              For centuries, gardeners along the walls of Europe learned a quiet
              secret.
              <br />A wild tree grows everywhere and bears little.
              <br />A trained tree grows with intention and bears fruit, season
              after season.
            </p>
            <p>
              They called it <em>espalier</em>.
            </p>
            <p>
              Markets are wild trees. Espalier is the wall, the wire, and the
              patience.
              <br />
              We plant the world’s great companies into disciplined baskets.
              <br />
              We prune them on schedule. We harvest yield every week.
            </p>
            <p>No noise. No gambling. Just a well kept garden.</p>
            <p className="text-[clamp(1.5rem,2.8vw,2.2rem)] font-medium tracking-[-.015em]">
              Plant stocks. Train them. Harvest weekly.
            </p>
          </blockquote>
        </section>

        <div className="wrap">
          <CordonDivider />
        </div>

        {/* Tiga cara tumbuh */}
        <section aria-labelledby="products-title" className="wrap py-[72px]">
          <div className="mb-11 grid items-end gap-6 md:grid-cols-2 md:gap-12">
            <h2 id="products-title" className={H2}>
              Three ways to grow
            </h2>
            <p className="max-w-[52ch] text-bark">
              Own a basket in one token. Sell the gains above a strike for a
              weekly premium. Or get paid to wait for a lower price. Each comes
              with its trade-off in plain words.
            </p>
          </div>
          <Reveal as="ul" className="grid gap-7 md:grid-cols-3">
            {products.map((p) => (
              <li key={p.name} className="flex">
                <Tilt max={5} className="flex w-full rounded-[22px]">
                  <Link
                    href={p.href}
                    className={`lift flex w-full flex-col rounded-[22px] p-7 ${p.badge ? 'border border-dashed border-wire' : 'bg-panel'}`}
                  >
                    <WayArt kind={p.art} />
                    <div className="flex flex-wrap items-baseline justify-between gap-2">
                      <h3 className="font-display text-[1.6rem] font-medium tracking-tight">
                        {p.name}{' '}
                        <span className="font-mono text-[.9rem] font-normal text-bark">
                          {p.sym}
                        </span>
                      </h3>
                      {p.badge && (
                        <span className="rounded-full border border-wire px-2.5 text-xs font-medium text-bark">
                          {p.badge}
                        </span>
                      )}
                    </div>
                    <p className="text-sm text-bark">{p.kind}</p>
                    <p className="mt-3">{p.text}</p>
                    <p className="mt-3 border-l-[3px] border-fruit pl-3 font-display text-[1.05rem] italic">
                      {p.trade}
                    </p>
                    <span className="mt-auto pt-5 text-sm font-semibold text-leaf">
                      {p.cta} →
                    </span>
                  </Link>
                </Tilt>
              </li>
            ))}
          </Reveal>
        </section>

        {/* Cara kerja: dua jalur */}
        <section
          id="how"
          aria-labelledby="how-title"
          className="wrap py-[72px]"
        >
          <div className="mb-11 grid items-end gap-6 md:grid-cols-2 md:gap-12">
            <h2 id="how-title" className={H2}>
              How the garden works
            </h2>
            <p className="max-w-[52ch] text-bark">
              Two paths, one wall. Cordons are pruned. Vaults are harvested.
              Holding a Cordon does not pay premium on its own.
            </p>
          </div>
          <div className="grid gap-14 md:grid-cols-2 md:gap-10">
            {paths.map((path) => (
              <div key={path.label}>
                <h3 className="font-mono text-[.82rem] text-bark">
                  {path.label}
                </h3>
                <p className="mb-6 font-display text-[1.25rem]">{path.sub}</p>
                <Timeline steps={path.steps} />
              </div>
            ))}
          </div>
        </section>

        {/* Taman sekilas: angka hidup dari data nyata */}
        <section aria-labelledby="today-title" className="wrap py-[72px]">
          <div className="mb-11 grid items-end gap-6 md:grid-cols-2 md:gap-12">
            <h2 id="today-title" className={H2}>
              The garden at a glance
            </h2>
            <p className="max-w-[52ch] text-bark">
              Three plants, side by side, with their live figures. APY is
              realized from premiums already paid, never projected.
            </p>
          </div>
          <ul className="grid gap-7 md:grid-cols-3">
            {today.map((t) => (
              <li key={t.sym} className="flex">
                <Tilt
                  max={4}
                  className="flex w-full flex-col rounded-[22px] bg-panel p-7"
                >
                  <p className="text-sm text-bark">{t.kind}</p>
                  <h3 className="font-mono text-[1.4rem] font-medium">
                    {t.sym}
                  </h3>
                  <dl className="my-4 space-y-2 text-sm">
                    {[...t.rows, ...liveRows(t, home)].map(([k, v]) => (
                      <div
                        key={k}
                        className="flex justify-between gap-4 border-b border-wire/60 pb-2"
                      >
                        <dt className="text-bark">{k}</dt>
                        <dd className="text-right font-medium">{v}</dd>
                      </div>
                    ))}
                  </dl>
                  <ButtonLink
                    href={t.href}
                    variant="ghost"
                    className="mt-auto self-start"
                  >
                    {t.cta}
                  </ButtonLink>
                </Tilt>
              </li>
            ))}
          </ul>
        </section>

        {/* Tanda tangan mingguan */}
        <section aria-labelledby="sig-title" className="wrap py-10">
          <div className="relative overflow-hidden rounded-[28px] bg-panel px-7 py-12 md:px-14">
            <TrellisBackground />
            <div className="relative grid items-center gap-8 md:grid-cols-[1fr_auto]">
              <div className="max-w-[56ch] space-y-4">
                <h2 id="sig-title" className={H2}>
                  Every week, the garden bears fruit.
                </h2>
                <p className="text-bark">
                  When a round ends, premium is settled and shared out as USDG
                  you can claim. Your Harvest Card shows the result as a
                  percentage, never a promise. How a round ends is still being
                  decided, and the docs say so plainly.
                </p>
                <ButtonLink href="/harvest" variant="ghost">
                  View current round
                </ButtonLink>
              </div>
              <NextRound
                next={home?.nextRound ?? null}
                className="md:min-w-[320px]"
              />
            </div>
          </div>
        </section>

        {/* Teaser The Wall */}
        <section
          aria-labelledby="teaser-title"
          className="wrap grid items-center gap-10 py-[72px] md:grid-cols-2"
        >
          <div className="space-y-4">
            <h2 id="teaser-title" className={H2}>
              Your garden grows with you
            </h2>
            <p className="max-w-[46ch] text-bark">
              The Wall draws your portfolio as an espalier. Each position is a
              cordon. Each harvest is a fruit. The same wallet always grows the
              same tree.
            </p>
            <dl className="flex flex-wrap gap-x-8 gap-y-3 font-mono">
              {[
                ['Positions', String(garden.positions.length)],
                ['Harvests', String(garden.harvests)],
                ['Streak', `${garden.streak} wk`],
              ].map(([k, v]) => (
                <div key={k}>
                  <dt className="font-sans text-xs text-bark">{k}</dt>
                  <dd className="text-[1.5rem] font-medium">{v}</dd>
                </div>
              ))}
            </dl>
            <p className="text-sm text-bark">
              {garden.positions.length > 0
                ? 'The Espalier garden today, drawn from live data.'
                : 'No positions yet. The garden grows as products go live.'}
            </p>
            <ButtonLink href="/wall">Build your Wall</ButtonLink>
          </div>
          <WallTree
            input={garden}
            className="mx-auto w-full max-w-[420px]"
            animate
          />
        </section>

        {/* Simulator upside */}
        <section
          aria-labelledby="trade-title"
          className="wrap grid items-start gap-8 py-[72px] md:grid-cols-2"
        >
          <div className="space-y-3">
            <h2
              id="trade-title"
              className="font-display text-[clamp(2rem,4.4vw,3.3rem)] leading-[1.02] font-normal tracking-[-.025em]"
            >
              See the trade before you make it
            </h2>
            <p className="text-bark">
              A Spur earns premium and gives up the top of a big move. Slide to
              see how a week plays out. It uses the live strike and premium of
              an open round, and it is not a forecast.
            </p>
          </div>
          {sim ? (
            <div>
              <UpsideSimulator
                symbol={sim.symbol}
                spot={sim.spot}
                strike={sim.strike}
                weeklyPremiumPct={sim.premiumPct}
                spotLabel="the round's starting price"
              />
              <p className="mt-3 text-sm text-bark">
                {sim.source === 'round' && "Uses this round's premium."}
                {sim.source === 'last' &&
                  "This round has no premium yet, so this uses the last settled round's premium."}
                {sim.source === null &&
                  'No premium is set for this round yet, so this shows the cap only.'}
              </p>
            </div>
          ) : (
            <div className="rounded-[22px] border border-dashed border-wire p-[30px] text-bark">
              The simulator uses the strike and premium of an open Spur round.
              No Spur round is open right now.
            </div>
          )}
        </section>

        {/* Risiko */}
        <section aria-labelledby="risk-title" className="wrap space-y-4 py-12">
          <h2 id="risk-title" className="sr-only">
            Know the trade
          </h2>
          <div className="mb-8 grid items-center gap-8 md:grid-cols-2">
            <div className="space-y-3">
              <p className="font-mono text-[.82rem] text-bark">
                Know the trade
              </p>
              <p className="font-display text-[clamp(1.6rem,3vw,2.3rem)] leading-tight">
                Spurs cap your upside. That is the trade.
              </p>
              <p className="text-bark">
                In a strong week, a Spur earns less than the stock. In a falling
                week, the premium softens the drop but does not stop it.
              </p>
              <ButtonLink href="/docs" variant="ghost">
                Understand the risks
              </ButtonLink>
            </div>
            <PayoffChart kind="spur" titleId="landing-payoff" />
          </div>
          <RiskCallout>
            Stock Tokens are tokenised debt securities. They give economic
            exposure to a stock, not legal rights to the shares. They are not
            offered to US persons, and other regions are restricted. Options can
            lose value. Read{' '}
            <Link href="/docs" className="underline underline-offset-4">
              Docs &amp; Risk
            </Link>{' '}
            and check{' '}
            <Link href="/restricted" className="underline underline-offset-4">
              where Espalier is restricted
            </Link>{' '}
            before you start.
          </RiskCallout>
        </section>

        {/* CTA penutup */}
        <section
          aria-labelledby="cta-title"
          className="relative overflow-hidden border-t border-wire"
        >
          <TrellisBackground className="[mask-image:linear-gradient(to_top,black_30%,transparent)]" />
          <div className="relative mx-auto max-w-3xl space-y-5 px-4 py-16 text-center">
            <h2
              id="cta-title"
              className="font-display text-3xl text-balance sm:text-4xl"
            >
              Grow with discipline.
            </h2>
            <p className="text-bark">
              Pick a Cordon. Watch it for a week. Add a Spur when you are ready.
            </p>
            <div className="flex flex-wrap justify-center gap-3">
              <ButtonLink href="/cordons">Plant your first Cordon</ButtonLink>
              <ButtonLink href="/docs" variant="ghost">
                Read the docs
              </ButtonLink>
            </div>
          </div>
        </section>
      </main>
      <Footer />
    </>
  );
}
