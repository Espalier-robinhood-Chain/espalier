import { ADDRESS, fail, guard } from "@/lib/api/http";
import { loadWall } from "@/lib/auth/server";
import { IMAGE_CACHE } from "@/lib/og/copy";
import { HarvestCardImage, renderImage } from "@/lib/og/images";

export const dynamic = "force-dynamic";

// Harvest Card terbaru (brief §5.5: GET …/card.png). Persen realized + pohon; tanpa nominal dolar dan tanpa alamat.
// Belum ada Harvest → 404 (kartu tidak dibuat dari angka nol, sama dengan keputusan di Page F).
export async function GET(_: Request, { params }: { params: Promise<{ address: string }> }) {
  const { address } = await params;
  if (!ADDRESS.test(address)) return fail(400, "invalid_address");
  return guard(async () => {
    const r = await loadWall(address); // Wall privat hanya untuk pemiliknya (cookie sesi)
    if (r.kind === "private") return fail(404, "not_public");
    const wall = r.wall;
    if (!wall.lastHarvest) return fail(404, "no_harvest");
    return renderImage(<HarvestCardImage percent={wall.lastHarvest.pct} round={wall.lastHarvest.round} tree={wall.tree} isDemo={wall.isDemo} />, IMAGE_CACHE);
  });
}
