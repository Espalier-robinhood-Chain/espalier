import type { Metadata } from "next";
import Link from "next/link";
import { LegalPage, legalLink, type LegalSection } from "@/components/legal";
import { LEGAL_UPDATED } from "@/lib/legal/meta";

export const metadata: Metadata = {
  title: "Privacy — Espalier",
  description: "What the Espalier demo preview collects today, and what it does not. Draft notice, pending legal review.",
};

const sections: readonly LegalSection[] = [
  {
    id: "short",
    title: "The short version",
    body: (
      <ul className="list-disc space-y-2 pl-5 marker:text-bark">
        <li>You can connect a wallet so the site can read your address. Connecting alone signs nothing and sends nothing.</li>
        <li>If you choose to sign in, you sign a free message that proves the address is yours. It sends no transaction. Signing in creates an account for that address and sets a sign-in cookie. Without signing in, Espalier sets no cookies.</li>
        <li>The only thing an account stores is whether your Wall is private. Walls are private unless you open them.</li>
        <li>Espalier runs no analytics or advertising tools.</li>
        <li>Connecting a wallet uses Reown’s wallet menu and relay service, which receive technical details of your request.</li>
        <li>Cordon and vault pages open a live connection from your browser to our database provider, so numbers update without reloading.</li>
        <li>A wallet address you type into The Wall is public onchain data. It is sent to our server and appears in the page address. A Wall that is private shows nothing to anyone but its owner.</li>
        <li>Your light or dark theme choice stays in your browser.</li>
      </ul>
    ),
  },
  {
    id: "collect",
    title: "What we collect today",
    body: (
      <dl className="space-y-4">
        <div>
          <dt className="font-display text-lg text-ink">Server logs</dt>
          <dd>Like most sites, our hosting provider records technical details of each request: IP address, time, the page asked for, and browser type. These logs help run, secure, and fix the site. The provider decides how long it keeps them.</dd>
        </div>
        <div>
          <dt className="font-display text-lg text-ink">Addresses you look up</dt>
          <dd><Link href="/wall" className={legalLink}>The Wall</Link> takes a wallet address in the page address. Our server uses it to look up whether that Wall is public or yours, and, if so, to read demo positions from our database, which runs on Supabase. Espalier does not save your lookups itself. Because the address is part of the page address, it can appear in the hosting provider’s logs, even when the Wall turns out to be private.</dd>
        </div>
        <div>
          <dt className="font-display text-lg text-ink">Wallet connection</dt>
          <dd>If you connect a wallet, the site reads your public address and the network your wallet is on. Connecting alone signs nothing and sends no transaction. The wallet menu is provided by Reown. Opening it loads wallet lists and logos from Reown’s servers, and connecting a mobile wallet goes through Reown’s relay service. Those services can see technical details of your request, such as your IP address, under Reown’s own privacy notice. Reading chain data may also send requests to a network node provider. Connecting alone does not store your address on our servers; signing in does (next entry). Your browser keeps the connection state in local storage so it can reconnect on your next visit. Disconnect in your wallet menu to clear it.</dd>
        </div>
        <div>
          <dt className="font-display text-lg text-ink">Signing in</dt>
          <dd>You can sign in with the wallet you connected. Your wallet shows a message to sign. The message names this site, your address, the network, and a random one-time number. Signing it is free and sends no transaction. Our sign-in provider, Supabase, checks the signature and creates an account for that address. Its record holds your wallet address, the time of sign-in, and technical details of the sign-in such as your IP address and browser type. It holds no name, email, or password. Your browser then keeps a sign-in cookie so the site knows you are signed in. The cookie is not used for advertising or tracking and is removed when you sign out. Our database also stores one setting for your address: whether your Wall is private, and when you last changed it. Signing in is optional. Without it you can still browse every page.</dd>
        </div>
        <div>
          <dt className="font-display text-lg text-ink">Live updates</dt>
          <dd>While a Cordon or vault page is open, your browser keeps a live connection to our database provider, Supabase, and listens for new numbers for that one Cordon or vault. The provider can see technical details of the connection, such as your IP address. Espalier stores nothing about it and the connection closes when you leave the page. It sets no cookies and uses no local storage.</dd>
        </div>
        <div>
          <dt className="font-display text-lg text-ink">Share pictures</dt>
          <dd>The Wall page can give you two pictures to download: a Harvest Card and a picture of your tree. Each Cordon and vault page also carries a preview picture, shown when its link is shared. They are drawn when asked for, from the same public data as the pages, and we do not keep them. The pictures show percentages and counts, never amounts, and never print your address. The web address of a Harvest Card or tree picture does contain the wallet address, so anyone you send that link to can see which address it belongs to.</dd>
        </div>
        <div>
          <dt className="font-display text-lg text-ink">Theme choice</dt>
          <dd>If you switch between light and dark, your browser remembers it in local storage under the name “theme”. It stays on your device and is never sent to us.</dd>
        </div>
        <div>
          <dt className="font-display text-lg text-ink">Demo data</dt>
          <dd>The positions and rounds this preview shows are demo data. They do not describe real people.</dd>
        </div>
      </dl>
    ),
  },
  {
    id: "never",
    title: "What we do not collect",
    body: (
      <>
        <p>No names, emails, or passwords, even when you sign in. No analytics, advertising, or fingerprinting tools.</p>
        <p>Never a seed phrase or a private key. Espalier will not ask for them.</p>
      </>
    ),
  },
  {
    id: "public",
    title: "Onchain data is public",
    body: (
      <>
        <p>Wallet addresses, balances, and transactions on a blockchain are public by design and cannot be erased. Espalier did not create that data. The Wall draws a picture from it.</p>
        <p>The blockchain stays public whatever you choose here. The privacy setting covers only The Wall on this site: a private Wall, and the pictures drawn from it, can be opened only by its owner while signed in. Anyone can still read your onchain activity on a block explorer.</p>
        <p>Walls are private until the owner opens them. If you open yours, anyone who has your address can see its positions and Harvests here. Share cards show percentages only. They never show dollar amounts and they do not include your address.</p>
      </>
    ),
  },
  {
    id: "change",
    title: "What will change",
    body: (
      <p>Sending transactions will come later. They will add data, such as your activity onchain and in our records of it. This page will change when they do.</p>
    ),
  },
  {
    id: "choices",
    title: "Your choices",
    body: (
      <>
        <p>Use “Sign out” on The Wall to remove the sign-in cookie. Clear your browser’s local storage to remove the theme choice and the saved wallet connection. You can change your Wall between private and public at any time.</p>
        <p>The account for your address and its privacy setting stay in our database after you sign out. The full notice will say how to ask for them to be deleted.</p>
        <p>Laws in some places give you rights to see or delete data about you. The full notice will say how to make a request and will name a contact address.</p>
      </>
    ),
  },
  {
    id: "changes",
    title: "Changes",
    body: <p>We may change this notice. The date at the top shows the latest version.</p>,
  },
];

export default function PrivacyPage() {
  return (
    <LegalPage
      id="privacy"
      title="Privacy"
      lead="What this site collects today, and what it does not."
      status="Demo preview · draft notice"
      updated={LEGAL_UPDATED}
      notice={<>This is a draft notice for the demo preview. It describes what the site does today and has not had a legal review yet. A full privacy notice will replace it before any real assets are involved.</>}
      sections={sections}
    />
  );
}
