"use client";

import { useEffect } from "react";
import { GardenArt } from "@/components/garden-art";
import { Button } from "@/components/ui";
import "./globals.css";

// Jaring terakhir: menggantikan layout akar, jadi harus membawa <html> dan <body> sendiri.
// Sengaja tanpa Header/Footer/router: bila layout rusak, jangan bergantung padanya (tautan memakai <a>).
// Font self-host dimuat di layout akar dan tidak ada di sini, jadi pakai font sistem.
export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => { console.error(error); }, [error]);
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <title>Something went wrong — Espalier</title>
        {/* Sama dengan skrip pemulih tema di layout akar. */}
        <script dangerouslySetInnerHTML={{ __html: 'try{var t=localStorage.getItem("theme");if(t)document.documentElement.dataset.theme=t}catch(e){}' }} />
      </head>
      <body className="antialiased" style={{ fontFamily: "system-ui, sans-serif" }}>
        <main className="mx-auto flex min-h-screen max-w-xl flex-col items-center justify-center gap-5 px-4 py-12 text-center">
          {/* Sengaja <a>, bukan <Link>: muat ulang penuh agar pulih dari layout yang rusak. */}
          {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
          <p><a href="/" className="text-xl underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-leaf" style={{ fontFamily: "Georgia, serif" }}>Espalier</a></p>
          <h1 className="text-4xl text-balance" style={{ fontFamily: "Georgia, serif" }}>The whole wall shook.</h1>
          <div role="alert" className="space-y-2">
            <p className="text-lg text-bark">Something broke before the page could load. That is on our side. Try again in a moment.</p>
            {error.digest && <p className="font-mono text-xs text-bark">Reference: {error.digest}</p>}
          </div>
          <GardenArt variant="cut" />
          <div className="flex flex-wrap justify-center gap-3">
            <Button type="button" onClick={reset}>Try again</Button>
            {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
            <a href="/" className="inline-flex min-h-11 items-center justify-center rounded border border-wire px-4 text-sm font-medium hover:bg-wire/20 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-leaf">Back to the garden</a>
          </div>
        </main>
      </body>
    </html>
  );
}
