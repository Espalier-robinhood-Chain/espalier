import { ok } from "@/lib/api/http";
import { marketState, nextChange } from "@/lib/api/market";

export const dynamic = "force-dynamic";

export function GET() {
  const now = new Date();
  return ok({ state: marketState(now), nextChangeAt: nextChange(now), approximate: true, note: "Jam ET; libur bursa dan oracle pause belum tercakup." },
    { "Cache-Control": "public, s-maxage=60" });
}
