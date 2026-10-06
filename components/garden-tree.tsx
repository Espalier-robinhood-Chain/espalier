"use client";
import type { TreeInput } from "@/lib/tree";
import dynamic from "next/dynamic";
import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import { WallTree } from "./wall-tree";

// Pohon taman: dipakai Landing (HeroTree) dan /wall. Pohon SVG tetap jadi tampilan awal dan cadangan. Pohon 3D (three.js) dimuat terpisah (next/dynamic, ssr:false),
// baru setelah browser idle dan hanya bila WebGL ada, supaya tidak membebani bundel awal maupun LCP.
// SVG disembunyikan setelah frame 3D pertama tergambar. Gagal apa pun (WebGL, konteks hilang): kembali ke SVG.
const Tree3D = dynamic(() => import("./tree-3d"), { ssr: false, loading: () => null });

let webgl: boolean | undefined;
function hasWebGL(): boolean {
  if (webgl === undefined) {
    try { const c = document.createElement("canvas"); webgl = !!(c.getContext("webgl2") || c.getContext("webgl")); }
    catch { webgl = false; }
  }
  return webgl;
}
const noSub = () => () => {};

export function GardenTree({ input, className = "w-full max-w-xs" }: { input: TreeInput; className?: string }) {
  const supported = useSyncExternalStore(noSub, hasWebGL, () => false); // server dan hidrasi: SVG saja
  const [idle, setIdle] = useState(false);
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);
  const onUnavailable = useCallback(() => { setFailed(true); setReady(false); }, []);
  const onReady = useCallback(() => setReady(true), []);

  useEffect(() => {
    if (!supported) return;
    const w = window as Window & { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number; cancelIdleCallback?: (id: number) => void };
    if (w.requestIdleCallback) { const id = w.requestIdleCallback(() => setIdle(true), { timeout: 2000 }); return () => w.cancelIdleCallback?.(id); }
    const id = setTimeout(() => setIdle(true), 800);
    return () => clearTimeout(id);
  }, [supported]);

  if (!supported || failed) return <WallTree input={input} className={className} animate />;
  return (
    <div className={`relative aspect-square ${className}`}>
      <div aria-hidden={ready} className={`absolute inset-0 transition-opacity duration-500 ${ready ? "opacity-0" : "opacity-100"}`}>
        <WallTree input={input} className="h-full w-full" />
      </div>
      {idle && <Tree3D input={input} className="absolute inset-0 h-full w-full !aspect-auto" onUnavailable={onUnavailable} onReady={onReady} />}
    </div>
  );
}
