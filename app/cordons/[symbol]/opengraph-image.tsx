import { SYMBOL } from "@/lib/api/http";
import { getCordon } from "@/lib/api/queries";
import { OG_CACHE, OG_SIZE } from "@/lib/og/copy";
import { BrandImage, renderImage } from "@/lib/og/images";

export const alt = "A Cordon on Espalier";
export const size = OG_SIZE;
export const contentType = "image/png";
export const dynamic = "force-dynamic";

// Tanpa angka (NAV, TVL): gambar OG tersimpan di cache platform sosial dan bisa basi. Hanya nama dan komposisi.
// Gagal apa pun (symbol aneh, data tidak ada, env kosong) → gambar umum, supaya tautan tetap punya pratinjau.
export default async function Image({ params }: { params: Promise<{ symbol: string }> }) {
  const { symbol } = await params;
  const cordon = SYMBOL.test(symbol) ? await getCordon(symbol).catch(() => null) : null;
  if (!cordon) return renderImage(<BrandImage title="Espalier" subtitle="Cordons, Spurs, and weekly Harvests on Stock Tokens." demo seed="espalier" />, OG_CACHE);
  return renderImage(
    <BrandImage title={cordon.symbol} subtitle={`${cordon.name}. A basket of ${cordon.assets.length} Stock Tokens.`}
      chips={cordon.assets.map((a) => a.ticker)} demo={cordon.isDemo} seed={cordon.symbol} />,
    OG_CACHE,
  );
}
