import { ADDRESS, fail, guard } from "@/lib/api/http";
import { loadWall } from "@/lib/auth/server";
import { IMAGE_CACHE } from "@/lib/og/copy";
import { renderImage, WallImage } from "@/lib/og/images";

export const dynamic = "force-dynamic";

// Gambar The Wall: pohon alamat ini + hitungan posisi, Harvest, streak. Tanpa nominal dolar dan tanpa alamat.
// Tanpa posisi → 404 (pohon kosong bukan sesuatu yang layak dibagikan).
export async function GET(_: Request, { params }: { params: Promise<{ address: string }> }) {
  const { address } = await params;
  if (!ADDRESS.test(address)) return fail(400, "invalid_address");
  return guard(async () => {
    const r = await loadWall(address); // Wall privat hanya untuk pemiliknya (cookie sesi)
    if (r.kind === "private") return fail(404, "not_public");
    const wall = r.wall;
    if (wall.positions.length === 0) return fail(404, "nothing_planted");
    return renderImage(<WallImage tree={wall.tree} positions={wall.positions.length} harvests={wall.harvests} streak={wall.streak} isDemo={wall.isDemo} />, IMAGE_CACHE);
  });
}
