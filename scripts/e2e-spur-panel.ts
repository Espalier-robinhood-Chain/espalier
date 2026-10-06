// Uji ujung-ke-ujung panel deposit/withdraw Spur terhadap kontrak ASLI di anvil: memakai helper SDK dan logika murni yang
// sama dengan komponen (components/spur-live.tsx), supaya tafsir "antrean" (setoran/penarikan yang belum diproses roll)
// terbukti sama dengan perilaku kontrak, bukan hanya dengan tiruan di tes unit.
//
// Prasyarat: `anvil --chain-id 46630` berjalan, kontrak di-deploy dengan konfigurasi mock
//   (cd contracts && DEPLOY_CONFIG=script/config/robinhood-testnet-mock.json forge script script/Deploy.s.sol --rpc-url http://127.0.0.1:8545 --broadcast --private-key <kunci anvil #0>)
// Jalankan dari root repo:
//   RPC_URL=http://127.0.0.1:8545 node --experimental-strip-types scripts/e2e-spur-panel.ts
// HANYA untuk chain lokal: memakai kunci anvil yang PUBLIK dan memajukan jam chain.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createPublicClient, createTestClient, createWalletClient, getAddress, http, parseAbi, type Address, type Hex, type PublicClient } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { decodeSpurError, readSpurAccount, readSpurInfo, spurWriteAbi } from "../packages/sdk/src/index.ts";
import { capRoom, checkDeposit, planWithdraw, queuedDeposit, queuedWithdrawShares, withdrawableShares } from "../lib/web3/spur.ts";

const RPC = process.env.RPC_URL ?? "http://127.0.0.1:8545";
const dep = JSON.parse(readFileSync(process.env.DEPLOYMENT ?? "contracts/deployments/robinhood-testnet-mock.json", "utf8")) as Record<string, string | string[] | number | boolean>;
if (Number(dep.chainId) === 4663) throw new Error("mainnet ditolak");

// Kunci publik anvil (mnemonic default): #3 keeper, #5 picker, #6 penyetor.
const KEEPER = privateKeyToAccount("0x7c852118294e51e653712a81e05800f419141751be58f605c371e15141b007a6" as Hex);
const PICKER = privateKeyToAccount("0x8b3a350cf5c34c9194ca85829a2df0ec3153be0318b5e2d3348e872092edffba" as Hex);
const GARDENER = privateKeyToAccount("0x92db14e403b83dfe3df233f83dfa3a0d7096f21ca9b0d6d6b8d88b2b4ec1564e" as Hex);

const transport = http(RPC);
const pub = createPublicClient({ transport }) as PublicClient;
const test = createTestClient({ mode: "anvil", transport });
const walletOf = (account: typeof KEEPER) => createWalletClient({ account, transport });
const vault = getAddress(dep.spurVault as string);
const auction = getAddress(dep.harvestAuction as string);
const usdg = getAddress(dep.premiumToken as string);
const settlement = getAddress(dep.settlementOracle as string);
const tokens = dep.tokens as string[];
const feeds = dep.feeds as string[];

const erc20 = parseAbi(["function mint(address to, uint256 amt)", "function approve(address, uint256) returns (bool)", "function balanceOf(address) view returns (uint256)"]);
const feedAbi = parseAbi(["function setRound(int256 answer)", "function pushRound(int256 answer, uint256 updatedAt)", "function roundId() view returns (uint80)"]);
const vaultAbi = parseAbi(["function rollRound(uint64 expiry)", "function settleRound()", "function getRound(uint64 n) view returns ((uint64 start, uint64 expiry, uint256 strikeE18, uint256 startPriceE18, uint256 notional, uint256 minPremium, address picker, uint256 premium, uint256 settlePriceE18, uint256 payout, uint256 ppsStart, uint256 accStart, uint8 outcome))"]);
const auctionAbi = parseAbi(["function fill((address vault, address picker, uint64 round, uint256 strikeE18, uint64 expiry, uint256 notional, uint256 premium, uint64 deadline) q, bytes signature)"]);
const settleAbi = parseAbi(["function settle(address token, uint64 expiry, uint80 roundId)"]);

async function mined(hash: Hex, what: string) {
  const rc = await pub.waitForTransactionReceipt({ hash });
  assert.equal(rc.status, "success", `${what} revert`);
}
async function send(w: ReturnType<typeof walletOf>, address: Address, abi: unknown, functionName: string, args: unknown[]) {
  await mined(await w.writeContract({ address, abi, functionName, args, chain: null } as never), functionName);
}
/** Meniru panel: simulasi dulu (error kontrak jadi nama), baru kirim. */
async function panelCall(fn: string, args: unknown[]) {
  await pub.simulateContract({ address: vault, abi: spurWriteAbi, functionName: fn, args, account: GARDENER } as never);
  await send(walletOf(GARDENER), vault, spurWriteAbi, fn, args);
}
async function simError(fn: string, args: unknown[]) {
  try { await pub.simulateContract({ address: vault, abi: spurWriteAbi, functionName: fn, args, account: GARDENER } as never); } catch (e) { return decodeSpurError(e).name; }
  return "NO-ERROR";
}
async function warp(ts: number) { await test.setNextBlockTimestamp({ timestamp: BigInt(ts) }); await test.mine({ blocks: 1 }); }
const sec = (iso: string) => Math.floor(Date.parse(iso) / 1000);
const step = (m: string) => console.log(`\n== ${m}`);
const E18 = 10n ** 18n;

