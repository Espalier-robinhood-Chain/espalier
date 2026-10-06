import { BranchProgress } from "@/components/branch-progress";
import { CompositionBar, MarketStatusPill, RiskCallout } from "@/components/data";
import { HarvestCard } from "@/components/harvest-card";
import { Footer, Header } from "@/components/layout-parts";
import { NavChart } from "@/components/nav-chart";
import { CordonDivider } from "@/components/motif";
import { CordonCard, PositionList, RoundHistoryTable, VaultCard } from "@/components/product";
import { RoundCountdown } from "@/components/round-countdown";
import { ShareDialog } from "@/components/share-dialog";
import { DepositWithdrawPanel, MintRedeemPanel } from "@/components/trade-panels";
import { EmptyState, Panel, Skeleton } from "@/components/ui";
import { UpsideSimulator } from "@/components/upside-simulator";
import { WallTree } from "@/components/wall-tree";

const tree = { address: "0x1111111111111111111111111111111111111111", totalValueUsd: 25000, harvests: 14, streak: 5,
  positions: [{ id: "cMAG7", weightBps: 5500 }, { id: "sNVDA", weightBps: 3000 }, { id: "gNVDA", weightBps: 1500 }] };
const pts = Array.from({ length: 30 }, (_, i) => ({ ts: i * 86400000, nav: 100 + i * 0.4 + Math.sin(i / 3) * 2 }));
const rounds = [{ no: 3, strike: 135, expiry: "2026-09-25T20:00:00Z", premiumUsdg: 1.2, settlementPrice: 131, status: "settled" as const }, { no: 4, strike: 138, expiry: "2026-10-02T20:00:00Z", premiumUsdg: 1.1, status: "auctioned" as const }];

// Halaman sementara: galeri komponen dengan data demo. Dihapus setelah halaman asli jadi.
export default function Gallery() {
  return (
    <>
      <Header />
      <main className="mx-auto max-w-5xl space-y-8 p-4">
        <div className="flex flex-wrap items-center gap-4"><MarketStatusPill state="overnight" next="regular opens 09:30 ET" /><RoundCountdown expiry="2026-10-09T20:00:00Z" /><BranchProgress value={0.6} /></div>
        <CordonDivider />
        <div className="grid gap-4 sm:grid-cols-2"><CordonCard symbol="cMAG7" name="Magnificent Seven" nav={104.2} change={1.3} assets={7} isDemo /><VaultCard symbol="sNVDA" kind="spur" apy={14.2} strike={138} isDemo /></div>
        <Panel title="NAV"><NavChart points={pts} harvests={[5 * 86400000, 12 * 86400000]} /><CompositionBar items={[{ label: "AAPL", weightBps: 3000 }, { label: "MSFT", weightBps: 4000 }, { label: "NVDA", weightBps: 3000 }]} /></Panel>
        <div className="grid gap-4 md:grid-cols-2"><MintRedeemPanel symbol="cMAG7" marketOpen={false} nextOpen="Mon 02:00 CET" /><DepositWithdrawPanel symbol="sNVDA" asset="stock" /></div>
        <UpsideSimulator symbol="NVDA" spot={125} strike={138} weeklyPremiumPct={0.9} />
        <RiskCallout>Spurs cap your upside. That is the trade.</RiskCallout>
        <Panel title="History"><RoundHistoryTable rounds={rounds} /><PositionList items={[{ id: "1", label: "cMAG7", valueUsd: 13750, weightBps: 5500 }]} /></Panel>
        <div className="flex flex-wrap items-start gap-4"><WallTree input={tree} /><HarvestCard percent={0.42} round={4} tree={tree} isDemo /><ShareDialog text="My garden harvested +0.42% this week."><HarvestCard percent={0.42} round={4} tree={tree} isDemo /></ShareDialog></div>
        <div className="grid gap-4 sm:grid-cols-2"><EmptyState title="No harvests yet" text="Deposit into a Spur Vault to start your first round." /><Skeleton className="h-32" /></div>
      </main>
      <Footer />
    </>
  );
}
