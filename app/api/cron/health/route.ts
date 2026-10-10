// Pemantau: apakah indexer, keeper, dan Picker masih sehat? Pasang ke layanan uptime (BetterStack, Healthchecks, dsb.) yang bisa
// mengirim header Authorization. 200 = sehat, 503 = ada masalah (isi JSON menjelaskan). Hanya membaca; tidak mengirim transaksi.
//   GET /api/cron/health     Authorization: Bearer <CRON_SECRET>
// Yang diperiksa: (1) indexer: kursor tiap aliran diperbarui dalam HEALTH_MAX_STALE_SEC (bawaan 600); (2) keeper_runs: ada yang
// gagal dalam 24 jam terakhir; (3) saldo ETH keeper dan Picker >= HEALTH_MIN_ETH_WEI (bawaan 0,003 ETH); (4) saldo USDG Picker
// >= HEALTH_MIN_PICKER_USDG_RAW (bawaan 4x premi RFQ_PREMIUM_RAW).
import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { createPublicClient, formatEther, http, parseAbi } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { authorized } from "@/lib/api/cron-auth";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

const erc20 = parseAbi(["function balanceOf(address) view returns (uint256)"]);
const vaultAbi = parseAbi(["function PREMIUM() view returns (address)"]);
const clean = (e: unknown) => (e instanceof Error ? e.message : String(e)).replace(/https?:\/\/\S+/g, "<url>").replace(/0x[0-9a-fA-F]{64}\b/g, "<hex>").replace(/\s+/g, " ").slice(0, 200);
const big = (v: string | undefined, d: bigint) => (v?.trim() && /^\d+$/.test(v.trim()) ? BigInt(v.trim()) : d);

export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return NextResponse.json({ error: "CRON_SECRET belum diisi" }, { status: 503 });
  if (!authorized(req.headers.get("authorization"), secret)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const e = process.env;
  const problems: string[] = [];
  const info: Record<string, unknown> = {};
  try {
    const url = e.SUPABASE_URL?.trim(), sk = e.SUPABASE_SERVICE_ROLE_KEY?.trim();
    const chainId = Number(e.KEEPER_CHAIN_ID?.trim() || e.INDEXER_CHAIN_ID?.trim() || 46630);
    if (!url || !sk) return NextResponse.json({ ok: false, problems: ["SUPABASE_URL / SERVICE_ROLE_KEY belum diisi"] }, { status: 503 });
    const db = createClient(url, sk, { auth: { persistSession: false, autoRefreshToken: false } });
    const staleSec = Number(e.HEALTH_MAX_STALE_SEC?.trim() || 600);
    const now = Date.now();

    // 1. indexer: kursor Cordon (indexer_state) dan Spur/Graft (indexer_snapshots) harus baru
    const [st, sn] = await Promise.all([
      db.from("indexer_state").select("key,updated_at").like("key", `%:${chainId}:%`),
      db.from("indexer_snapshots").select("key,updated_at").like("key", `%:${chainId}:%`),
    ]);
    if (st.error) problems.push(`baca indexer_state: ${st.error.message}`);
    if (sn.error) problems.push(`baca indexer_snapshots: ${sn.error.message}`);
    const streams = [...(st.data ?? []), ...(sn.data ?? [])] as { key: string; updated_at: string }[];
    if (!streams.length) problems.push(`indexer: belum ada kursor untuk chain ${chainId}`);
    for (const s of streams) {
      const age = Math.round((now - new Date(s.updated_at).getTime()) / 1000);
      if (age > staleSec) problems.push(`indexer ${s.key.slice(0, 18)}…: kursor terakhir ${age} dtk lalu (batas ${staleSec})`);
    }
    info.indexerStreams = streams.length;

    // 2. keeper_runs: transaksi gagal 24 jam terakhir
    const since = new Date(now - 24 * 3600_000).toISOString();
    const failed = await db.from("keeper_runs").select("job,started_at,error").eq("status", "failed").gte("started_at", since).order("started_at", { ascending: false }).limit(5);
    if (failed.error) problems.push(`baca keeper_runs: ${failed.error.message}`);
    else if (failed.data?.length) problems.push(`keeper: ${failed.data.length}+ transaksi gagal dalam 24 jam (terakhir: ${failed.data[0].job} ${failed.data[0].started_at})`);

    // 3 & 4. saldo on-chain
    const rpc = e.KEEPER_RPC_URL?.trim() || e.INDEXER_RPC_URL?.trim();
    if (rpc) {
      const pub = createPublicClient({ transport: http(rpc, { timeout: 8_000, retryCount: 1 }) });
      const minEth = big(e.HEALTH_MIN_ETH_WEI, 3_000_000_000_000_000n);
      const addrs: [string, `0x${string}`][] = [];
      const kk = e.KEEPER_PRIVATE_KEY?.trim();
      if (kk && /^0x[0-9a-fA-F]{64}$/.test(kk)) addrs.push(["keeper", privateKeyToAccount(kk as `0x${string}`).address]);
      else if (e.KEEPER_ADDRESS?.trim()) addrs.push(["keeper", e.KEEPER_ADDRESS.trim() as `0x${string}`]);
      const pk = e.RFQ_PICKER_PRIVATE_KEY?.trim();
      const picker = pk && /^0x[0-9a-fA-F]{64}$/.test(pk) ? privateKeyToAccount(pk as `0x${string}`).address : null;
      if (picker) addrs.push(["picker", picker]);
      for (const [name, a] of addrs) {
        const bal = await pub.getBalance({ address: a });
        info[`${name}EthBalance`] = formatEther(bal);
        if (bal < minEth) problems.push(`saldo ETH ${name} rendah: ${formatEther(bal)} (min ${formatEther(minEth)})`);
      }
      const vault = (e.SPUR_VAULT_ADDRESS?.trim() || e.GRAFT_VAULT_ADDRESS?.trim()) as `0x${string}` | undefined;
      if (picker && vault) {
        const token = await pub.readContract({ address: vault, abi: vaultAbi, functionName: "PREMIUM" });
        const usdg = await pub.readContract({ address: token, abi: erc20, functionName: "balanceOf", args: [picker] });
        const minUsdg = big(e.HEALTH_MIN_PICKER_USDG_RAW, big(e.RFQ_PREMIUM_RAW, 5_000_000n) * 4n);
        info.pickerUsdgRaw = usdg.toString();
        if (usdg < minUsdg) problems.push(`saldo USDG Picker rendah: ${usdg} (min ${minUsdg}, satuan mentah)`);
      }
    }
  } catch (err) { problems.push(`galat pemeriksaan: ${clean(err)}`); }
  return NextResponse.json({ ok: problems.length === 0, problems, ...info }, { status: problems.length === 0 ? 200 : 503 });
}
