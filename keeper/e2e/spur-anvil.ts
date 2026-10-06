// Uji ujung-ke-ujung di anvil: keeper Spur (live) + indexer Spur terhadap kontrak hasil deploy.
// Prasyarat: anvil --chain-id 46630 berjalan, kontrak sudah di-deploy dengan konfigurasi mock
// (DEPLOY_CONFIG=script/config/robinhood-testnet-mock.json forge script ... --broadcast), dan `npm install` di keeper/ dan indexer/.
//   RPC_URL=http://127.0.0.1:8545 DEPLOYMENT=../contracts/deployments/robinhood-testnet-mock.json node --experimental-strip-types e2e/spur-anvil.ts
// HANYA untuk chain lokal: memakai kunci anvil yang PUBLIK dan memajukan jam chain.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createPublicClient, createTestClient, createWalletClient, getAddress, http, parseAbi, type Address, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { bootstrapSpur, syncSpurOnce, type HarvestRow, type RoundRow, type SpurStore as IdxStore } from "../../indexer/src/spur-sync.ts";
import { createSpurChain } from "../../indexer/src/spur-chain.ts";
import type { PositionRow } from "../../indexer/src/sync.ts";
import { createSpurRuntime } from "../src/spur-adapters.ts";
import { runSpurOnce, type QuoteSource, type SpurOutcome, type SpurStore } from "../src/spur-run.ts";

const RPC = process.env.RPC_URL ?? "http://127.0.0.1:8545";
const dep = JSON.parse(readFileSync(new URL(process.env.DEPLOYMENT ?? "../../contracts/deployments/robinhood-testnet-mock.json", `file://${process.cwd()}/`), "utf8")) as Record<string, string & string[]>;
const CHAIN_ID = Number(dep.chainId);
if (CHAIN_ID === 4663) throw new Error("mainnet ditolak");
// Kunci publik anvil (mnemonic default): #3 keeper, #5 picker, #6 penyetor.
const KEEPER_KEY = "0x7c852118294e51e653712a81e05800f419141751be58f605c371e15141b007a6" as Hex;
const PICKER_KEY = "0x8b3a350cf5c34c9194ca85829a2df0ec3153be0318b5e2d3348e872092edffba" as Hex;
const DEPOSITOR_KEY = "0x92db14e403b83dfe3df233f83dfa3a0d7096f21ca9b0d6d6b8d88b2b4ec1564e" as Hex;

const transport = http(RPC);
const pub = createPublicClient({ transport });
const test = createTestClient({ mode: "anvil", transport });
const picker = privateKeyToAccount(PICKER_KEY), depositor = privateKeyToAccount(DEPOSITOR_KEY);
const walletOf = (account: typeof picker) => createWalletClient({ account, transport });
const vault = getAddress(dep.spurVault!), auction = getAddress(dep.harvestAuction!), usdg = getAddress(dep.premiumToken!);
const NVDA = getAddress((dep.tokens as unknown as string[])[4]!), NVDA_FEED = getAddress((dep.feeds as unknown as string[])[4]!);

const erc20 = parseAbi(["function mint(address to, uint256 amt)", "function approve(address, uint256) returns (bool)", "function balanceOf(address) view returns (uint256)"]);
const feedAbi = parseAbi(["function setRound(int256 answer)", "function pushRound(int256 answer, uint256 updatedAt)"]);
const vaultAbi = parseAbi([
  "function deposit(uint256 assets)", "function claimPremium()", "function sharesOf(address) view returns (uint256)", "function round() view returns (uint64)",
  "function getRound(uint64 n) view returns ((uint64 start, uint64 expiry, uint256 strikeE18, uint256 startPriceE18, uint256 notional, uint256 minPremium, address picker, uint256 premium, uint256 settlePriceE18, uint256 payout, uint256 ppsStart, uint256 accStart, uint8 outcome))",
]);
const settleAbi = parseAbi(["function settlement(address token, uint64 expiry) view returns ((uint256 priceE18, uint256 roundUpdatedAt, uint80 roundId, uint64 settledAt, uint8 kind, bool exists))"]);

const sec = (iso: string) => Math.floor(Date.parse(iso) / 1000);
async function write(w: ReturnType<typeof walletOf>, address: Address, abi: unknown, functionName: string, args: unknown[]) {
  const hash = await w.writeContract({ address, abi, functionName, args, chain: null } as never);
  const rc = await pub.waitForTransactionReceipt({ hash });
  assert.equal(rc.status, "success", `${functionName} revert`);
}
async function warp(ts: number) { await test.setNextBlockTimestamp({ timestamp: BigInt(ts) }); await test.mine({ blocks: 1 }); }
const feedNow = (e8: bigint) => write(walletOf(depositor), NVDA_FEED, feedAbi, "setRound", [e8]);

const logs: string[] = [];
const step = (m: string) => { logs.push(m); console.log(`\n== ${m}`); };
const show = (o: SpurOutcome) => { console.log("   ->", JSON.stringify(o, (_k, v) => (typeof v === "bigint" ? v.toString() : v))); return o; };

