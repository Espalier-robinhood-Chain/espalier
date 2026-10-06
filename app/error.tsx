"use client";

import { useRouter } from "next/navigation";
import { useEffect, useTransition } from "react";
import { GardenArt } from "@/components/garden-art";
import { Footer, Header } from "@/components/layout-parts";
import { TrellisBackground } from "@/components/motif";
import { Button, ButtonLink } from "@/components/ui";

// Menangkap error render di dalam layout. Error di layout akar ditangani global-error.tsx.
export default function GardenError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  // Pelaporan ke layanan error (Sentry) menyusul di Fase 5 item 2.
  useEffect(() => { console.error(error); }, [error]);

  // refresh() mengambil ulang bagian server; reset() merender ulang batas error.
  function retry() { start(() => { router.refresh(); reset(); }); }

  return (
    <>
      <Header />
      <main>
        <section aria-labelledby="err-title" className="relative overflow-hidden border-b border-wire">
          <TrellisBackground className="[mask-image:linear-gradient(to_bottom,black_30%,transparent)]" />
          <div className="relative mx-auto max-w-5xl space-y-5 px-4 py-14 text-center md:py-20">
            <h1 id="err-title" className="font-display text-4xl text-balance sm:text-5xl">A branch came down.</h1>
            <div role="alert" className="space-y-2">
              <p className="mx-auto max-w-prose text-lg text-bark">Something broke while loading this page. That is on our side. Try again in a moment.</p>
              {error.digest && <p className="font-mono text-xs text-bark">Reference: {error.digest}</p>}
            </div>
            <GardenArt variant="cut" className="py-2" />
            <div className="flex flex-wrap justify-center gap-3 pt-1">
              <Button type="button" onClick={retry} disabled={pending}>{pending ? "Trying again…" : "Try again"}</Button>
              <ButtonLink href="/" variant="ghost">Back to the garden</ButtonLink>
            </div>
          </div>
        </section>
      </main>
      <Footer />
    </>
  );
}
