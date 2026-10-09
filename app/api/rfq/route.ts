// RFQ Picker untuk keeper cron (testnet saja). Menandatangani quote EIP-712 dengan kunci Picker dari env.
//   POST /api/rfq     Authorization: Bearer <RFQ_TOKEN>
//   badan: {chainId, auction, vault, round, strikeE18, expiry, notional, minPremium} (angka sebagai string)
//   balasan: {"quotes":[{picker, premium, deadline, signature}]}  (kosong bila kebijakan menolak)
// Env: RFQ_PICKER_PRIVATE_KEY, RFQ_TOKEN, RFQ_AUCTION_ADDRESS, RFQ_PREMIUM_RAW (opsional), RFQ_MAX_PREMIUM_RAW (opsional).
// Keeper membaca RFQ_URL dan RFQ_TOKEN yang sama; isi RFQ_URL dengan https://DOMAIN/api/rfq.
import { NextResponse } from "next/server";
import { privateKeyToAccount } from "viem/accounts";
import { authorized } from "@/lib/api/cron-auth";
import { decideQuote, loadRfqPolicy, parseRfqRequest, quoteTypedData } from "@/lib/api/rfq-sign";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 15;

const MAX_BODY = 4096;
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
    const signature = await picker.signTypedData(quoteTypedData(parsed, picker.address, d.premium, d.deadline));
    return NextResponse.json({ quotes: [{ picker: picker.address, premium: d.premium.toString(), deadline: d.deadline.toString(), signature }] });
  } catch (e) {
    return NextResponse.json({ error: clean(e) }, { status: 500 });
  }
}
