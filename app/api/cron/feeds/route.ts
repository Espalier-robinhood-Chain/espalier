// Menyegarkan feed mock testnet (setRound) agar harga tidak basi. Hanya testnet: menolak chain 4663.
// Memerlukan dompet khusus (FEED_BOT_PRIVATE_KEY) yang hanya berisi ETH testnet; setRound pada feed mock terbuka untuk siapa saja.
// Harga per feed: FEED_ADDRESSES="alamat=dolar,alamat=dolar,..."
//   GET /api/cron/feeds     Authorization: Bearer <CRON_SECRET>
import { NextResponse } from "next/server";
import { createPublicClient, createWalletClient, defineChain, formatEther, http, parseAbi } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { authorized } from "@/lib/api/cron-auth";
import { loadFeedConfig } from "@/lib/api/feed-config";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const abi = parseAbi(["function setRound(int256 answer)"]);
const LOW_BALANCE_WEI = 1_000_000_000_000_000n; // 0,001 ETH: kira-kira setengah hari untuk 13 feed tiap 10 menit

export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return NextResponse.json({ error: "CRON_SECRET belum diisi" }, { status: 503 });
  if (!authorized(req.headers.get("authorization"), secret)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const t0 = Date.now();
  try {
    const cfg = loadFeedConfig(process.env);
    const chain = defineChain({ id: cfg.chainId, name: "Robinhood Chain Testnet", nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 }, rpcUrls: { default: { http: [cfg.rpcUrl] } } });
    const account = privateKeyToAccount(cfg.privateKey);
    const transport = http(cfg.rpcUrl, { timeout: 15_000, retryCount: 1 });
    const pub = createPublicClient({ chain, transport });
    const wallet = createWalletClient({ account, chain, transport });
    const balance = await pub.getBalance({ address: account.address });
    const base = await pub.getTransactionCount({ address: account.address, blockTag: "pending" });
    const hashes: `0x${string}`[] = [];
    // nonce eksplisit berurutan: transaksi dikirim tanpa menunggu satu per satu dimasukkan ke blok
    for (let i = 0; i < cfg.feeds.length; i++) {
      hashes.push(await wallet.writeContract({ address: cfg.feeds[i].address, abi, functionName: "setRound", args: [cfg.feeds[i].price], nonce: base + i }));
    }
    const last = await pub.waitForTransactionReceipt({ hash: hashes[hashes.length - 1], timeout: 20_000 });
    return NextResponse.json({
      ok: last.status === "success", feeds: cfg.feeds.length, lastBlock: last.blockNumber.toString(),
      balanceEth: formatEther(balance), lowBalance: balance < LOW_BALANCE_WEI, ms: Date.now() - t0,
    }, { status: last.status === "success" ? 200 : 500 });
  } catch (e) {
    const msg = (e instanceof Error ? e.message : String(e)).replace(/https?:\/\/\S+/g, "<url>").replace(/\s+/g, " ").slice(0, 300);
    return NextResponse.json({ ok: false, error: msg, ms: Date.now() - t0 }, { status: 500 });
  }
}