// Penyimpanan keeper_runs dalam memori (jalur database sungguhan sudah dites dengan tiruan di unit test).
const runs: Array<{ job: string; status: string; tx?: string }> = [];
const kstore: SpurStore = {
  startRun: async (job) => { runs.push({ job, status: "running" }); return runs.length - 1; },
  finishRun: async (id, r) => { Object.assign(runs[id]!, { status: r.status, tx: r.txHash }); },
};

// Sumber RFQ lokal: Picker menandatangani EIP-712 Quote. Hanya untuk uji ini.
const premiumToQuote = 56_000_000n; // 56 USDG ~ 1% dari nilai notional
let quoteEnabled = true;
const rfq: QuoteSource = {
  async fetch(req) {
    if (!quoteEnabled) return [];
    const deadline = BigInt((await pub.getBlock()).timestamp) + 3600n;
    const message = { vault: req.vault, picker: picker.address, round: req.round, strikeE18: req.strikeE18, expiry: req.expiry, notional: req.notional, premium: premiumToQuote, deadline };
    const signature = await picker.signTypedData({
      domain: { name: "EspalierHarvestAuction", version: "1", chainId: CHAIN_ID, verifyingContract: req.auction },
      types: { Quote: [
        { name: "vault", type: "address" }, { name: "picker", type: "address" }, { name: "round", type: "uint64" }, { name: "strikeE18", type: "uint256" },
        { name: "expiry", type: "uint64" }, { name: "notional", type: "uint256" }, { name: "premium", type: "uint256" }, { name: "deadline", type: "uint64" },
      ] },
      primaryType: "Quote", message,
    });
    return [{ picker: picker.address, premium: premiumToQuote, deadline, signature }];
  },
};

