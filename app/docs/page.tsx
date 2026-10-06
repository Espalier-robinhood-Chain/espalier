import type { Metadata } from "next";
import Link from "next/link";
import { RiskCallout } from "@/components/data";
import { Footer, Header } from "@/components/layout-parts";
import { CordonDivider, TrellisBackground } from "@/components/motif";
import { PayoffChart } from "@/components/payoff-chart";
import { ButtonLink } from "@/components/ui";

export const metadata: Metadata = {
  title: "Docs & Risk — Espalier",
  description: "How Espalier works, what the numbers mean, and what can go wrong. Read this before you deposit. Demo preview.",
};

// Daftar isi berkelompok (espalier.html ".docs-nav"). Id harus sama dengan id bagian di bawah.
const tocGroups = [
  { label: "Start here", items: [["short", "The short version"], ["words", "The garden’s words"], ["week", "A week in a vault"]] },
  { label: "The products", items: [["spur", "Spur Vaults"], ["graft", "Graft Vaults"], ["cordon", "Cordons"], ["numbers", "Reading the numbers"]] },
  { label: "Risk and access", items: [["risks", "Risks in full"], ["access", "Who can use Espalier"], ["open", "Still being decided"]] },
] as const;

const glossary = [
  ["Cordon", "A basket token. One token holds several stocks, such as cMAG7."],
  ["Spur", "A covered-call vault. You deposit a Stock Token and collect premium. Share token: sNVDA."],
  ["Graft", "A cash-secured put vault. You deposit USDG and collect premium while you wait to buy lower. Share token: gNVDA."],
  ["Gardener", "You: anyone who holds a position."],
  ["Picker", "A market maker who buys the option and pays premium up front."],
  ["Harvest", "The weekly round: premium is settled and shared out."],
  ["Pruning", "Rebalancing a Cordon back to its target weights."],
  ["Trellis", "The frame that holds it up: price oracle, keeper bots, and risk limits."],
  ["The Wall", "Your portfolio, drawn as a tree."],
] as const;

const week = [
  ["The round opens", "Queued deposits join the vault. The strike for the week is set."],
  ["A Picker pays", "In the first version, a small set of approved Pickers quote a price. The winning Picker pays the premium before anything else happens."],
  ["The round expires", "Exact expiry and settlement price rules are not final yet. See Still being decided."],
  ["The vault settles", "The vault compares the settlement price with the strike and pays the Picker only if the option finished in the money."],
  ["Harvest", "Premium is shared out as claimable USDG. Your Harvest Card shows what was realized, never a projection."],
] as const;

const spurRows = [
  ["The price at expiry is at or below the strike", "The Picker receives nothing. You keep your tokens and the premium."],
  ["The price at expiry is above the strike", "The vault pays the Picker the gain above the strike, in tokens: amount × (price − strike) ÷ price. You end up with fewer tokens, plus the premium."],
] as const;

const graftRows = [
  ["The price at expiry is at or above the strike", "The Picker receives nothing. You keep your USDG and the premium."],
  ["The price at expiry is below the strike", "The vault pays the Picker the shortfall in USDG: amount × (strike − price). You end up with less USDG, plus the premium."],
] as const;

const numbers = [
  ["Realized APY", "The average weekly premium of settled rounds, as a share of what backs the round, times 52. For a Spur that is the tokens’ value at the start of the round. For a Graft it is the strike value held as backing. Simple, without compounding. It looks backward only. It is not a rate and it is not promised."],
  ["Strike this week", "The price set for the round that is open now. It is per token."],
  ["NAV per share", "The value of everything a Cordon holds, divided by its shares. It uses oracle prices, so it moves when those prices move."],
  ["Token price, not stock price", "A Stock Token’s price is the stock’s price times a multiplier. Dividends are reinvested through that multiplier, so the token price drifts above the raw stock price over time. Strikes and premiums are set per token."],
  ["Demo labels", "In this preview, every figure comes from demo data and is labelled as demo. None of it is a live price."],
] as const;

