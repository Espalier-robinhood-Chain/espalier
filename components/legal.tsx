import { Footer, Header } from "./layout-parts";
import { CordonDivider, TrellisBackground } from "./motif";

export type LegalSection = { id: string; title: string; body: React.ReactNode };

const h2 = "font-display text-[2rem] font-[450] leading-tight tracking-[-.02em] text-balance";
const tocLink = "inline-flex min-h-9 items-center rounded-full border border-wire px-3 text-sm text-bark hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-leaf md:rounded-none md:border-0 md:border-l-[1.5px] md:px-0 md:pl-3 md:hover:border-fruit";

// Kerangka bersama /terms, /privacy, /restricted: kepala halaman + trellis, daftar isi (gaya .docs-nav), bagian beranchor.
// Id bagian dan daftar isi berasal dari satu array, jadi anchor tidak bisa menyimpang.
export function LegalPage({ id, title, lead, status, updated, notice, sections }: {
  id: string;
  title: string;
  lead: string;
  status: string;
  updated: { iso: string; label: string };
  notice: React.ReactNode;
  sections: readonly LegalSection[];
}) {
  return (
    <>
      <Header />
      <main>
        <section aria-labelledby={`${id}-title`} className="relative overflow-hidden border-b border-wire pt-14 pb-9">
          <TrellisBackground className="opacity-35 [mask-image:linear-gradient(90deg,transparent_30%,black)]" />
          <div className="wrap relative">
            <h1 id={`${id}-title`} className="mb-3.5 font-display text-[clamp(2.6rem,6vw,4.6rem)] leading-none font-normal tracking-[-.03em] text-balance">{title}</h1>
            <p className="max-w-[56ch] text-[1.08rem] text-bark">{lead}</p>
            <p className="mt-5 flex flex-wrap items-center gap-x-3 gap-y-2 text-sm text-bark">
              <span className="rounded-full border border-wire px-3 py-1">{status}</span>
              <span>Last updated <time dateTime={updated.iso}>{updated.label}</time></span>
            </p>
          </div>
        </section>

        <div className="wrap grid gap-5 py-10 md:grid-cols-[220px_minmax(0,1fr)] md:gap-12 md:pb-[72px]">
          <nav aria-label="On this page" className="md:sticky md:top-[88px] md:self-start">
            <p className="mb-2 text-[.8rem] font-medium text-bark md:mb-1.5">On this page</p>
            <ul className="flex flex-wrap gap-1.5 md:flex-col md:gap-0.5">
              {sections.map((s) => <li key={s.id}><a href={`#${s.id}`} className={tocLink}>{s.title}</a></li>)}
            </ul>
          </nav>

          <div className="min-w-0 max-w-[72ch] space-y-10">
            <aside role="note" className="rounded-[14px] border border-dashed border-bark px-[18px] py-4 text-[.94rem] text-bark">{notice}</aside>
            {sections.map((s, i) => (
              <div key={s.id} className="space-y-10">
                {i > 0 && i % 4 === 0 && <CordonDivider />}
                <section id={s.id} aria-labelledby={`${s.id}-title`} className={`scroll-mt-[88px] ${i < sections.length - 1 ? "border-b border-wire pb-10" : ""}`}>
                  <h2 id={`${s.id}-title`} className={h2}>{s.title}</h2>
                  <div className="mt-3 space-y-3 text-[color-mix(in_srgb,var(--ink)_85%,var(--bark))]">{s.body}</div>
                </section>
              </div>
            ))}
          </div>
        </div>
      </main>
      <Footer />
    </>
  );
}

// Tautan di dalam teks legal.
export const legalLink = "text-ink underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-leaf";
