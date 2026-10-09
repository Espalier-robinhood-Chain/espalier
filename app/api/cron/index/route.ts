// Dipanggil pg_cron Supabase (lewat pg_net): satu putaran indexer untuk satu aliran.
//   GET /api/cron/index?stream=cordon|cordon1|cordon2|spur|graft     Authorization: Bearer <CRON_SECRET>
// cordon = CORDON_VAULT_ADDRESS (cMAG7); cordon1, cordon2 = urutan EXTRA_CORDONS (cCHIP, cVOLT).
import { NextResponse } from "next/server";
import { authorized } from "@/lib/api/cron-auth";
import { runOnce, parseStream } from "@/indexer/src/run-once.ts";

export const dynamic = "force-dynamic";
export const maxDuration = 60; // dibatasi paket Vercel Anda; satu aliran biasanya selesai jauh lebih cepat

export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return NextResponse.json({ error: "CRON_SECRET belum diisi" }, { status: 503 });
  if (!authorized(req.headers.get("authorization"), secret)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const stream = new URL(req.url).searchParams.get("stream") ?? "";
  if (!parseStream(stream)) return NextResponse.json({ error: "stream harus cordon, cordon1, cordon2, spur, atau graft" }, { status: 400 });
  const r = await runOnce(process.env, stream);
  return NextResponse.json(r, { status: r.ok ? 200 : 500 });
}
