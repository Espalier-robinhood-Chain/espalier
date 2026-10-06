import type { Metadata } from "next";
import Link from "next/link";
import { LegalPage, legalLink, type LegalSection } from "@/components/legal";
import { LEGAL_UPDATED } from "@/lib/legal/meta";

export const metadata: Metadata = {
  title: "Where Espalier is restricted — Espalier",
  description: "Where Espalier cannot be used, and what it checks. Summary only, pending legal review.",
};

const restricted = ["Canada", "United Kingdom", "Switzerland"] as const;

const sections: readonly LegalSection[] = [
  {
    id: "us",
    title: "Not available",
    body: (
      <>
        <p>Stock Tokens are not offered to US persons, as the issuer defines that term.</p>
        <p>If you are a US person, do not use Espalier.</p>
      </>
    ),
  },
  {
    id: "restricted",
    title: "Restricted",
    body: (
      <>
        <p>These places are restricted:</p>
        <ul className="list-disc space-y-1 pl-5 marker:text-bark">
          {restricted.map((c) => <li key={c}>{c}</li>)}
        </ul>
        <p>Other places are restricted too. The issuer’s own base prospectus and final terms hold the full list, and it can change. This page is a summary, not the list.</p>
      </>
    ),
  },
  {
    id: "unlisted",
    title: "If your place is not listed",
    body: (
      <>
        <p>That does not mean you are allowed. Rules differ by place and they change. Options are derivatives, and some places restrict them on their own.</p>
        <p>Check your local rules, or ask a professional.</p>
      </>
    ),
  },
  {
    id: "checks",
    title: "What Espalier checks today",
    body: (
      <>
        <p>Nothing. This is a demo preview with no real assets, so it does not block anyone by location.</p>
        <p>Access checks will be added before launch. How they will work is not decided yet. It could be a check on where you connect from, a declaration you confirm, or both.</p>
      </>
    ),
  },
  {
    id: "yours",
    title: "Your part",
    body: (
      <>
        <p>Checks can fail. You are still responsible for knowing whether you may use Espalier.</p>
        <p>If you are in a restricted place, do not use tools that hide your location to get around it. Read <Link href="/terms" className={legalLink}>Terms of Use</Link> and <Link href="/docs" className={legalLink}>Docs &amp; Risk</Link> before you start.</p>
      </>
    ),
  },
];

export default function RestrictedPage() {
  return (
    <LegalPage
      id="restricted"
      title="Where Espalier is restricted"
      lead="Espalier is not open everywhere. Check before you use it."
      status="Demo preview · list not final"
      updated={LEGAL_UPDATED}
      notice={<>This page is a summary, not legal advice. It is not final and has not had a legal review yet. It will be updated once that review is done.</>}
      sections={sections}
    />
  );
}
