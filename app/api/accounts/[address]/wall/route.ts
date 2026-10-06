import { ADDRESS, fail, guard, NO_STORE, ok } from "@/lib/api/http";
import { loadWall } from "@/lib/auth/server";

export const dynamic = "force-dynamic";

// Bergantung pada cookie sesi (Wall pribadi hanya untuk pemiliknya), jadi tidak boleh masuk cache bersama.
// Wall yang bukan publik dan bukan milik penonton dijawab 404 yang sama untuk "privat" dan "tidak dikenal".
export async function GET(_: Request, { params }: { params: Promise<{ address: string }> }) {
  const { address } = await params;
  if (!ADDRESS.test(address)) return fail(400, "invalid_address");
  return guard(async () => {
    const r = await loadWall(address);
    if (r.kind === "private") return fail(404, "not_public");
    return ok(r.wall, NO_STORE);
  });
}