const risks = [
  ["Stock Tokens are not shares", "They are tokenised debt securities. They give economic exposure to a stock, not legal rights to the shares and not a vote."],
  ["The issuer matters", "A Stock Token’s value depends on its issuer. The issuer can pause a token or block transfers. A paused token can hold up a vault, which is why a Cordon lets you redeem one component at a time."],
  ["Spurs cap your upside", "If the stock ends above the strike, you give up the gain above it. A Spur still falls with the stock. The premium cushions a drop slightly, nothing more."],
  ["Grafts pay out when the price falls", "If the price ends below the strike, the vault pays out the shortfall from your USDG. You can lose more than the premium you collected."],
  ["Prices pause when sessions close", "Stock Token prices run 24 hours a day, 5 days a week. When a session closes, the feed holds its last price and does not update. After-hours prices can be thin and can differ from the closing price. Actions that need a fresh price are switched off while prices are not live."],
  ["Oracles can be wrong or late", "The design checks every price for age and sanity, and checks that the network’s sequencer is running. Checks reduce the risk. They do not remove it."],
  ["Corporate actions can delay a round", "Splits and dividends change a token’s multiplier. During a large corporate action the price feed may be paused, and rounds may wait until it returns."],
  ["Few Pickers means thin demand", "Early rounds rely on a small set of Pickers. If none quotes a price, that week earns no premium."],
  ["Contracts can have bugs", "These contracts are not built or audited yet. An external audit is planned before real deposits, and early vaults will have deposit caps. Audits lower the chance of a bug. They do not rule it out."],
  ["Entering and leaving costs something", "A Cordon buys its tokens at market prices, so thin markets mean slippage, paid by the person minting. Vault deposits and withdrawals wait for the next round."],
  ["Rules can change", "Options are derivatives, and the rules for them differ by place and can change. Access can be restricted as a result."],
  ["Past rounds do not predict future ones", "A good week says nothing about the next."],
] as const;

const open = [
  ["Expiry and settlement price", "How a round ends when prices run around the clock, and what to do if no price arrives right after expiry."],
  ["Strike rule", "A fixed distance above the price, or a target based on volatility."],
  ["Fee levels", "Every fee will have a maximum written into the contract. The rates are not set."],
  ["The first Pickers", "Who they are and the smallest size they will quote."],
  ["How access is checked", "Which checks apply, and whether identity verification is needed for the option vaults."],
] as const;

const h2 = "font-display text-[clamp(1.8rem,3.4vw,2.6rem)] leading-[1.05] font-normal tracking-[-.02em] text-balance";
const lead = "mt-2 max-w-prose text-bark";
const th = "border-b border-wire px-3 py-2 text-left font-medium";
const td = "border-b border-wire px-3 py-3 align-top";

function Outcomes({ caption, left, rows }: { caption: string; left: string; rows: readonly (readonly [string, string])[] }) {
  return (
    <div className="mt-6 max-w-prose overflow-x-auto rounded-[18px] bg-panel p-4">
    <table className="w-full border-collapse text-sm">
      <caption className="mb-2 text-left text-bark">{caption}</caption>
      <thead><tr><th scope="col" className={th}>{left}</th><th scope="col" className={th}>What happens</th></tr></thead>
      <tbody>
        {rows.map(([a, b]) => <tr key={a}><th scope="row" className={`${td} w-2/5 text-left font-medium`}>{a}</th><td className={td}>{b}</td></tr>)}
      </tbody>
    </table>
    </div>
  );
}

