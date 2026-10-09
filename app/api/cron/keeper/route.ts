// Dipanggil pg_cron Supabase (lewat pg_net): satu siklus keeper untuk satu lane.
//   GET /api/cron/keeper?lane=spur|graft|cordon|cordon1|cordon2     Authorization: Bearer <CRON_SECRET>
// LIVE bila SPUR_MODE / GRAFT_MODE (round) atau KEEPER_MODE (pruning Cordon) = live.
// Hanya testnet: kunci keeper (KEEPER_PRIVATE_KEY) disimpan di env server Vercel, jadi pakai dompet khusus berisi ETH testnet.
import { NextResponse } from "next/server";
import { authorized } from "@/lib/api/cron-auth";
import { LANES, runKeeperOnce, type Lane } from "@/keeper/src/run-once.ts";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return NextResponse.json({ error: "CRON_SECRET belum diisi" }, { status: 503 });
  if (!authorized(req.headers.get("authorization"), secret)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const lane = new URL(req.url).searchParams.get("lane") ?? "";
  if (!(LANES as readonly string[]).includes(lane)) return NextResponse.json({ error: "lane harus salah satu dari: spur, graft, cordon, cordon1, cordon2" }, { status: 400 });
  const r = await runKeeperOnce(process.env, lane as Lane);
  return NextResponse.json(r, { status: r.ok ? 200 : 500 });
}
