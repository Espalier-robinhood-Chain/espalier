import type { Metadata } from "next";
import { RiskCallout } from "@/components/data";
import { Footer, Header } from "@/components/layout-parts";
import { TrellisBackground } from "@/components/motif";
import { HarvestCard } from "@/components/harvest-card";
import { Tilt } from "@/components/tilt";
import { PositionList } from "@/components/product";
import { ShareActions } from "@/components/share-actions";
import { Button, ButtonAnchor, ButtonLink, EmptyState, Panel } from "@/components/ui";
import { GardenTree } from "@/components/garden-tree";
import { WallAccount } from "@/components/wall-account";
import { WallWallet } from "@/components/wall-wallet";
import { ADDRESS, ConfigError } from "@/lib/api/http";
import { getOwnPrivacy, getViewer, loadWall, type Viewer } from "@/lib/auth/server";
import type { Access } from "@/lib/auth/wallets";
import { pct, shortAddr, usd } from "@/lib/format";
import { web3Enabled } from "@/lib/web3/env";

// Posisi dan Harvest berubah tiap minggu: jangan dibekukan saat build.
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "The Wall — Espalier",
  description: "Your portfolio grown as an espalier tree: one branch per position, one fruit per Harvest. Demo preview.",
};

type Props = { searchParams: Promise<{ address?: string | string[] }> };
type Wall = Extract<Awaited<ReturnType<typeof loadWall>>, { kind: "ok" }>["wall"];
type Loaded = { kind: "ok"; wall: Wall; access: Exclude<Access, { kind: "private" }> } | { kind: "private" } | { kind: "unconfigured" } | { kind: "error" };

// Akses diperiksa di database (RLS) dan di loadWall: Wall milik orang lain hanya terbaca bila pemiliknya memilih publik.
async function load(address: string, viewer: Viewer): Promise<Loaded> {
  try {
    const r = await loadWall(address, viewer);
    return r.kind === "private" ? { kind: "private" } : { kind: "ok", wall: r.wall, access: r.access };
  } catch (e) {
    if (e instanceof ConfigError) return { kind: "unconfigured" };
    console.error(e);
    return { kind: "error" };
  }
}

// Penonton (sesi login dari cookie) dibaca sekali; panel "Sign in" membutuhkannya walau belum ada alamat yang dicari.
async function loadAll(input: string, valid: boolean) {
  let viewer: Viewer;
  try { viewer = await getViewer(); }
  catch (e) {
    const unconfigured = e instanceof ConfigError;
    if (!unconfigured) console.error(e);
    const data: Loaded | null = valid && input !== "" ? { kind: unconfigured ? "unconfigured" : "error" } : null;
    return { viewer: null, ownPrivacy: null, data };
  }
  const [data, ownPrivacy] = await Promise.all([
    valid && input !== "" ? load(input, viewer) : Promise.resolve(null),
    getOwnPrivacy(viewer).catch((e) => { console.error(e); return null; }),
  ]);
  return { viewer, ownPrivacy, data };
}

const Dev = () => process.env.NODE_ENV !== "production"
  ? <p className="font-mono text-xs text-bark">Dev: fill NEXT_PUBLIC_SUPABASE_URL and a publishable key in .env.local, then apply the migrations.</p>
  : null;

