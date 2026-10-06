import { fail, guard, ok, SYMBOL } from "@/lib/api/http";
import { getNav } from "@/lib/api/queries";

export const dynamic = "force-dynamic";

export async function GET(req: Request, { params }: { params: Promise<{ symbol: string }> }) {
  const { symbol } = await params;
  if (!SYMBOL.test(symbol)) return fail(400, "invalid_symbol");
  const raw = new URL(req.url).searchParams.get("days") ?? "90";
  const days = Number(raw);
  if (!Number.isInteger(days) || days < 1 || days > 365) return fail(400, "invalid_days");
  return guard(async () => { const n = await getNav(symbol, days); return n ? ok(n) : fail(404, "not_found"); });
}