const NVDA = getAddress(tokens[4]!), FEED = getAddress(feeds[4]!);
const read = async () => {
  const info = await readSpurInfo(pub, vault);
  return { info, st: await readSpurAccount(pub, vault, info, GARDENER.address) };
};

step("Info vault dibaca lewat SDK");
let { info, st } = await read();
assert.equal(info.asset.toLowerCase(), NVDA.toLowerCase());
assert.equal(info.assetSymbol, "NVDA");
assert.equal(info.assetDecimals, 18);
assert.equal(info.premium.toLowerCase(), usdg.toLowerCase());
assert.equal(info.premiumSymbol, "USDG");
assert.equal(info.premiumDecimals, 6);
assert.equal(info.minDeposit, 10n ** 12n);
console.log("   ", info.assetSymbol, info.assetDecimals, "dec; premium", info.premiumSymbol, info.premiumDecimals, "dec; minDeposit", info.minDeposit, "; cap", info.depositCap === (1n << 256n) - 1n ? "tanpa batas" : info.depositCap);

step("Penyetor menerima 1.000 NVDA mock; pemeriksaan sebelum deposit");
await send(walletOf(GARDENER), NVDA, erc20, "mint", [GARDENER.address, 1000n * E18]);
({ info, st } = await read());
assert.equal(st.assetBalance, 1000n * E18);
assert.deepEqual(checkDeposit(1n, info, st), { ok: false, reason: "tooSmall" });
assert.deepEqual(checkDeposit(2000n * E18, info, st), { ok: false, reason: "overBalance" });
assert.deepEqual(checkDeposit(100n * E18, info, st), { ok: true, needsApproval: true });
assert.equal(capRoom(info, st), null);
// Kontrak menarik token SEBELUM memeriksa setoran minimum, jadi tanpa allowance yang muncul adalah error token.
assert.equal(await simError("deposit", [1n]), "ERC20InsufficientAllowance", "error TOKEN harus ter-decode (spurTokenErrorsAbi)");
assert.equal(await simError("deposit", [100n * E18]), "ERC20InsufficientAllowance");
await send(walletOf(GARDENER), NVDA, erc20, "approve", [vault, 1n]);
assert.equal(await simError("deposit", [1n]), "DepositTooSmall", "error kontrak harus ter-decode jadi nama");

step("Approve sebesar jumlah, deposit 100 NVDA: masuk antrean");
await send(walletOf(GARDENER), NVDA, erc20, "approve", [vault, 100n * E18]);
({ info, st } = await read());
assert.deepEqual(checkDeposit(100n * E18, info, st), { ok: true, needsApproval: false });
await panelCall("deposit", [100n * E18]);
({ info, st } = await read());
assert.equal(st.shares, 0n);
assert.equal(queuedDeposit(st), 100n * E18, "setoran antre terbaca");
assert.equal(st.assetBalance, 900n * E18);

step("Batalkan setoran antre: semua kembali ke wallet");
await panelCall("cancelDeposit", [queuedDeposit(st)]);
({ info, st } = await read());
assert.equal(queuedDeposit(st), 0n);
assert.equal(st.assetBalance, 1000n * E18);

step("Deposit lagi 100 NVDA, lalu KEEPER memulai round 1 (Senin 2026-10-12 11:00 ET)");
await send(walletOf(GARDENER), NVDA, erc20, "approve", [vault, 100n * E18]);
await panelCall("deposit", [100n * E18]);
await warp(sec("2026-10-12T15:00:00Z"));
await send(walletOf(KEEPER), FEED, feedAbi, "setRound", [100n * 10n ** 8n]);
const expiry = BigInt(sec("2026-10-16T20:00:00Z")); // Jumat 16:00 ET
await send(walletOf(KEEPER), vault, vaultAbi, "rollRound", [expiry]);
({ info, st } = await read());
assert.equal(st.round, 1n);
assert.equal(st.active, true);
assert.equal(st.shares, 100n * E18, "setoran sudah jadi share walau storage belum disinkron");
assert.equal(st.assets, 100n * E18);
assert.equal(queuedDeposit(st), 0n, "receipt yang sudah diproses roll tidak lagi dianggap antre");
assert.equal(await simError("cancelDeposit", [1n]), "NothingToCancel", "kontrak menolak: panel tidak boleh menawarkan pembatalan");

