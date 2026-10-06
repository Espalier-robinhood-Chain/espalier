"use client";
import type { TreeInput } from "@/lib/tree";
import { useEffect, useRef, useSyncExternalStore } from "react";
import { Button } from "./ui";
import { createTreeScene, type TreeScene } from "./tree-3d-scene";
import { layoutTree3D, type Layout3D } from "@/lib/tree3d-layout";

// Dimuat hanya lewat HeroTree (next/dynamic, ssr:false). Jangan impor langsung dari halaman: three.js besar.
const RM = "(prefers-reduced-motion: reduce)";
const subRM = (cb: () => void) => { const m = matchMedia(RM); m.addEventListener("change", cb); return () => m.removeEventListener("change", cb); };
const useReducedMotion = () => useSyncExternalStore(subRM, () => matchMedia(RM).matches, () => false);

export default function Tree3D({ input, className = "", onUnavailable, onReady }: { input: TreeInput; className?: string; onUnavailable?: () => void; onReady?: () => void }) {
  const hostRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<TreeScene | null>(null);
  const reduced = useReducedMotion();
  // Kunci berbasis isi, supaya objek `input` baru dengan isi sama tidak membangun ulang scene.
  const layout = layoutTree3D(input);
  const layoutKey = JSON.stringify(layout);
  const hiddenCordons = layout.hiddenCordons;

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    try {
      sceneRef.current = createTreeScene(host, JSON.parse(layoutKey) as Layout3D, { reduced: matchMedia(RM).matches, onContextLost: onUnavailable, onReady });
    } catch {
      onUnavailable?.(); // WebGL tidak tersedia: pemanggil menampilkan pohon SVG
      return;
    }
    return () => { sceneRef.current?.dispose(); sceneRef.current = null; };
  }, [layoutKey, onUnavailable, onReady]);

  useEffect(() => { sceneRef.current?.setReduced(reduced); }, [reduced]);

  return (
    <div className={`relative aspect-square ${className}`}>
      <div ref={hostRef} role="img" className="absolute inset-0"
        aria-label={`Espalier tree in 3D: ${input.positions.length} cordons, ${input.harvests} harvests${hiddenCordons ? `, ${hiddenCordons} cordons not drawn` : ""}`} />
      <span aria-hidden className="hint-in pointer-events-none absolute bottom-1.5 left-1 text-[.78rem] text-bark">Drag to turn the tree</span>
      {!reduced && <Button variant="ghost" className="absolute right-1 bottom-0 !min-h-9 !px-3.5 !text-[.8rem]" onClick={() => sceneRef.current?.replant()}>Grow again</Button>}
    </div>
  );
}
