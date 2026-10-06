import type { TreeInput } from "@/lib/tree";
import { usd } from "@/lib/format";
import { harvestHeadline, harvestSub } from "@/lib/og/copy"; // satu sumber teks dengan gambar PNG (route handler next/og)
import { WallTree } from "./wall-tree";

const trellis = "[background-image:repeating-linear-gradient(45deg,currentColor_0_1px,transparent_1px_30px),repeating-linear-gradient(-45deg,currentColor_0_1px,transparent_1px_30px)]";

// Kartu hijau daun rasio 1200:630 seperti .harvest-card di espalier.html (sama dengan gambar PNG yang dibagikan).
// Angka selalu realized. Nominal dolar hanya tampil jika amountUsd diberikan (opt-in pengguna).
export function HarvestCard({ percent, round, tree, amountUsd, isDemo }: { percent: number; round: number; tree: TreeInput; amountUsd?: number; isDemo?: boolean }) {
  return (
    <figure className="relative m-0 grid aspect-[1200/630] w-full max-w-xl grid-cols-[1.1fr_.9fr] overflow-hidden rounded-[18px] bg-leaf text-on-leaf shadow-[0_1px_0_color-mix(in_srgb,var(--bark)_30%,transparent),0_24px_48px_-28px_color-mix(in_srgb,var(--leaf)_80%,transparent)]">
      <div aria-hidden className={`absolute inset-0 opacity-[.12] ${trellis}`} />
      <figcaption className="relative z-[1] flex flex-col justify-between py-[7%] pr-0 pl-[8%]">
        <span aria-hidden className="font-display text-[clamp(.9rem,1.6vw,1.1rem)] opacity-85">Espalier</span>
        <div>
          <p className="m-0 font-display text-[clamp(1.1rem,2.6vw,1.9rem)] leading-[1.12] tracking-[-.015em]">{harvestHeadline(percent)}</p>
          {amountUsd !== undefined && <p className="m-0 mt-1 font-mono text-[clamp(.8rem,1.4vw,1rem)]">{usd(amountUsd)}</p>}
        </div>
        <span className="font-mono text-[clamp(.62rem,1.1vw,.8rem)] opacity-80">{harvestSub(round, !!isDemo)}</span>
      </figcaption>
      <div className="relative">
        <WallTree input={tree} tone="onLeaf" className="absolute inset-[4%_2%_0_0] h-[96%] w-[98%]" />
      </div>
    </figure>
  );
}