export default async function WallPage({ searchParams }: Props) {
  const { address: raw } = await searchParams;
  const input = (Array.isArray(raw) ? raw[0] : raw)?.trim() ?? "";
  const invalid = input !== "" && !ADDRESS.test(input);
  const { viewer, ownPrivacy, data } = await loadAll(input, !invalid);
  const signedInAs = viewer?.wallets[0] ?? null;
  const wall = data?.kind === "ok" ? data.wall : null;
  const access = data?.kind === "ok" ? data.access : null;
  const planted = wall && wall.positions.length > 0 ? wall : null;
  const h = planted?.lastHarvest ?? null;
  const shareText = planted && h ? `My garden harvested ${pct(h.pct)} this week. Realized, round #${h.round}${planted.isDemo ? " · demo data" : ""}. Plant stocks. Train them. Harvest weekly.` : "";

  return (
    <>
      <Header />
      <main>
        <section aria-labelledby="wall-title" className="relative overflow-hidden border-b border-wire py-14 max-md:py-9">
          <TrellisBackground className="!opacity-35 [mask-image:linear-gradient(90deg,transparent_30%,black)]" />
          <div className="wrap relative space-y-4">
            <h1 id="wall-title" className="font-display text-[clamp(2.6rem,6vw,4.6rem)] leading-none font-normal tracking-[-.03em]">The Wall</h1>
            <p className="max-w-[56ch] text-[1.08rem] text-bark">
              Your garden, grown from your positions. One branch for each, one fruit for every Harvest. Shared only when you choose.
            </p>
            {wall?.isDemo && <p><span className="rounded-full border border-wire px-3 py-1 text-sm text-bark">Demo data · not live prices</span></p>}
          </div>
        </section>

        <section aria-label="Your garden" className="wrap grid gap-6 py-10 md:grid-cols-[1fr_24rem] md:items-start">
          <div className="relative min-w-0 overflow-hidden rounded-[28px] bg-panel p-6 md:p-8">
            <TrellisBackground />
            <div className="relative space-y-5">
              <form action="/wall" method="get" className="flex flex-wrap items-end gap-2">
                <div className="w-full space-y-1 sm:max-w-md sm:grow">
                  <label htmlFor="address" className="text-sm">Wallet address</label>
                  <input id="address" name="address" defaultValue={input} placeholder="0x…" autoComplete="off" spellCheck={false}
                    aria-invalid={invalid} aria-describedby={invalid ? "address-error" : "address-help"}
                    className="min-h-11 w-full rounded-xl border border-bark/70 bg-wall px-3 font-mono text-sm placeholder:text-bark/80 focus-visible:outline-2 focus-visible:outline-leaf" />
                </div>
                <Button type="submit">Grow tree</Button>
                <WallWallet current={input} />
              </form>
              {invalid
                ? <p id="address-error" role="alert" className="text-sm text-blight"><span aria-hidden>△ </span>That does not look like a wallet address. It starts with 0x and has 42 characters.</p>
                : <p id="address-help" className="text-sm text-bark">{web3Enabled ? "Paste an address. A garden opens when its owner has made it public, or when it is yours and you are signed in below." : "Wallet connection is not set up in this preview. Paste an address."}</p>}

              {planted ? (
                <div className="space-y-4">
                  <div className="flex justify-center"><GardenTree input={planted.tree} className="w-full max-w-md" /></div>
                  <p className="text-center font-mono text-sm text-bark">
                    {planted.positions.length} {planted.positions.length === 1 ? "position" : "positions"} · {planted.harvests} {planted.harvests === 1 ? "Harvest" : "Harvests"} · {planted.streak} {planted.streak === 1 ? "week" : "weeks"} streak
                  </p>
                  {access?.kind === "owner" && (
                    <p className="text-center text-sm text-bark">
                      This is your garden. {access.isPrivate ? "It is private: only you can see it while signed in." : "It is public: anyone with the address can open it."}
                    </p>
                  )}
                  <p className="text-sm text-bark">
                    Each branch is a position, as long as its weight. Each gold fruit is a Harvest, up to 52 shown. Leaves grow with an unbroken streak. The same address always grows the same tree.
                  </p>
                  <div className="flex flex-wrap items-center gap-3">
                    <ButtonAnchor href={`/api/accounts/${planted.address}/wall.png`} download="espalier-wall.png" variant="ghost">Download tree image</ButtonAnchor>
                    <span className="text-sm text-bark">Counts only: no amounts and no address on the picture.</span>
                  </div>
                </div>
              ) : (
                <>
                  {data === null && !invalid && <EmptyState title="Open a garden" text="Paste a wallet address above to see its espalier, its positions, and its Harvests." />}
                  {data?.kind === "private" && <EmptyState title="This garden is private" text="A garden stays private until its owner chooses to share it. If this address is yours, connect that wallet and sign in below to open it." />}
                  {data?.kind === "unconfigured" && <EmptyState title="Data is not connected yet" text="This preview could not reach its data source, so this garden cannot be shown."><Dev /></EmptyState>}
                  {data?.kind === "error" && <EmptyState title="The garden is out of reach" text="We could not load this garden just now. Try again in a moment." />}
                  {wall && wall.positions.length === 0 && (
                    <EmptyState title="Nothing planted at this address yet" text={`${shortAddr(wall.address)} holds no Cordons or vault shares. Plant something and a tree will grow here.`}>
                      <div className="flex flex-wrap justify-center gap-2 pt-2">
                        <ButtonLink href="/cordons">See Cordons</ButtonLink>
                        <ButtonLink href="/vaults" variant="ghost">See Spurs & Grafts</ButtonLink>
                      </div>
                    </EmptyState>
                  )}
                </>
              )}
            </div>
          </div>

          <aside aria-labelledby="card-title" className="min-w-0 space-y-4 md:sticky md:top-20">
            <h2 id="card-title" className="font-display text-[1.6rem] font-[450] tracking-[-.01em]">Harvest Card</h2>
            <p className="text-[.92rem] text-bark">Made after each settlement. Realized numbers only. The card shows a percent and your tree, never dollar amounts.</p>
            {planted && h ? (
              <>
                <Tilt max={9} rz="-1.2deg" className="rounded-[18px]"><HarvestCard percent={h.pct} round={h.round} tree={planted.tree} isDemo={planted.isDemo} /></Tilt>
                <ShareActions text={shareText} imageHref={`/api/accounts/${planted.address}/card.png`} />
                <p className="text-sm text-bark">Pictures are drawn only when asked for. For a private garden, only its owner can ask, while signed in.</p>
              </>
            ) : (
              <p className="rounded-[18px] border border-dashed border-wire p-5 text-bark">{planted ? "Your first Harvest Card appears after your first settled round." : "Open a garden with a Harvest to see its card here."}</p>
            )}
          </aside>
        </section>

        {planted && <Body wall={planted} />}
        <section aria-label="Sign in and privacy" className="wrap pb-6">
          <Panel title="Sign in" sub="Gardens are private by default. Prove an address is yours to open it, and to choose whether others can.">
            <WallAccount key={signedInAs ?? "anon"} signedInAs={signedInAs} isPrivate={ownPrivacy} />
          </Panel>
        </section>

        <section aria-labelledby="risk-title" className="wrap pt-4 pb-12">
          <h2 id="risk-title" className="sr-only">Risks</h2>
          <RiskCallout>
            Harvests are premiums already paid, not a forecast. Past weeks do not predict future ones. Spurs cap your upside. That is the trade. Stock Tokens are tokenised debt securities: economic exposure to a stock, not legal rights to the shares. Not offered to US persons; other regions are restricted.
          </RiskCallout>
        </section>
      </main>
      <Footer />
    </>
  );
}