step("Antre penarikan 40 NVDA, batalkan, lalu antre semuanya");
let plan = planWithdraw(40n * E18, st);
assert.ok(plan.ok && !plan.all && plan.shares === 40n * E18);
await panelCall("requestWithdraw", [plan.ok ? plan.shares : 0n]);
({ info, st } = await read());
assert.equal(queuedWithdrawShares(st), 40n * E18);
assert.equal(withdrawableShares(st), 60n * E18);
assert.deepEqual(planWithdraw(61n * E18, st), { ok: false, reason: "tooMuch" });
assert.equal(await simError("requestWithdraw", [61n * E18]), "InsufficientShares", "kontrak setuju: 61 memang melebihi yang bebas");
await panelCall("cancelWithdraw", [queuedWithdrawShares(st)]);
({ info, st } = await read());
assert.equal(queuedWithdrawShares(st), 0n);
plan = planWithdraw(100n * E18, st);
assert.ok(plan.ok && plan.all && plan.shares === 100n * E18);
await panelCall("requestWithdraw", [plan.ok ? plan.shares : 0n]);
({ info, st } = await read());
assert.equal(queuedWithdrawShares(st), 100n * E18);
assert.equal(withdrawableShares(st), 0n);

step("Picker membeli opsi (quote EIP-712) lewat HarvestAuction: premium 50 USDG");
const rd = await pub.readContract({ address: vault, abi: vaultAbi, functionName: "getRound", args: [1n] });
assert.equal(rd.strikeE18, 110n * E18, "strike = 100 x 1,10");
const deadline = BigInt(sec("2026-10-12T16:00:00Z"));
const quote = { vault, picker: PICKER.address, round: 1n, strikeE18: rd.strikeE18, expiry, notional: rd.notional, premium: 50_000_000n, deadline };
const signature = await PICKER.signTypedData({
  domain: { name: "EspalierHarvestAuction", version: "1", chainId: Number(dep.chainId), verifyingContract: auction },
  types: { Quote: [
    { name: "vault", type: "address" }, { name: "picker", type: "address" }, { name: "round", type: "uint64" }, { name: "strikeE18", type: "uint256" },
    { name: "expiry", type: "uint64" }, { name: "notional", type: "uint256" }, { name: "premium", type: "uint256" }, { name: "deadline", type: "uint64" },
  ] },
  primaryType: "Quote",
  message: quote,
});
await send(walletOf(PICKER), usdg, erc20, "approve", [auction, 50_000_000n]);
await send(walletOf(KEEPER), auction, auctionAbi, "fill", [quote, signature]);
({ info, st } = await read());
assert.ok(st.pendingPremium >= 49_999_999n && st.pendingPremium <= 50_000_000n, `premium ${st.pendingPremium}`);

step("Klaim premium: USDG benar-benar diterima");
const usdgBefore = await pub.readContract({ address: usdg, abi: erc20, functionName: "balanceOf", args: [GARDENER.address] });
const claimable = st.pendingPremium;
await panelCall("claimPremium", []);
const usdgAfter = await pub.readContract({ address: usdg, abi: erc20, functionName: "balanceOf", args: [GARDENER.address] });
assert.equal(usdgAfter - usdgBefore, claimable);
({ info, st } = await read());
assert.equal(st.pendingPremium, 0n);
assert.equal(await simError("claimPremium", []), "NothingToClaim");

step("Expiry: harga 105 (di bawah strike 110, tanpa payout) -> settlement -> settleRound");
await warp(Number(expiry) + 3600);
await send(walletOf(KEEPER), FEED, feedAbi, "pushRound", [105n * 10n ** 8n, expiry + 300n]);
const rid = await pub.readContract({ address: FEED, abi: feedAbi, functionName: "roundId" });
await send(walletOf(KEEPER), settlement, settleAbi, "settle", [NVDA, expiry, rid]);
await send(walletOf(KEEPER), vault, vaultAbi, "settleRound", []);
({ info, st } = await read());
assert.equal(st.active, false);
assert.equal(queuedWithdrawShares(st), 100n * E18, "masih antre sampai roll berikutnya");
assert.equal(st.claimableAssets, 0n);

step("Roll berikutnya (Senin 2026-10-19) memproses penarikan: siap diklaim, lalu diklaim");
await warp(sec("2026-10-19T15:00:00Z"));
await send(walletOf(KEEPER), FEED, feedAbi, "setRound", [100n * 10n ** 8n]);
await send(walletOf(KEEPER), vault, vaultAbi, "rollRound", [BigInt(sec("2026-10-23T20:00:00Z"))]);
({ info, st } = await read());
assert.equal(st.round, 2n);
assert.equal(st.shares, 0n);
assert.equal(queuedWithdrawShares(st), 0n, "penarikan sudah diproses: bukan antrean lagi");
assert.equal(st.claimableAssets, 100n * E18, "siap ditarik penuh (premium OTM: tidak ada payout ke Picker)");
const before = st.assetBalance;
await panelCall("claimWithdraw", []);
({ info, st } = await read());
assert.equal(st.assetBalance - before, 100n * E18);
assert.equal(st.claimableAssets, 0n);
assert.equal(st.assetBalance, 1000n * E18, "semua NVDA kembali ke wallet");

console.log("\nE2E PANEL SPUR LULUS");
