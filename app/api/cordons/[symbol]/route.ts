import { fail, guard, ok, SYMBOL } from "@/lib/api/http";
import { getCordon } from "@/lib/api/queries";

export const dynamic = "force-dynamic";

export async function GET(_: Request, { params }: { params: Promise<{ symbol: string }> }) {
  const { symbol } = await params;
  if (!SYMBOL.test(symbol)) return fail(400, "invalid_symbol");
  return guard(async () => { const c = await getCordon(symbol); return c ? ok(c) : fail(404, "not_found"); });
}
