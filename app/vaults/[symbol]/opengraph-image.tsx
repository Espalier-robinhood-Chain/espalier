import { SYMBOL } from "@/lib/api/http";
import { getVault } from "@/lib/api/queries";
import { OG_CACHE, OG_SIZE } from "@/lib/og/copy";
import { BrandImage, renderImage } from "@/lib/og/images";

export const alt = "A vault on Espalier";
export const size = OG_SIZE;
export const contentType = "image/png";
export const dynamic = "force-dynamic";

// Tanpa APY atau strike: itu angka mingguan yang basi di cache platform sosial, dan APY yang menempel di gambar
// terbaca seperti janji. Spur ditulis apa adanya: upside dibatasi.
export default async function Image({ params }: { params: Promise<{ symbol: string }> }) {
  const { symbol } = await params;
  const vault = SYMBOL.test(symbol) ? await getVault(symbol).catch(() => null) : null;
  if (!vault) return renderImage(<BrandImage title="Espalier" subtitle="Cordons, Spurs, and weekly Harvests on Stock Tokens." demo seed="espalier" />, OG_CACHE);
  const spur = vault.kind === "spur";
  return renderImage(
    <BrandImage title={vault.symbol} demo={vault.isDemo} seed={vault.symbol}
      subtitle={spur ? `Spur Vault on ${vault.underlying}. A weekly premium, and upside is capped.` : `Graft Vault on ${vault.underlying}. A weekly premium. Demo only for now.`} />,
    OG_CACHE,
  );
}
