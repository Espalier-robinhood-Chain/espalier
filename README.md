<div align="center">

<img src="./public/logo.png" width="130" height="130" alt="Espalier Logo" />

# ESPALIER

**Tokenized-Stock Baskets & Weekly Option-Premium Vaults on Robinhood Chain**

*Plant stocks. Train them. Harvest weekly.*

[![Framework](https://img.shields.io/badge/Framework-Next.js%2016%20(App%20Router)-000000?style=flat-square&logo=nextdotjs&logoColor=white&labelColor=0D0D0A)](#-tech-stack)
[![Network](https://img.shields.io/badge/Network-Robinhood%20Chain%20·%204663%20/%2046630-1A9E4B?style=flat-square&labelColor=0D0D0A)](#-how-it-works)
[![Language](https://img.shields.io/badge/Language-TypeScript%20·%20Solidity%200.8.28-3178C6?style=flat-square&logo=typescript&logoColor=white&labelColor=0D0D0A)](#-tech-stack)
[![Database](https://img.shields.io/badge/Database-Supabase%20·%20Postgres-3ECF8E?style=flat-square&logo=supabase&logoColor=white&labelColor=0D0D0A)](#-tech-stack)
[![Contracts](https://img.shields.io/badge/Contracts-Foundry%20·%20OpenZeppelin%20v5.4-1C1C1C?style=flat-square&labelColor=0D0D0A)](#-the-contracts)
[![Wallet](https://img.shields.io/badge/Wallet-Reown%20AppKit%20·%20wagmi-3396FF?style=flat-square&labelColor=0D0D0A)](#wallet-login--the-wall-privacy)
[![Styling](https://img.shields.io/badge/Styling-Tailwind%20v4%20·%20Motion%20·%20three.js-38C172?style=flat-square&labelColor=0D0D0A)](#-tech-stack)
[![Status](https://img.shields.io/badge/Status-Demo%20Preview%20·%20Testnet%20·%20Unaudited-E0A800?style=flat-square&labelColor=0D0D0A)](#-status--known-gaps)
[![License](https://img.shields.io/badge/License-Unspecified-lightgrey?style=flat-square&labelColor=0D0D0A)](#-license--disclaimer)

</div>

---

**Espalier** is a DeFi app for **tokenized stocks** on **Robinhood Chain** (Ethereum L2, mainnet chain ID `4663`, testnet `46630`). It has two product families built on the same trusted frame ("the Trellis": price oracle, keeper bots, risk limits):

* **Cordons** are single-token baskets. One token holds several Stock Tokens (for example `cMAG7`), minted and redeemed in kind, and rebalanced monthly.
* **Spur & Graft Vaults** are weekly option-premium vaults. A **Spur** is a covered call (deposit a Stock Token, collect premium); a **Graft** is a cash-secured put (deposit USDG, collect premium while waiting to buy lower).

A web app (Next.js), an indexer, and a keeper sit around the contracts. Everything shown to users is read from the chain or from data the indexer wrote from the chain. Nothing is shown as live unless it is.

> **Preview software.** The contracts are **not audited**. Deployments so far use mock tokens and feeds on testnet `46630`. The deploy script refuses mainnet (`4663`) outright. See [Status & Known Gaps](#-status--known-gaps).

---

## 🏛️ Core Value Proposition

Holding tokenized stocks is passive by default, and the tools for earning on them are either manual or opaque:

* **The Idle-Asset Problem:** A Stock Token just sits in a wallet. Selling options against it is a weekly chore most holders never do.
* **The One-Position-Per-Stock Problem:** Diversifying across a theme (big tech, semiconductors, EVs) means buying and rebalancing many tokens by hand.
* **The Opaque-Yield Problem:** "APY" figures are usually projections. Users can't tell what was actually paid.

Espalier addresses these with a small, strict design:

* **Baskets in One Token:** A Cordon holds the components and rebalances itself back to target weights, only at live prices.
* **Weekly Premium, Mechanically Run:** A keeper rolls each round, an approved market maker pays premium up front, and the contract settles against a proven oracle price.
* **Realized Numbers Only:** Realized APY is the average premium of settled rounds, never a forecast. A Harvest Card shows what was actually realized.
* **Fail-Closed Pricing:** If a price is stale, the market is closed, the sequencer is down, or a token is paused, the action stops instead of guessing.
* **Private by Default:** Your portfolio ("The Wall") is hidden until you choose to make it public.

---

## 🌳 The Products

| Product | What It Is | You Deposit | Share Token | Weekly Mechanic |
|---|---|---|---|---|
| **Cordon** | Basket token over several Stock Tokens | The component tokens (in kind) | `cMAG7`, `cCHIP`, `cVOLT` | Monthly pruning back to target weights |
| **Spur Vault** | Covered call on one Stock Token | Stock Token (e.g. NVDA) | `sNVDA` | Strike ≈ live price × (1 + `otmBps`), default 10% OTM |
| **Graft Vault** | Cash-secured put on one Stock Token | USDG | `gNVDA` | Strike ≈ live price × (1 − `otmBps`), rounded down |

### The garden's vocabulary

| Word | Meaning |
|---|---|
| **Gardener** | You: anyone who holds a position. |
| **Picker** | An approved market maker who signs an EIP-712 quote and pays premium up front. |
| **Harvest** | The weekly round: premium is settled and shared out. |
| **Pruning** | Rebalancing a Cordon back to its target weights. |
| **Trellis** | The frame: oracle, keeper, and risk limits. |
| **The Wall** | Your portfolio, drawn as a tree (3D when WebGL is available, SVG otherwise). |

### Cordons in the repo

| Cordon | Theme | Components | Notes |
|---|---|---|---|
| `cMAG7` | Big tech | 7 tickers | Testnet composition is a placeholder, near-equal weights |
| `cCHIP` | Semiconductors | NVDA, AMD, AVGO, TSM | 25% × 4 on the mock deployment (assumed; weighting still "to be set" on the site) |
| `cVOLT` | Electric vehicles | TSLA, RIVN, LCID, NIO | Equal weight |

Per-Cordon deploy walk-throughs: `PANDUAN-cCHIP.md`, `PANDUAN-cVOLT.md`.

---

## 🔍 What Powers Every Number

Each page reads from a small set of pipelines, and presenters never invent a figure:

| Module | Source | What It Feeds |
|---|---|---|
| **1. Price Oracle** | Chainlink feeds via `OracleRouter` (18-decimal, fail-closed) | NAV, strikes, redeem values, pruning limits |
| **2. Market Sessions** | `MarketSession` (24/5 calendar in New York time, DST-aware) | Open/closed state; which price rules apply |
| **3. Settlement Price** | `SettlementOracle` (recorded once per token and expiry, provable on-chain, permissionless) | Option settlement |
| **4. Indexer** | `indexer/` reads vault events and on-chain state | `positions`, `nav_points`, `rounds`, `harvests` in Supabase |
| **5. Keeper** | `keeper/` plans and sends pruning and weekly-round steps | `prunings`, `keeper_runs`; on-chain rolls, fills, settlements |
| **6. Live Round Read** | Server-side RPC read of the running round (`LIVE_RPC_URL` optional) | `/vaults` and `/api/vaults` without waiting for the indexer |

---

## 🔑 Design & Safety Rules

> **Rule:** If a price can't be trusted, nothing that depends on it runs. Contracts revert; the UI shows "—", not a made-up number.

- **Session-aware staleness.** Each asset has three freshness windows (Regular / Extended / Overnight). Live price is rejected with `MarketClosed` when the session is closed; a held reference price is accepted for NAV and in-kind redeem only if it was fresh when the market closed.
- **Sequencer and pause checks.** Sequencer uptime (with grace period), advisory `oraclePaused()`, positive answers, and valid rounds are all checked.
- **Redeem never closes.** A paused component blocks `mint`, but `redeem` stays open, and Cordons allow redeeming one component at a time.
- **Fees are bounded in code.** Mint/redeem/management fees are in bps, paid in shares, all **0** until ADMIN sets them, with hard-coded caps of 100 / 100 / 200 bps.
- **Premium floor, deposit cap, pause, and expiry window** (1–14 days) are enforced on-chain in Spur and Graft.
- **Pausing a Spur or Graft only closes deposits.** Withdrawals and claims stay open.
- **Dry-run is the default.** Keepers write nothing to the database in dry-run, so public history never contains actions that didn't happen.
- **Integrity fences in the indexer.** If recomputed shares or claims don't match the chain, the indexer stops with a hard error and the cursor does not advance. It will not write wrong numbers to a public page.
- **Not financial advice.** Options are derivatives, rules vary by jurisdiction, and access can be restricted (`/restricted`).

### Roles

| Role | Allowed | Not Allowed |
|---|---|---|
| **ADMIN** (OpenZeppelin `TimelockController`, 48 h delay in production; multisig as proposer/executor) | Fees, fee recipient, `seed`, asset config, remove holidays, unpause, manage roles, `setPruneVenue`, `setPruneSlippageBps` | Exceed hard-coded fee caps |
| **GUARDIAN** | `OracleRouter.pauseAsset` (immediate) | Unpause, change parameters, grant roles, move funds |
| **KEEPER** | Add holidays; `rollRound`, `closeUnsold`, `prune` | Remove holidays, pause, change parameters |

---

## 🖥️ How It Works

### The weekly round (Spur; Graft mirrors it)

```
Gardener deposit/withdraw ──► queued until the next roll
                                    │
   KEEPER rollRound(expiry) ────────┤  strike set on-chain from the live oracle price
                                    ▼
   Picker signs EIP-712 quote ──► HarvestAuction.fill ──► premium (USDG) moves into the vault
                                    │
              expiry ───────────────┤
                                    ▼
   SettlementOracle.settle ──► SpurVault.settleRound  (anyone can call)
                                    │
        price ≤ strike ─► Picker gets nothing; Gardener keeps tokens + premium
        price > strike ─► Picker gets  notional × (P − K) / P  in Stock Tokens
                                    ▼
                  claimPremium / claimWithdraw / claimPickerPayout
```

**Graft payoff:** if `P < K`, the Picker receives `notional × (K − P)` in USDG, never more than the collateral. A Gardener can lose more than the premium collected. The `/docs` page spells out every risk in full.

### System overview

```
[Chainlink feeds] ─► OracleRouter ─┬─► CordonVault (mint/redeem/NAV/prune)
[MarketSession] ───────────────────┤
                                   ├─► SpurVault / GraftVault ◄─► HarvestAuction ◄─ Picker quotes (EIP-712)
[SettlementOracle] ────────────────┘                                  ▲
                                                                      │ rollRound / fill / settle / prune
                    [keeper] ─────────────────────────────────────────┘
                    [indexer] ──► Supabase (Postgres + Realtime) ──► Next.js app ◄── wallet (Reown AppKit)
```

* **Two modes.** `NEXT_MODE` empty means the **whole site runs in simulation mode**: no wallet, no transactions, everything labelled as demo. `NEXT_MODE=testnet` or `mainnet` turns on wallet connect and the live panels, but each live panel still falls back to simulation unless its own vault address, symbol, and chain match.
* **Real data only.** Landing numbers (chain bar, activity feed, hero tree, "at a glance", Spur simulator inputs) come only from non-demo products (`is_demo = false`). With no data, the page shows "—" or an empty state, never a sample number.
* **Live updates.** Supabase Realtime pushes new `nav_points` and `rounds` rows to the browser.
* **Index state is rebuildable.** On-chain is the source of truth; delete the cursor/snapshot rows and the indexer replays from the deploy block, with no archive node needed.

### The keeper, one step per cycle

State is read from the chain, never from the database:

| On-chain state | Step |
|---|---|
| No active round | `rollRound(expiry)`: next Friday 16:00 ET inside the 1–14 day contract window |
| Active, unsold, inside the fill window | Ask the RFQ service for quotes, pick the highest premium that **passes simulation**, `HarvestAuction.fill` |
| Active, unsold, fill window over | `closeUnsold` |
| Active, sold, before expiry | Wait |
| Past expiry, settlement not recorded | Find the Chainlink round, then `settle` (print) or `settleFallback` |
| Past expiry, settlement recorded | `settleRound` |

No transaction is sent unless its `eth_call` simulation passes. A failed simulation is logged as `DITAHAN` (held) and retried next cycle.

### Wallet login & The Wall privacy

- **Login:** Supabase Auth **Web3 Wallet** (Ethereum, signed message). Wallet connect itself uses **Reown AppKit**.
- **The Wall is private by default.** Migration `0004_wall_privacy.sql` replaces the public-read policies on `positions` and `harvests` with "public if the owner opted in, otherwise owner only". Preferences live in `wall_preferences`.
- **Access control is RLS plus each Route Handler**, not the proxy. `proxy.ts` (Next 16's replacement for `middleware.ts`) only refreshes the session on `/wall`, `/api/accounts/*`, and `/api/me/*`.
- **Share images** (`next/og`, Satori): `GET /api/accounts/[address]/card.png` (latest Harvest Card) and `/wall.png` (tree + counts), plus `opengraph-image` on `/`, `/cordons/[symbol]`, `/vaults/[symbol]`. No dollar amounts and no addresses appear in any image.
- **Required Supabase dashboard settings:**
  1. Authentication → Providers → **Web3 Wallet** → enable Ethereum.
  2. Authentication → URL Configuration → add `http://localhost:3000/**` and `https://<your-domain>/**`.
  3. Authentication → Rate Limits (Web3) and CAPTCHA: set before going public, since wallet accounts are free to create.
- **Verify the first login** (required): after one sign-in, run in the SQL editor:
  ```sql
  select provider, provider_id, identity_data from auth.identities where provider = 'web3';
  select public.wallet_addresses();   -- via rpc as that user; must return lowercase addresses
  ```
  `wallet_addresses()` only accepts `provider_id` shaped like `[prefix:]0x<40 hex>`. If the real shape differs it returns `{}` (closed) and the owner's Wall won't open; adjust the regex in the migration.
- **Demo seed gotcha:** after `0004`, the demo seed must insert `wall_preferences (account, is_private = false)` for each demo account (service role), or no one can open a demo Wall.

---

## 📜 The Contracts

Foundry project in `contracts/` (solc `0.8.28`, EVM `cancun`, OpenZeppelin `v5.4.0`).

| Contract | Role |
|---|---|
| `OracleRouter` | Chainlink price per Stock Token, 18 decimals, fail-closed; live vs reference price; sequencer, pause, and session-aware staleness checks |
| `MarketSession` | 24/5 session calendar in New York time; holidays set per date by admin |
| `SettlementOracle` | One settlement price per (token, expiry), `settle` (print) or `settleFallback`, permissionless |
| `CordonVault` | ERC-20 basket share; `seed`, proportional in-kind `mint` / `redeem`, `nav`, fees in shares, `prune` via an `IPruneVenue` adapter |
| `SpurVault` | Weekly covered call; queued deposits/withdrawals; premium accumulator; positions are **not** transferable ERC-20s (MVP) |
| `GraftVault` | Weekly cash-secured put; USDG is both collateral and premium; mirrors `SpurVault`'s events, rounds, and write ABI |
| `HarvestAuction` | Verifies Picker EIP-712 quotes and moves premium into the vault |

Spur and Graft use internal asset accounting, so a stray donation can't move the price per share. Price per share rounds in the vault's favour (against the withdrawer).

### Deploying to testnet

The script is ready but **has not been run against real Robinhood Chain Testnet token and feed addresses**. Everything proven so far is on local EVM (`forge test`) and anvil with chain ID `46630`.

```bash
cd contracts
forge install foundry-rs/forge-std OpenZeppelin/openzeppelin-contracts@v5.4.0
cp .env.example .env                                   # RH_RPC_TESTNET
cast wallet import espalier-testnet --interactive      # key stored encrypted; never put it in .env

# 1. Free local rehearsal with mock tokens and feeds
anvil --chain-id 46630 &
DEPLOY_CONFIG=script/config/robinhood-testnet-mock.json forge script script/Deploy.s.sol \
  --rpc-url http://127.0.0.1:8545 --private-key <anvil account #0> --broadcast
RPC_URL=http://127.0.0.1:8545 bash script/smoke.sh robinhood-testnet-mock

# 2. Dry-run on testnet (sends nothing)
forge script script/Deploy.s.sol --rpc-url robinhood_testnet --account espalier-testnet --sender "$DEPLOYER"

# 3. Broadcast (add --broadcast), then smoke-test the real RPC
bash script/smoke.sh robinhood-testnet
```

The script validates the whole config **before** the first transaction (chain ID match, mainnet always refused, non-empty addresses with code, weights summing to 10000, fees > 0 need a recipient). It is **not idempotent**: running it twice deploys a second set. The ADMIN hand-over to the owner/timelock is irreversible.

Mock feeds go stale quickly; refresh them with `refresh-all-feeds.sh` (or the per-Cordon `refresh-*-feeds.sh`), otherwise you will see `PriceUnavailable` and mint fails. The mock admin accounts use public anvil keys, so replace them on any real testnet.

---

## 🏗️ Project Layout

```
app/
  page.tsx                 landing: live stats, hero tree, Spur simulator
  cordons/ [symbol]/       basket list + detail (NAV, composition, mint/redeem)
  vaults/  [symbol]/       Spur/Graft list + detail (rounds, deposit/withdraw)
  harvest/                 realized harvests
  wall/                    your portfolio as a tree (login, private by default)
  docs/ terms/ privacy/ restricted/
  dev/                     helper pages (components, tree3d); remove before launch
  api/
    cordons/ …             cordon list, detail, NAV series
    vaults/ …              vault list, rounds
    accounts/[address]/    wall, wall.png, card.png
    me/wall-privacy/       owner-only privacy preference
    market/status/         session state
components/                UI, GardenTree (3D + SVG), trade/spur panels, wallet, charts
lib/
  web3/                    chains, env, mint/redeem + Spur logic (tested against the real ABI)
  auth/                    SIWE helpers, wallet resolution, request guards
  supabase/                server/client/public clients, session proxy, realtime
  api/                     queries, derivations, market-session math, live-round read
  tree/ tree3d-layout.ts   tree geometry (shared by 3D and SVG)
  og/                      share-image copy, fonts, palette
  docs/payoff.ts           payoff maths used by /docs and the simulator
packages/sdk/              @espalier/sdk: ABIs, quotes, error decoding (not yet an npm workspace)
contracts/                 Foundry: src/, test/ (incl. fork/), script/, deploy + refresh scripts
indexer/                   chain → Supabase (Cordon + Spur/Graft paths)
keeper/                    pruning planner/runner + weekly-round keeper
supabase/                  config.toml + migrations 0001–0007
scripts/                   fake Supabase/PostgREST, browser e2e, contrast audit
assets/og-fonts/           static .ttf for Satori
```

### Database (Supabase migrations)

| Migration | Adds |
|---|---|
| `0001_init` | `cordons`, `cordon_assets`, `nav_points`, `vaults`, `rounds`, `positions`, `harvests`, `keeper_runs` (public-read RLS) |
| `0002_rounds_spot_start` | Round start price column |
| `0003_realtime` | Adds `nav_points` and `rounds` to the `supabase_realtime` publication (without it Realtime connects but sends nothing) |
| `0004_wall_privacy` | `wallet_addresses()`, `wall_preferences`, private-by-default policies on `positions` / `harvests` |
| `0005_prunings` | `prunings` |
| `0006_indexer_state` | Indexer cursor |
| `0007_indexer_snapshots` | Atomic Spur/Graft ledger snapshot |

---

## 💻 Tech Stack

### Frontend & UI
- **Framework:** Next.js 16 (App Router, Turbopack), React 19, TypeScript.
- **Styling:** Tailwind CSS v4; Fraunces, Inter, and JetBrains Mono (self-hosted).
- **Motion & 3D:** Motion; `three` for the garden tree, loaded with `next/dynamic` only after idle and only when WebGL exists. The SVG tree is the first paint and the fallback.
- **Share images:** `next/og` (Satori) with static `.ttf` fonts.

### Web3
- **Wallet:** Reown AppKit + wagmi v2 + viem v2, TanStack Query.
- **SDK:** `@espalier/sdk` (`packages/sdk`) for ABIs, `previewMint` quotes, and decoding contract errors into names.
- **Transactions:** every write is run through `simulateContract` first; wallet rejection is not treated as an error; approvals are for the exact amount, never unlimited.

### Backend & Data
- **Database:** Supabase (Postgres 17 locally, RLS, Realtime), `@supabase/ssr` and `supabase-js`.
- **Indexer / keeper:** Node + viem, run as separate servers with the Supabase **service-role** key (never in `NEXT_PUBLIC_*`).
- **Contracts:** Solidity 0.8.28, Foundry, OpenZeppelin v5.4.0; Slither and Aderyn configs included.

---

## ⚙️ Getting Started

### Prerequisites
- **Node.js** 20+ for the web app. The indexer and keeper run with `--experimental-strip-types`, so use **Node 22.6+** for them.
- **Foundry** (`forge`, `cast`, `anvil`) for `contracts/`.
- A **Supabase** project, or the Supabase CLI (`npx supabase`, already a dev dependency) for a local one.

### Quick start (simulation mode, no wallet)

```bash
npm install
cp .env.local.example .env.local   # set NEXT_PUBLIC_SUPABASE_URL + NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
npm run dev                        # http://localhost:3000
```

Apply the migrations first (`supabase db push`, the SQL editor, or `npx supabase start` for a local stack whose keys come from `npx supabase status`). `config.toml` points at `./seed.sql`, which is not included; add your own seed (and remember the `wall_preferences` rows for demo accounts).

### Checks

```bash
npm run typecheck && npm run lint && npm test && npm run build
cd packages/sdk && npm install && npm test
cd indexer && npm install && npm test
cd keeper  && npm install && npm test
cd contracts && forge build && forge test         # FOUNDRY_PROFILE=ci for the heavy fuzz run
```

Browser and contrast checks (need `playwright` installed globally; `axe-core` optional):

```bash
node scripts/audit-contrast.mjs                   # WCAG ratios for light + dark tokens, exit 1 on failure
node scripts/fake-supabase.mjs                    # fake PostgREST + Realtime + admin endpoint
node scripts/e2e-live.mjs                         # starts the fake + next start, tests live updates in Chromium
npm run build && ENABLE_DEV_PAGES=1 npm run start
BASE_URL=http://localhost:3000 node scripts/e2e-tree3d.mjs
```

`NEXT_PUBLIC_*` values are inlined at build time. Restart `npm run dev` or rebuild after changing any of them.

### Environment (web, `.env.local`)

| Variable | Purpose |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Supabase project (the legacy anon key also works). The service-role key is **never** used in the web app. |
| `NEXT_MODE` | `mainnet` / `testnet`; **empty = simulation mode** |
| `NEXT_PUBLIC_REOWN_PROJECT_ID` | Reown dashboard project ID; empty disables the wallet button |
| `NEXT_PUBLIC_SITE_URL` | Must match your domain; also the base for OG image URLs, so set it **at build time** |
| `NEXT_PUBLIC_RH_RPC_MAINNET`, `NEXT_PUBLIC_RH_RPC_TESTNET` | Robinhood Chain RPC (domain-restricted keys only). Empty testnet RPC = testnet not offered in the wallet |
| `NEXT_PUBLIC_{CORDON,CCHIP,CVOLT}_VAULT_{ADDRESS,CHAIN_ID,SYMBOL}` | One set per Cordon; empty = that panel stays simulated |
| `NEXT_PUBLIC_SPUR_VAULT_{ADDRESS,CHAIN_ID,SYMBOL}` | One SpurVault per deployment (default symbol `sNVDA`) |
| `NEXT_PUBLIC_GRAFT_VAULT_{ADDRESS,CHAIN_ID,SYMBOL}` | One GraftVault per deployment (default symbol `gNVDA`) |
| `LIVE_RPC_URL` | Optional, server only: read the running round straight from the contract |

A live panel turns on only when `NEXT_MODE` is set, the Reown ID is set, the vault address is set, the vault chain equals the mode's chain (mainnet `4663`, testnet `46630`), and the symbol equals the one in the URL. Otherwise it stays simulated. Vault addresses are in `contracts/deployments/<name>.json` (`cordonVault`, `spurVault`, `graftVault`).

### Run the indexer and keeper

```bash
cd indexer && cp .env.example .env
node --env-file=.env --experimental-strip-types src/main.ts
```

Indexer needs `INDEXER_RPC_URL`, `INDEXER_CHAIN_ID`, `CORDON_VAULT_ADDRESS`, **`START_BLOCK`** (the vault's deploy block), `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`. Extra Cordons: `EXTRA_CORDONS=0xADDR@DEPLOY_BLOCK`. Spur/Graft: `SPUR_VAULT_ADDRESS` + `SPUR_START_BLOCK`, `GRAFT_VAULT_ADDRESS` + `GRAFT_START_BLOCK`.

```bash
cd keeper && cp .env.example .env
node --env-file=.env --experimental-strip-types src/main.ts
```

Keeper defaults to `KEEPER_MODE=dry-run` (and `SPUR_MODE`, `GRAFT_MODE`). `live` must be requested explicitly and needs `KEEPER_PRIVATE_KEY`, a hot key used for nothing else, whose account holds `KEEPER_ROLE` on the vaults and `HarvestAuction`; the keeper refuses to start without it. Details: `indexer/README.md`, `keeper/README.md`.

---

## 📌 Status & Known Gaps

**What is proven:** unit and fuzz tests for the contracts, SDK, indexer, keeper, and web logic; a full keeper + indexer cycle against `Deploy.s.sol` contracts on local anvil (`keeper/e2e/spur-anvil.ts`); the Spur panel against the same (`scripts/e2e-spur-panel.ts`).

**What is not:**

- **No audit.** An external audit is planned before real deposits, and early vaults will use deposit caps.
- **No real-feed deployment yet.** Robinhood Chain token, Chainlink feed, and Sequencer Uptime Feed addresses are not verified in this repo; don't fill them from guesses. Staleness windows and `MAX_PRINT_DELAY` are example values. `evm_version = "cancun"` still needs confirming against ArbOS.
- **No RFQ service.** Without `RFQ_URL`, a round waits for a Picker and ends via `closeUnsold`. Who signs, price limits, and nonces are product decisions.
- **`/wall` doesn't value Spur or Graft positions yet.** The indexer doesn't fill `cost_basis_usd` for them, so they show as 0.
- **Pruning needs a DEX adapter.** `CordonVault.prune` requires `setPruneVenue(<IPruneVenue adapter>)`; only a mock exists. The keeper stays in dry-run until then.
- **Contract gaps:** transferable Spur/Graft shares, split/corporate-action adjustments, a physical-settlement Graft variant, early-close sessions (13:00), and 2027 holidays.
- **Adapter code not yet run against a live backend:** `viem-chain.ts` and `supabase-store.ts` have not been exercised against a real RPC/Supabase (the logic behind them is tested).
- **3D tree** draws only the "Horizontal tiers" shape (up to 20 cordons); Fan, Candelabra, and Belgian fence exist only in SVG.
- **Open product decisions** (listed on `/docs`): expiry and settlement rule, strike rule, fee levels, first Pickers.
- Helper pages `/dev/components` and `/dev/tree3d` are for development only and should be removed.

---

## 📄 License & Disclaimer

### Disclaimer
**Not financial advice.** Espalier is preview software. Figures marked demo are not live prices. Options are derivatives; their rules differ by jurisdiction and can change, and access can be restricted. Stock Tokens are tokenized debt securities that give economic exposure to a stock, not legal ownership or voting rights, and the issuer can pause a token. Spurs cap your upside, Grafts can lose more than the premium collected, and past rounds do not predict future ones. Read `/docs` before depositing anything.

### License
No license file is currently included in this repository. Add one before distributing or open-sourcing the project.

---

<div align="center">
Built for the <b>Robinhood Chain</b> Ecosystem
</div>