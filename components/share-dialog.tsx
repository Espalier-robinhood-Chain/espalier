"use client";
import { useRef, useState } from "react";
import { Button, ButtonAnchor } from "./ui";

// imageHref: gambar PNG kartu dari route handler (opsional); tampil sebagai tautan unduh.
export function ShareDialog({ text, imageHref, children }: { text: string; imageHref?: string; children: React.ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null);
  const [copied, setCopied] = useState(false);
  async function copy() {
    try { await navigator.clipboard.writeText(text); setCopied(true); } catch { setCopied(false); }
  }
  return (
    <>
      <Button variant="ghost" onClick={() => ref.current?.showModal()}>Share</Button>
      <dialog ref={ref} onClose={() => setCopied(false)} className="m-auto w-[min(92vw,30rem)] rounded-[22px] border border-wire bg-wall p-7 text-ink backdrop:bg-black/40">
        <div className="space-y-4">
          {children}
          <div className="flex flex-wrap gap-2">
            <Button onClick={copy}>{copied ? "Copied" : "Copy text"}</Button>
            {imageHref && <ButtonAnchor href={imageHref} download="espalier-harvest.png" variant="ghost">Download image</ButtonAnchor>}
            <Button variant="ghost" onClick={() => ref.current?.close()}>Close</Button>
          </div>
        </div>
      </dialog>
    </>
  );
}
