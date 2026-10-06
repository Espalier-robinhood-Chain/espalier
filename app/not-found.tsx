import type { Metadata } from "next";
import { GardenArt } from "@/components/garden-art";
import { Footer, Header } from "@/components/layout-parts";
import { TrellisBackground } from "@/components/motif";
import { ButtonLink } from "@/components/ui";

export const metadata: Metadata = { title: "Page not found — Espalier" };

// Dipakai untuk URL yang tidak cocok dengan rute mana pun dan untuk notFound() dari halaman detail.
export default function NotFound() {
  return (
    <>
      <Header />
      <main>
        <section aria-labelledby="nf-title" className="relative overflow-hidden border-b border-wire">
          <TrellisBackground className="[mask-image:linear-gradient(to_bottom,black_30%,transparent)]" />
          <div className="relative mx-auto max-w-5xl space-y-5 px-4 py-14 text-center md:py-20">
            <p className="font-mono text-sm text-bark">404</p>
            <h1 id="nf-title" className="font-display text-4xl text-balance sm:text-5xl">Nothing grows here.</h1>
            <p className="mx-auto max-w-prose text-lg text-bark">This page is not on the wall. The address may have a typo, or the page may have moved.</p>
            <GardenArt variant="bare" className="py-2" />
            <p className="mx-auto max-w-prose text-sm text-bark">Followed a link to a Cordon or a vault? It may not be planted yet.</p>
            <div className="flex flex-wrap justify-center gap-3 pt-1">
              <ButtonLink href="/">Back to the garden</ButtonLink>
              <ButtonLink href="/docs" variant="ghost">Docs &amp; Risk</ButtonLink>
            </div>
          </div>
        </section>
      </main>
      <Footer />
    </>
  );
}