async function main() {
  const rt = await createSpurRuntime({ rpcUrl: RPC, chainId: CHAIN_ID, vault, mode: "live", privateKey: KEEPER_KEY });
  const tick = async () => show(await runSpurOnce(rt.chain, rt.executor, rfq, kstore));
  const expectKind = (o: SpurOutcome, kind: string, job?: string) => { assert.equal(o.kind, kind, JSON.stringify(o, (_k, v) => (typeof v === "bigint" ? v.toString() : v))); if (job) assert.equal((o as { job: string }).job, job); };

  step("Persiapan: waktu = Senin 12 Okt 2026 15:00Z (sesi Regular), harga NVDA $140, setoran 40 NVDA, Picker menyetujui USDG");
  await warp(sec("2026-10-12T15:00:00Z"));
  await feedNow(14_000_000_000n);
  await write(walletOf(depositor), NVDA, erc20, "mint", [depositor.address, 100n * 10n ** 18n]);
  await write(walletOf(depositor), NVDA, erc20, "approve", [vault, 2n ** 256n - 1n]);
  await write(walletOf(depositor), vault, vaultAbi, "deposit", [40n * 10n ** 18n]);
  await write(walletOf(picker), usdg, erc20, "approve", [auction, 2n ** 256n - 1n]);

  step("Siklus 1: roll");
  expectKind(await tick(), "sent", "spur:roll");
  assert.equal(await pub.readContract({ address: vault, abi: vaultAbi, functionName: "round" }), 1n);
  const r1 = await pub.readContract({ address: vault, abi: vaultAbi, functionName: "getRound", args: [1n] });
  assert.equal(r1.expiry, BigInt(sec("2026-10-16T20:00:00Z")), "expiry = Jumat 16:00 EDT");
  assert.equal(r1.strikeE18, 154n * 10n ** 18n, "strike = 140 * 1,10");

  step("Siklus 1: fill (quote ditandatangani Picker, dipilih keeper setelah simulasi)");
  expectKind(await tick(), "sent", "spur:fill");
  const r1s = await pub.readContract({ address: vault, abi: vaultAbi, functionName: "getRound", args: [1n] });
  assert.equal(r1s.picker.toLowerCase(), picker.address.toLowerCase());
  assert.equal(r1s.premium, premiumToQuote);

  step("Siklus 1: berjalan -> keeper menunggu");
  expectKind(await tick(), "waiting");

  step("Lewat expiry (Jumat 20:01Z) tetapi belum ada print: jendela print terbuka -> menunggu");
  const exp = Number(r1.expiry);
  await write(walletOf(depositor), NVDA_FEED, feedAbi, "pushRound", [14_200_000_000n, BigInt(exp - 1000)]); // round terakhir sebelum expiry
  await warp(exp + 60);
  expectKind(await tick(), "waiting");

  step("Print muncul (harga $160 > strike $154): keeper mencatat settlement lalu settleRound");
  await write(walletOf(depositor), NVDA_FEED, feedAbi, "pushRound", [16_000_000_000n, BigInt(exp + 20)]);
  expectKind(await tick(), "sent", "spur:record-settlement");
  const st = await pub.readContract({ address: NVDA_FEED && (dep.settlementOracle as Address), abi: settleAbi, functionName: "settlement", args: [NVDA, r1.expiry] });
  assert.ok(st.exists); assert.equal(st.priceE18, 160n * 10n ** 18n); assert.equal(st.kind, 0, "Print, bukan fallback");
  expectKind(await tick(), "sent", "spur:settle-round");
  const r1f = await pub.readContract({ address: vault, abi: vaultAbi, functionName: "getRound", args: [1n] });
  assert.equal(r1f.outcome, 1, "Settled"); assert.ok(r1f.payout > 0n, "ITM: payout ke Picker");

  step("Siklus 2: roll berikutnya, tanpa quote sampai jendela fill habis -> closeUnsold");
  quoteEnabled = false;
  await feedNow(15_900_000_000n);
  const o2 = await tick();
  // Jumat 16:01 ET = sesi Extended; roll boleh atau ditahan kontrak. Keduanya sah, tetapi harus jelas alasannya.
  if (o2.kind === "sent") {
    expectKind(await tick(), "waiting"); // fill: RFQ kosong
    await warp(Number((await pub.getBlock()).timestamp) + 21_601);
    expectKind(await tick(), "sent", "spur:close-unsold");
    const r2 = await pub.readContract({ address: vault, abi: vaultAbi, functionName: "getRound", args: [2n] });
    assert.equal(r2.outcome, 2, "ClosedUnsold");
  } else console.log("   (roll ditahan kontrak saat sesi Extended; alasan tercatat di atas)");

  step("Indexer terhadap chain yang sama (adapter viem sungguhan, store memori)");
  const rows = { rounds: new Map<number, RoundRow>(), harvests: new Map<string, HarvestRow>(), positions: new Map<string, string>(), snap: null as null | { cursor: bigint; state: unknown } };
  const istore: IdxStore = {
    getCursor: async () => rows.snap?.cursor ?? null, loadState: async () => JSON.parse(JSON.stringify(rows.snap!.state)),
    saveSnapshot: async (cursor, state) => { rows.snap = { cursor, state: JSON.parse(JSON.stringify(state)) }; },
    upsertVault: async () => "vault-1",
    upsertRounds: async (_i, rs) => { for (const r of rs) rows.rounds.set(r.round_no, r); },
    upsertPositions: async (ps: PositionRow[]) => { for (const p of ps) rows.positions.set(p.account, p.shares); },
    deletePositions: async (_c, a) => { for (const x of a) rows.positions.delete(x); },
    upsertHarvests: async (_i, hs) => { for (const h of hs) rows.harvests.set(`${h.account}|${h.round_no}`, h); },
  };
  const ichain = await createSpurChain(RPC, vault, CHAIN_ID);
  const boot = await bootstrapSpur(ichain, istore, null);
  const icfg = { startBlock: 0n, confirmations: 0n, logChunk: 5000n, balanceBatch: 10 };
  const res = await syncSpurOnce(ichain, istore, icfg, boot);
  console.log("   sync:", JSON.stringify(res, (_k, v) => (typeof v === "bigint" ? v.toString() : v)));
  const rr1 = rows.rounds.get(1)!;
  assert.equal(rr1.status, "settled"); assert.equal(rr1.strike, "154"); assert.equal(rr1.premium_usdg, "56"); assert.equal(rr1.settlement_price, "160");
  assert.equal(rr1.picker, picker.address.toLowerCase());
  const h = rows.harvests.get(`${depositor.address.toLowerCase()}|1`)!;
  assert.ok(h, "harvest penyetor ada"); assert.equal(h.claimed_at, null);
  assert.ok(Number(h.premium_usdg) > 55.99 && Number(h.premium_usdg) <= 56, `premium harvest ${h.premium_usdg}`);
  assert.equal(rows.positions.get(depositor.address.toLowerCase()), "40");
  assert.equal(rows.positions.get(depositor.address.toLowerCase()), (Number(await pub.readContract({ address: vault, abi: vaultAbi, functionName: "sharesOf", args: [depositor.address] })) / 1e18).toString());
  if (rows.rounds.has(2)) assert.equal(rows.rounds.get(2)!.status, "cancelled");

  step("Klaim premium oleh penyetor, lalu indexer sinkron lagi (inkremental dari snapshot)");
  const before = await pub.readContract({ address: usdg, abi: erc20, functionName: "balanceOf", args: [depositor.address] });
  await write(walletOf(depositor), vault, vaultAbi, "claimPremium", []);
  const after = await pub.readContract({ address: usdg, abi: erc20, functionName: "balanceOf", args: [depositor.address] });
  const res2 = await syncSpurOnce(ichain, istore, icfg, boot);
  console.log("   sync:", JSON.stringify(res2, (_k, v) => (typeof v === "bigint" ? v.toString() : v)));
  const h2 = rows.harvests.get(`${depositor.address.toLowerCase()}|1`)!;
  assert.ok(h2.claimed_at !== null, "claimed_at terisi");
  assert.equal(h2.premium_usdg, (Number(after - before) / 1e6).toFixed(6).replace(/\.?0+$/, ""), "jumlah harvest = USDG yang benar-benar diterima");

  console.log("\nkeeper_runs:", runs.map((r) => `${r.job}:${r.status}`).join(", "));
  console.log("\nE2E LULUS");
}
main().catch((e) => { console.error("\nE2E GAGAL:", e); process.exit(1); });
