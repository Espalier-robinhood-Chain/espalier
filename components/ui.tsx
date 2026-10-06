import Link from "next/link";
import { TrellisBackground } from "./motif";

const btnBase = "lift inline-flex min-h-11 items-center justify-center gap-2.5 rounded-full border-[1.5px] border-leaf px-[22px] text-[.98rem] font-semibold focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-leaf";
const btnVariant = { primary: "bg-leaf text-on-leaf", ghost: "bg-transparent text-leaf hover:bg-leaf/10" } as const;

// Kelas tombol untuk elemen non-tombol (mis. <span> "View vault" di dalam kartu yang seluruhnya tautan).
export const buttonClass = (variant: "primary" | "ghost" = "primary") => `${btnBase} ${btnVariant[variant]}`;

export function Button({ variant = "primary", className = "", ...p }: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "primary" | "ghost" }) {
  return <button type="button" {...p} className={`${btnBase} disabled:cursor-not-allowed disabled:opacity-45 disabled:hover:translate-y-0 ${btnVariant[variant]} ${className}`} />;
}
// Navigasi memakai <a>, bukan <button>.
export function ButtonLink({ variant = "primary", className = "", ...p }: React.ComponentProps<typeof Link> & { variant?: "primary" | "ghost" }) {
  return <Link {...p} className={`${btnBase} ${btnVariant[variant]} ${className}`} />;
}
// Unduhan atau berkas (mis. gambar dari route handler): <a> biasa, bukan next/link (tanpa prefetch dan routing klien).
export function ButtonAnchor({ variant = "primary", className = "", ...p }: React.AnchorHTMLAttributes<HTMLAnchorElement> & { variant?: "primary" | "ghost" }) {
  return <a {...p} className={`${btnBase} ${btnVariant[variant]} ${className}`} />;
}
// sub: kalimat penjelas di bawah judul. dashed: panel "after MVP" (transparan, garis putus-putus).
export function Panel({ title, sub, dashed = false, children, className = "" }: { title?: string; sub?: string; dashed?: boolean; children: React.ReactNode; className?: string }) {
  return (
    <section className={`relative rounded-[22px] p-7 ${dashed ? "border border-dashed border-wire bg-transparent" : "bg-panel"} ${className}`}>
      {title && <h2 className={`font-display text-[1.6rem] font-[450] tracking-[-.01em] ${sub ? "mb-1.5" : "mb-3"}`}>{title}</h2>}
      {sub && <p className="mb-[18px] text-[.92rem] text-bark">{sub}</p>}
      {children}
    </section>
  );
}
export function Badge({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <span className={`inline-block rounded-full border border-wire px-[9px] py-0.5 text-xs font-medium text-bark ${className}`}>{children}</span>;
}
export function Skeleton({ className = "h-6 w-full" }: { className?: string }) {
  return <div aria-hidden className={`rounded-lg bg-wire/40 motion-safe:animate-pulse ${className}`} />;
}
export function EmptyState({ title, text, children }: { title: string; text: string; children?: React.ReactNode }) {
  return (
    <div className="relative overflow-hidden rounded-[22px] border border-dashed border-wire p-10 text-center">
      <TrellisBackground />
      <div className="relative space-y-2">
        <h2 className="font-display text-xl font-[450]">{title}</h2>
        <p className="mx-auto max-w-prose text-bark">{text}</p>
        {children}
      </div>
    </div>
  );
}