export default function DocsPage() {
  return (
    <>
      <Header />
      <main>
        <section aria-labelledby="docs-title" className="relative overflow-hidden border-b border-wire py-14 max-md:py-9">
          <TrellisBackground className="!opacity-35 [mask-image:linear-gradient(90deg,transparent_30%,black)]" />
          <div className="wrap relative space-y-4">
            <h1 id="docs-title" className="font-display text-[clamp(2.6rem,6vw,4.6rem)] leading-none font-normal tracking-[-.03em]">Docs &amp; Risk</h1>
            <p className="max-w-[56ch] text-[1.08rem] text-bark">
              How Espalier works, what its numbers mean, and what can go wrong. Read the risk section before you plant.
            </p>
            <p><span className="rounded-full border border-wire px-3 py-1 text-sm text-bark">Demo preview · no real assets</span></p>
          </div>
        </section>

        <div className="wrap grid gap-12 py-12 md:grid-cols-[15rem_minmax(0,1fr)]">
          <nav aria-label="On this page" className="md:sticky md:top-20 md:self-start">
            <div className="grid gap-x-6 gap-y-5 max-md:grid-cols-2 max-sm:grid-cols-1 md:gap-y-6">
              {tocGroups.map((g) => (
                <div key={g.label}>
                  <p className="mb-1 font-mono text-[.78rem] tracking-wide text-bark uppercase">{g.label}</p>
                  <ul>
                    {g.items.map(([id, label]) => (
                      <li key={id}><a href={`#${id}`} className="inline-flex min-h-9 items-center text-[.95rem] underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-leaf">{label}</a></li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          </nav>

          <div className="min-w-0 space-y-16">
            <section id="short" aria-labelledby="short-title" className="scroll-mt-6">
              <h2 id="short-title" className={h2}>The short version</h2>
              <ul className="mt-5 max-w-prose list-disc space-y-2 rounded-[18px] bg-panel py-5 pr-6 pl-9 marker:text-bark">
                <li>Stock Tokens are tokenised debt securities. They follow a stock’s price. They are not shares.</li>
                <li>Spurs cap your upside. Grafts pay out when the price falls below the strike. You can lose money in both.</li>
                <li>Premium is payment for taking those trades. It is not a rate and it is not promised.</li>
                <li>Prices come from an oracle that can pause or go quiet when market sessions close.</li>
                <li>This is a demo preview. The contracts are not built or audited yet, so this page describes how Espalier is designed to work.</li>
              </ul>
            </section>

            <section id="words" aria-labelledby="words-title" className="scroll-mt-6">
              <h2 id="words-title" className={h2}>The garden’s words</h2>
              <p className={lead}>Espalier borrows its names from the craft of training a tree against a wall.</p>
              <dl className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {glossary.map(([t, d]) => (
                  <div key={t} className="rounded-[16px] border border-wire p-4">
                    <dt className="font-display text-lg">{t}</dt>
                    <dd className="mt-1 text-[.92rem] text-bark">{d}</dd>
                  </div>
                ))}
              </dl>
            </section>

            <CordonDivider />

            <section id="week" aria-labelledby="week-title" className="scroll-mt-6">
              <h2 id="week-title" className={h2}>A week in a vault</h2>
              <p className={lead}>Spurs and Grafts run in weekly rounds. One round is one Harvest.</p>
              <ol className="relative mt-8 max-w-prose space-y-6 border-l-[1.5px] border-bark pl-8">
                {week.map(([t, d]) => (
                  <li key={t} className="relative">
                    <span aria-hidden className="absolute top-2 -left-[38.75px] size-3 rounded-full border border-bark bg-fruit" />
                    <h3 className="font-display text-lg">{t}</h3>
                    <p className="text-bark">{d}</p>
                  </li>
                ))}
              </ol>
              <p className="mt-6 max-w-prose text-bark">Deposits and withdrawals wait for the next round. Instant withdrawal is only for assets that have not entered a round yet.</p>
            </section>

            <section id="spur" aria-labelledby="spur-title" className="scroll-mt-6">
              <h2 id="spur-title" className={h2}>Spur Vaults</h2>
              <p className={lead}>Deposit a Stock Token such as NVDA. Each round, the vault sells the upside above a strike. A Picker pays you premium for it. Spurs cap your upside. That is the trade.</p>
              <figure className="mt-6">
                <PayoffChart kind="spur" titleId="spur-chart-title" />
                <figcaption className="mt-2 max-w-prose text-sm text-bark">
                  Result per token at expiry, against the start price. Dashed: holding the stock. Solid: a Spur Vault. The dot marks the premium. Illustrative: start 100, strike 110, premium 0.9%. Not a forecast.
                </figcaption>
              </figure>
              <Outcomes caption="At expiry" left="If…" rows={spurRows} />
              <p className="mt-4 max-w-prose text-sm text-bark">Settlement is paid in Stock Tokens, so the Picker does not need to send USDG at expiry.</p>
            </section>

            <section id="graft" aria-labelledby="graft-title" className="scroll-mt-6">
              <h2 id="graft-title" className={h2}>Graft Vaults</h2>
              <p className={lead}>Deposit USDG. Each round, the vault agrees to take the loss if a stock ends below a strike. You are paid premium to wait. Graft Vaults are demo only for now.</p>
              <figure className="mt-6">
                <PayoffChart kind="graft" titleId="graft-chart-title" />
                <figcaption className="mt-2 max-w-prose text-sm text-bark">
                  Result per token at expiry, against the start price. Dashed: buying the stock at the start price. Solid: a Graft Vault. Illustrative: start 100, strike 90, premium 0.9%. Not a forecast.
                </figcaption>
              </figure>
              <Outcomes caption="At expiry" left="If…" rows={graftRows} />
              <p className="mt-4 max-w-prose text-sm text-bark">The vault holds strike × amount in USDG as backing for each round. In this version it settles in USDG and never buys the stock.</p>
            </section>

            <section id="cordon" aria-labelledby="cordon-title" className="scroll-mt-6">
              <h2 id="cordon-title" className={h2}>Cordons</h2>
              <p className={lead}>One token, one basket. cMAG7 holds AAPL, MSFT, GOOGL, AMZN, META, NVDA, and TSLA at equal weight. A Cordon has no premium: you keep the basket’s ups and its downs.</p>
              <p className="mt-5 max-w-prose overflow-x-auto rounded-[14px] bg-panel px-4 py-3 font-mono text-sm">NAV per share = Σ(balance × price) ÷ total shares</p>
              <dl className="mt-6 max-w-prose space-y-4">
                <div><dt className="font-display text-lg">Minting</dt><dd className="text-bark">Pay with USDG. The vault buys each Stock Token at market prices and issues shares for the value it actually received. Slippage falls on the person minting, not on existing holders.</dd></div>
                <div><dt className="font-display text-lg">Redeeming</dt><dd className="text-bark">In kind: you receive your share of every token, and this is always available. To USDG: only while prices are live.</dd></div>
                <div><dt className="font-display text-lg">Pruning</dt><dd className="text-bark">On a schedule, and only while prices are live, the basket trades back to its target weights. Each trade is checked against the oracle price with a slippage limit.</dd></div>
                <div><dt className="font-display text-lg">Fees</dt><dd className="text-bark">A management fee and mint and redeem fees. Rates are not set in this preview. Each fee has a maximum written into the contract.</dd></div>
              </dl>
            </section>

            <section id="numbers" aria-labelledby="numbers-title" className="scroll-mt-6">
              <h2 id="numbers-title" className={h2}>Reading the numbers</h2>
              <dl className="mt-6 max-w-prose space-y-4">
                {numbers.map(([t, d]) => (
                  <div key={t}><dt className="font-display text-lg">{t}</dt><dd className="text-bark">{d}</dd></div>
                ))}
              </dl>
            </section>

            <CordonDivider />

            <section id="risks" aria-labelledby="risks-title" className="scroll-mt-6">
              <h2 id="risks-title" className={h2}>Risks in full</h2>
              <p className={lead}>You can lose some or all of what you put in. These are the ways it can happen.</p>
              <ul className="mt-6 grid gap-4 sm:grid-cols-2">
                {risks.map(([t, d]) => (
                  <li key={t} className="rounded-[18px] bg-panel p-5">
                    <h3 className="font-display text-lg">{t}</h3>
                    <p className="mt-1 text-[.95rem] text-bark">{d}</p>
                  </li>
                ))}
              </ul>
            </section>

            <section id="access" aria-labelledby="access-title" className="scroll-mt-6">
              <h2 id="access-title" className={h2}>Who can use Espalier</h2>
              <div className="mt-2 max-w-prose space-y-3 text-bark">
                <p>Stock Tokens are not offered to US persons. Other places are restricted too, including Canada, the UK, and Switzerland. The issuer’s own terms hold the full list, and it can change.</p>
                <p>Espalier will add checks before launch. You are still responsible for knowing whether you may use it. <Link href="/restricted" className="text-ink underline underline-offset-4">See where Espalier is restricted</Link>.</p>
              </div>
            </section>

            <section id="open" aria-labelledby="open-title" className="scroll-mt-6">
              <h2 id="open-title" className={h2}>Still being decided</h2>
              <p className={lead}>These rules are not final. This page will change as they are settled.</p>
              <dl className="mt-6 grid max-w-prose gap-3">
                {open.map(([t, d]) => (
                  <div key={t} className="rounded-[16px] border border-dashed border-wire p-4"><dt className="font-display text-lg">{t}</dt><dd className="text-[.95rem] text-bark">{d}</dd></div>
                ))}
              </dl>
            </section>

            <RiskCallout>
              Stock Tokens are tokenised debt securities: economic exposure to a stock, not legal rights to the shares. Options can lose value, and a Spur gives up upside above its strike. Past rounds do not predict future ones. Not offered to US persons; other regions are restricted.
            </RiskCallout>

            <div className="flex flex-wrap gap-3">
              <ButtonLink href="/cordons">See Cordons</ButtonLink>
              <ButtonLink href="/vaults" variant="ghost">See Spurs &amp; Grafts</ButtonLink>
            </div>
          </div>
        </div>
      </main>
      <Footer />
    </>
  );
}
