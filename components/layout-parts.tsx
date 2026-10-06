"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { HeaderMarketChip } from "./header-market";
import { ThemeToggle } from "./theme-toggle";
import { WalletButton } from "./wallet-button";

const links = [["/cordons", "Cordons"], ["/vaults", "Spurs & Grafts"], ["/harvest", "Harvest"], ["/wall", "The Wall"], ["/docs", "Docs & Risk"]];
export function Header() {
  const path = usePathname();
  const [open, setOpen] = useState(false);
  return (
    <header className="sticky top-0 z-20 border-b border-wire/60 bg-[color-mix(in_srgb,var(--wall)_88%,transparent)] pt-[env(safe-area-inset-top,0px)] backdrop-blur-[10px]">
      <div className="wrap relative flex h-16 items-center gap-3 md:gap-5">
        <Link href="/" aria-label="Espalier home" className="flex items-center gap-2.5 font-display text-[1.45rem] font-medium tracking-[-.01em]">
          <svg viewBox="0 0 32 32" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" aria-hidden className="size-7 shrink-0">
            <path d="M16 29V5M16 12H8q-2 0-2-3M16 12h8q2 0 2-3M16 21H6q-2 0-2-3M16 21h10q2 0 2-3" />
            <circle cx="26" cy="7.5" r="2.2" fill="var(--fruit)" stroke="var(--bark)" strokeWidth=".8" />
          </svg>
          Espalier
        </Link>
        <nav id="main-nav" aria-label="Primary" className={open ? "absolute inset-x-0 top-full flex flex-col border-b border-wire bg-wall px-5 pb-4 md:static md:ml-3 md:flex-row md:gap-[22px] md:border-0 md:bg-transparent md:p-0" : "ml-3 hidden gap-[22px] md:flex"}>
          {links.map(([href, label]) => {
            const current = path === href || path.startsWith(href + "/");
            return (
              <Link key={href} href={href} onClick={() => setOpen(false)} aria-current={current ? "page" : undefined}
                className={`py-3 text-[.94rem] font-medium md:py-1.5 ${current ? "text-ink shadow-[inset_0_-2px_0_var(--fruit)] max-md:text-leaf max-md:shadow-none" : "text-bark hover:text-ink"}`}>{label}</Link>
            );
          })}
        </nav>
        <span className="flex-1" />
        <HeaderMarketChip />
        <ThemeToggle />
        <WalletButton />
        <button type="button" aria-expanded={open} aria-controls="main-nav" onClick={() => setOpen(!open)}
          className="inline-flex min-h-11 items-center rounded-full border border-wire px-3 text-[.82rem] font-medium md:hidden">Menu</button>
      </div>
    </header>
  );
}
const exploreLinks = [["/cordons", "Cordons"], ["/vaults", "Spurs & Grafts"], ["/harvest", "Harvest"], ["/wall", "The Wall"], ["/docs", "Docs"]];
const footerLinks = [["/terms", "Terms"], ["/privacy", "Privacy"], ["/restricted", "Where Espalier is restricted"]];
const chip = "inline-flex min-h-9 items-center rounded-full border border-wire bg-panel px-3 font-mono text-[.78rem] text-ink hover:border-bark focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-leaf";
export function Footer() {
  return (
    <footer className="mt-10 border-t border-wire pt-14 pb-[calc(40px+env(safe-area-inset-bottom,0px))] text-bark">
      <div className="wrap flex flex-wrap items-end justify-between gap-5">
        <p className="m-0 font-display text-[clamp(1.6rem,3.4vw,2.6rem)] font-light leading-[1.05] tracking-[-.02em] text-ink">Plant stocks. Train them.<br />Harvest weekly.</p>
        <div className="flex basis-full flex-wrap items-center gap-2">
          <span className="mr-1.5 text-[.84rem]">Explore</span>
          {exploreLinks.map(([href, label]) => <Link key={href} href={href} className={chip}>{label}</Link>)}
        </div>
        <nav aria-label="Legal" className="flex basis-full flex-wrap items-center gap-2">
          <span className="mr-1.5 text-[.84rem]">Legal</span>
          {footerLinks.map(([href, label]) => <Link key={href} href={href} className={chip}>{label}</Link>)}
        </nav>
        <small className="block max-w-[58ch] text-[.84rem]">Spurs cap your upside. That is the trade. Stock Tokens carry risk of loss.</small>
      </div>
    </footer>
  );
}
