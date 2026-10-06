"use client";

export function ThemeToggle() {
  function toggle() {
    const el = document.documentElement;
    const cur = el.dataset.theme ?? (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
    const next = cur === "dark" ? "light" : "dark";
    el.dataset.theme = next;
    try { localStorage.setItem("theme", next); } catch {}
  }
  return <button type="button" onClick={toggle} aria-label="Toggle light and dark theme" className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-full border border-wire px-3 text-[.82rem] font-medium hover:border-bark focus-visible:outline-2 focus-visible:outline-leaf"><span aria-hidden>◐</span></button>;
}