function Body({ wall }: { wall: NonNullable<Wall> }) {
  const items = [...wall.positions].sort((a, b) => b.valueUsd - a.valueUsd).map((p) => ({ id: p.id, label: p.id, valueUsd: p.valueUsd, weightBps: p.weightBps }));
  const atCost = wall.positions.some((p) => p.valueBasis === "cost");
  const h = wall.lastHarvest;

  return (
    <section aria-label="Positions and totals" className="wrap grid gap-6 pb-6 md:grid-cols-2">
      <Panel title="Positions" sub="Largest first. Public data for this address.">
        <PositionList items={items} />
        {atCost && <p className="mt-3 text-sm text-bark">Vault positions are shown at cost basis until vault share prices are available. Cordons are shown at NAV.</p>}
      </Panel>
      <Panel title="Garden at a glance" sub="Realized, never projected.">
        <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-2">
          <dt className="text-bark">Total value</dt><dd className="font-mono">{usd(wall.totalValueUsd)}</dd>
          <dt className="text-bark">Harvests received</dt><dd className="font-mono">{wall.harvests}</dd>
          <dt className="text-bark">Harvest streak</dt><dd className="font-mono">{wall.streak} {wall.streak === 1 ? "week" : "weeks"}</dd>
          {h && <><dt className="text-bark">Latest Harvest</dt><dd className="font-mono"><span aria-hidden className="text-fruit">●</span> {pct(h.pct)} · round #{h.round}</dd></>}
        </dl>
        <p className="mt-3 text-sm text-bark">
          {h ? "Latest Harvest is the premium paid out in the most recent week, as a share of total value." : "No Harvest yet. The first one will show up here."}
        </p>
      </Panel>
    </section>
  );
}
