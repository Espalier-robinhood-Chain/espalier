// Dipanggil pg_cron Supabase (lewat pg_net): satu siklus keeper untuk satu lane.
//   GET /api/cron/keeper?lane=spur|graft|cordon|cordon1|cordon2     Authorization: Bearer <CRON_SECRET>
// LIVE bila SPUR_MODE / GRAFT_MODE (round) atau KEEPER_MODE (pruning Cordon) = live.
// Kunci keeper (KEEPER_PRIVATE_KEY) disimpan di env server Vercel. Di mainnet (4663) route ini MENOLAK jalan kecuali
// ALLOW_MAINNET_CRON_KEEPER=true diisi eksplisit; cara yang disarankan di mainnet adalah menjalankan keeper/ sebagai
// proses terpisah (VPS/KMS). Bila memakai opt-in ini: dompet keeper khusus, saldo ETH kecil, hanya KEEPER_ROLE.
import { NextResponse } from "next/server";
import { authorized } from "@/lib/api/cron-auth";
import { LANES, runKeeperOnce, type Lane } from "@/keeper/src/run-once.ts";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return NextResponse.json({ error: "CRON_SECRET belum diisi" }, { status: 503 });
  if (!authorized(req.headers.get("authorization"), secret)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const chainId = Number(process.env.KEEPER_CHAIN_ID?.trim() || process.env.INDEXER_CHAIN_ID?.trim() || 46630);
  if (chainId === 4663 && process.env.ALLOW_MAINNET_CRON_KEEPER?.trim() !== "true") {
    return NextResponse.json({ error: "keeper cron di mainnet nonaktif: jalankan keeper/ sebagai proses terpisah, atau set ALLOW_MAINNET_CRON_KEEPER=true" }, { status: 403 });
  }
  const lane = new URL(req.url).searchParams.get("lane") ?? "";
  if (!(LANES as readonly string[]).includes(lane)) return NextResponse.json({ error: "lane harus salah satu dari: spur, graft, cordon, cordon1, cordon2" }, { status: 400 });
  const r = await runKeeperOnce(process.env, lane as Lane);
  return NextResponse.json(r, { status: r.ok ? 200 : 500 });
}
