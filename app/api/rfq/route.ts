// RFQ Picker untuk keeper cron. Menandatangani quote EIP-712 dengan kunci Picker dari env.
// Mainnet (4663): hanya bila RFQ_ALLOW_MAINNET=true + batas premi/notional eksplisit (lihat lib/api/rfq-sign.ts), dan quote
// ditolak bila saldo USDG atau allowance Picker ke HarvestAuction kurang dari premi (cek on-chain sebelum menandatangani).
//   POST /api/rfq     Authorization: Bearer <RFQ_TOKEN>
//   badan: {chainId, auction, vault, round, strikeE18, expiry, notional, minPremium} (angka sebagai string)
//   balasan: {"quotes":[{picker, premium, deadline, signature}]}  (kosong bila kebijakan menolak)
// Env: RFQ_PICKER_PRIVATE_KEY, RFQ_TOKEN, RFQ_AUCTION_ADDRESS, RFQ_PREMIUM_RAW (opsional), RFQ_MAX_PREMIUM_RAW (opsional).
// Keeper membaca RFQ_URL dan RFQ_TOKEN yang sama; isi RFQ_URL dengan https://DOMAIN/api/rfq.
import { NextResponse } from "next/server";
import { createPublicClient, http, parseAbi } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { authorized } from "@/lib/api/cron-auth";
import { decideQuote, loadRfqPolicy, parseRfqRequest, quoteTypedData } from "@/lib/api/rfq-sign";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 15;

const MAX_BODY = 4096;
const erc20 = parseAbi(["function balanceOf(address) view returns (uint256)", "function allowance(address,address) view returns (uint256)"]);
const vaultAbi = parseAbi(["function PREMIUM() view returns (address)"]);

/** Mainnet: pastikan Picker sanggup membayar premi (saldo dan allowance), supaya fill tidak gagal berulang. null = cukup. */
async function fundingShortfall(env: NodeJS.ProcessEnv, vault: `0x${string}`, auction: `0x${string}`, picker: `0x${string}`, premium: bigint): Promise<string | null> {
  const rpc = env.KEEPER_RPC_URL?.trim() || env.INDEXER_RPC_URL?.trim();
  if (!rpc) return "KEEPER_RPC_URL / INDEXER_RPC_URL belum diisi (cek saldo Picker tidak bisa jalan)";
  const pub = createPublicClient({ transport: http(rpc, { timeout: 8_000, retryCount: 1 }) });
  const token = await pub.readContract({ address: vault, abi: vaultAbi, functionName: "PREMIUM" });
  const [bal, allow] = await Promise.all([
    pub.readContract({ address: token, abi: erc20, functionName: "balanceOf", args: [picker] }),
    pub.readContract({ address: token, abi: erc20, functionName: "allowance", args: [picker, auction] }),
  ]);
  if (bal < premium) return "saldo USDG Picker kurang dari premi";
  if (allow < premium) return "allowance USDG Picker ke HarvestAuction kurang dari premi";
  return null;
}
const clean = (e: unknown) => (e instanceof Error ? e.message : String(e)).replace(/0x[0-9a-fA-F]{64}\b/g, "<hex>").replace(/https?:\/\/\S+/g, "<url>").replace(/\s+/g, " ").slice(0, 200);

export async function POST(req: Request) {
  const token = process.env.RFQ_TOKEN?.trim();
  if (!token) return NextResponse.json({ error: "RFQ_TOKEN belum diisi" }, { status: 503 });
  if (!authorized(req.headers.get("authorization"), token)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const key = process.env.RFQ_PICKER_PRIVATE_KEY?.trim() ?? "";
  if (!/^0x[0-9a-fA-F]{64}$/.test(key)) return NextResponse.json({ error: "RFQ_PICKER_PRIVATE_KEY belum valid (0x + 64 heksa)" }, { status: 503 });

  let policy;
  try { policy = loadRfqPolicy(process.env); } catch (e) { return NextResponse.json({ error: clean(e) }, { status: 503 }); }

  const text = await req.text();
  if (text.length > MAX_BODY) return NextResponse.json({ error: "badan terlalu besar" }, { status: 413 });
  let parsed;
  try { parsed = parseRfqRequest(JSON.parse(text)); } catch (e) { return NextResponse.json({ error: clean(e) }, { status: 400 }); }

  const d = decideQuote(parsed, policy, Math.floor(Date.now() / 1000));
  if (!d.ok) return NextResponse.json({ quotes: [], note: d.reason });

  try {
    const picker = privateKeyToAccount(key as `0x${string}`);
    if (policy.chainId === 4663) {
      const short = await fundingShortfall(process.env, parsed.vault, policy.auction, picker.address, d.premium);
      if (short) return NextResponse.json({ quotes: [], note: short });
    }
    const signature = await picker.signTypedData(quoteTypedData(parsed, picker.address, d.premium, d.deadline));
    return NextResponse.json({ quotes: [{ picker: picker.address, premium: d.premium.toString(), deadline: d.deadline.toString(), signature }] });
  } catch (e) {
    return NextResponse.json({ error: clean(e) }, { status: 500 });
  }
}
