import { OG_SIZE } from "@/lib/og/copy";
import { BrandImage, renderImage } from "@/lib/og/images";

export const alt = "Espalier. Plant stocks. Train them. Harvest weekly.";
export const size = OG_SIZE;
export const contentType = "image/png";

// Gambar OG bawaan seluruh situs. Statis: tanpa data, dibuat saat build.
export default function Image() {
  return renderImage(
    <BrandImage title="Espalier" subtitle="Cordons, Spurs, and weekly Harvests on Stock Tokens."seed="espalier" />,
    "public, max-age=3600, s-maxage=86400, stale-while-revalidate=604800",
  );
}
