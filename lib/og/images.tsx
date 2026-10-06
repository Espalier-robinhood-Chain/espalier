/* eslint-disable @next/next/no-img-element -- satori (next/og) hanya memahami <img>, bukan next/image */
import { ImageResponse } from "next/og";
import { generateTree, treeSvg, type TreeInput } from "@/lib/tree";
import { harvestHeadline, harvestSub, OG_SIZE, TAGLINE, wallHeadline, wallStats } from "./copy";
import { ogFonts } from "./fonts";
import { PALETTE as C, TRELLIS_URI } from "./palette";

// Aturan satori: setiap <div> dengan lebih dari satu anak harus display:flex; tanpa CSS variable.
const treeImage = (input: TreeInput) => {
  const t = generateTree(input);
  return { uri: `data:image/svg+xml;utf8,${encodeURIComponent(treeSvg(t, C))}`, hidden: t.hiddenFruits };
};

function Frame({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ display: "flex", position: "relative", width: OG_SIZE.width, height: OG_SIZE.height, background: C.wall, color: C.ink, fontFamily: "Inter" }}>
      <img src={TRELLIS_URI} width={OG_SIZE.width} height={OG_SIZE.height} alt="" style={{ position: "absolute", top: 0, left: 0 }} />
      {children}
    </div>
  );
}
const Wordmark = () => <div style={{ display: "flex", fontFamily: "Fraunces", fontSize: 40 }}>Espalier</div>;
const Tagline = () => <div style={{ display: "flex", fontSize: 26, color: C.bark }}>{TAGLINE}</div>;
const Pill = ({ children }: { children: React.ReactNode }) => (
  <div style={{ display: "flex", border: `2px solid ${C.wire}`, borderRadius: 999, padding: "6px 18px", fontSize: 24, color: C.bark }}>{children}</div>
);
function Tree({ input, size }: { input: TreeInput; size: number }) {
  const { uri, hidden } = treeImage(input);
  return (
    <div style={{ display: "flex", position: "relative", width: size, height: size }}>
      <img src={uri} width={size} height={size} alt="" />
      {hidden > 0 && <div style={{ display: "flex", position: "absolute", top: 0, right: 0, fontFamily: "JetBrains Mono", fontSize: 26, color: C.bark }}>+{hidden}</div>}
    </div>
  );
}
const Dot = () => <div style={{ display: "flex", width: 18, height: 18, borderRadius: 9, background: C.fruit, border: `2px solid ${C.bark}` }} />;

// Harvest Card: persen realized + pohon. Tanpa nominal dolar dan tanpa alamat (keputusan item 16).
export function HarvestCardImage({ percent, round, tree, isDemo }: { percent: number; round: number; tree: TreeInput; isDemo: boolean }) {
  return (
    <Frame>
      <div style={{ display: "flex", flexDirection: "column", justifyContent: "space-between", width: 740, padding: 64 }}>
        <Wordmark />
        <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
          <div style={{ display: "flex", fontFamily: "Fraunces", fontSize: 66, lineHeight: 1.12 }}>{harvestHeadline(percent)}</div>
          <div style={{ display: "flex", alignItems: "center", gap: 14, fontSize: 30, color: C.bark }}><Dot />{harvestSub(round, isDemo)}</div>
        </div>
        <Tagline />
      </div>
      <div style={{ display: "flex", flex: 1, alignItems: "center", justifyContent: "center", paddingRight: 40 }}><Tree input={tree} size={440} /></div>
    </Frame>
  );
}

// Gambar The Wall: pohon + hitungan. Tanpa nominal dolar dan tanpa alamat.
export function WallImage({ tree, positions, harvests, streak, isDemo }: { tree: TreeInput; positions: number; harvests: number; streak: number; isDemo: boolean }) {
  return (
    <Frame>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", width: 560, paddingLeft: 40 }}><Tree input={tree} size={500} /></div>
      <div style={{ display: "flex", flexDirection: "column", justifyContent: "space-between", flex: 1, padding: "64px 64px 64px 24px" }}>
        <Wordmark />
        <div style={{ display: "flex", flexDirection: "column", gap: 28 }}>
          <div style={{ display: "flex", fontFamily: "Fraunces", fontSize: 88, lineHeight: 1.05 }}>{wallHeadline}</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            {wallStats({ positions, harvests, streak }).map((s) => (
              <div key={s} style={{ display: "flex", alignItems: "center", gap: 14, fontSize: 36, color: C.bark }}><Dot />{s}</div>
            ))}
          </div>
          {isDemo && <div style={{ display: "flex" }}><Pill>Demo data</Pill></div>}
        </div>
        <Tagline />
      </div>
    </Frame>
  );
}

// Gambar OG umum: nama halaman, baris pendukung, dan chip (mis. ticker). Pohonnya dekoratif, diseed dari `seed`.
export function BrandImage({ title, subtitle, chips = [], demo = false, seed }: { title: string; subtitle: string; chips?: string[]; demo?: boolean; seed: string }) {
  const tree: TreeInput = { address: seed, totalValueUsd: 50_000, positions: [{ id: "a", weightBps: 4000 }, { id: "b", weightBps: 3500 }, { id: "c", weightBps: 2500 }], harvests: 9, streak: 4 };
  return (
    <Frame>
      <div style={{ display: "flex", flexDirection: "column", justifyContent: "space-between", width: 740, padding: 64 }}>
        <Wordmark />
        <div style={{ display: "flex", flexDirection: "column", gap: 22 }}>
          <div style={{ display: "flex", fontFamily: "Fraunces", fontSize: title.length > 12 ? 72 : 96, lineHeight: 1.05 }}>{title}</div>
          <div style={{ display: "flex", fontSize: 34, lineHeight: 1.25, color: C.bark }}>{subtitle}</div>
          {chips.length > 0 && (
            <div style={{ display: "flex", flexWrap: "wrap", gap: 10 }}>
              {chips.map((c) => <div key={c} style={{ display: "flex", border: `2px solid ${C.wire}`, borderRadius: 6, padding: "4px 12px", fontFamily: "JetBrains Mono", fontSize: 24, color: C.bark }}>{c}</div>)}
            </div>
          )}
          {demo && <div style={{ display: "flex" }}><Pill>Demo preview</Pill></div>}
        </div>
        <Tagline />
      </div>
      <div style={{ display: "flex", flex: 1, alignItems: "center", justifyContent: "center", paddingRight: 32 }}><Tree input={tree} size={400} /></div>
    </Frame>
  );
}

export async function renderImage(el: React.ReactElement, cacheControl: string) {
  return new ImageResponse(el, { ...OG_SIZE, fonts: await ogFonts(), headers: { "Cache-Control": cacheControl } });
}
