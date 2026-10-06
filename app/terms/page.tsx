import type { Metadata } from "next";
import Link from "next/link";
import { LegalPage, legalLink, type LegalSection } from "@/components/legal";
import { LEGAL_UPDATED } from "@/lib/legal/meta";

export const metadata: Metadata = {
  title: "Terms of Use — Espalier",
  description: "The rules for using the Espalier demo preview. Draft terms, pending legal review.",
};

const sections: readonly LegalSection[] = [
  {
    id: "what",
    title: "What this is",
    body: (
      <>
        <p>Espalier is a demo preview. It shows how Cordons, Spurs, and Grafts are designed to work. It holds no real assets and sends no transactions.</p>
        <p>Every number you see is demo data, and it is labelled as demo. None of it is a live price.</p>
      </>
    ),
  },
  {
    id: "advice",
    title: "Not advice, not an offer",
    body: (
      <>
        <p>Nothing on Espalier is an offer, a solicitation, or investment, legal, or tax advice.</p>
        <p>Read <Link href="/docs" className={legalLink}>Docs &amp; Risk</Link> to see how the products are designed and what can go wrong. Decide for yourself, and ask a professional if you need one.</p>
      </>
    ),
  },
  {
    id: "who",
    title: "Who may use it",
    body: (
      <>
        <p>Stock Tokens are not offered to US persons. Other places are restricted too. <Link href="/restricted" className={legalLink}>Where Espalier is restricted</Link> lists what we know today.</p>
        <p>If you are in a restricted place, or you are not allowed to use Espalier where you live, do not use it. Checking this is your job, not ours.</p>
        <p>You must be old enough to make a binding agreement where you live.</p>
      </>
    ),
  },
  {
    id: "risk",
    title: "Risk",
    body: (
      <>
        <p>Stock Tokens are tokenised debt securities. They give economic exposure to a stock, not legal rights to the shares.</p>
        <p>A Spur gives up upside above its strike. A Graft pays out when the price falls below its strike. You can lose some or all of what you put in. Premium is not a rate and it is not promised.</p>
        <p>These risks apply to any live version, once there is one.</p>
      </>
    ),
  },
  {
    id: "wallet",
    title: "Your wallet",
    body: (
      <>
        <p>The preview does not connect to your wallet. When it does, Espalier will only ask you to sign what it shows you.</p>
        <p>Espalier will never ask for your seed phrase or private key. If anyone does, it is not us.</p>
      </>
    ),
  },
  {
    id: "use",
    title: "Fair use",
    body: (
      <>
        <p>Do not attack the site or its services. Do not try to get around a restriction or a rate limit.</p>
        <p>Do not present demo numbers as real results. A share card made from demo data is still demo.</p>
      </>
    ),
  },
  {
    id: "names",
    title: "Names and logos",
    body: (
      <p>Espalier is independent. It is not affiliated with, and not endorsed by, the issuer of Stock Tokens, the issuer of USDG, or any company whose stock a token follows. Tickers are shown as data. Other names belong to their owners.</p>
    ),
  },
  {
    id: "liability",
    title: "No promises, limited liability",
    body: (
      <>
        <p>The preview is provided as it is. It can be wrong, it can change, and it can go offline at any time.</p>
        <p>To the extent the law allows, Espalier is not responsible for loss that comes from using the preview or relying on what it shows. Nothing here limits rights you cannot give up by law.</p>
      </>
    ),
  },
  {
    id: "changes",
    title: "Changes",
    body: (
      <p>We may change these terms. The date at the top shows the latest version. If you keep using Espalier after a change, you accept the new version.</p>
    ),
  },
  {
    id: "full",
    title: "What the full terms will add",
    body: (
      <>
        <p>Before any real assets are involved, these terms will be replaced. The full terms are expected to cover:</p>
        <ul className="list-disc space-y-1 pl-5 marker:text-bark">
          <li>the legal entity behind Espalier and a contact address</li>
          <li>governing law and how disputes are handled</li>
          <li>fees, and the cap on deposits</li>
          <li>how access is checked</li>
          <li>sanctions</li>
          <li>how contracts are paused or replaced</li>
        </ul>
      </>
    ),
  },
];

export default function TermsPage() {
  return (
    <LegalPage
      id="terms"
      title="Terms of Use"
      lead="The short rules for using this preview."
      status="Demo preview · draft terms"
      updated={LEGAL_UPDATED}
      notice={<>These are draft terms for the demo preview. They have not had a legal review yet. Full terms will replace this page before any real assets are involved.</>}
      sections={sections}
    />
  );
}
