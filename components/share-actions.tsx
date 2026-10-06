"use client";
import { useState } from "react";
import { Button, ButtonAnchor } from "./ui";

// Kontrol di bawah Harvest Card (espalier.html ".card-controls"): salin teks dan unduh PNG. Tanpa dialog: kartunya sudah terlihat.
export function ShareActions({ text, imageHref }: { text: string; imageHref?: string }) {
  const [state, setState] = useState<"idle" | "copied" | "failed">("idle");
  async function copy() {
    try { await navigator.clipboard.writeText(text); setState("copied"); } catch { setState("failed"); }
  }
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button variant="ghost" onClick={copy}>Copy share text</Button>
      {imageHref && <ButtonAnchor href={imageHref} download="espalier-harvest.png" variant="ghost">Download image</ButtonAnchor>}
      <span role="status" className="text-sm text-bark">{state === "copied" ? "Copied" : state === "failed" ? "Could not copy. Select the text manually." : ""}</span>
    </div>
  );
}
