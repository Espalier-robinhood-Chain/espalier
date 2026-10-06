"use client";
import { useEffect, useRef } from "react";

// Pemformat buatan sendiri, bukan Intl: Node (server) dan Chromium (klien) memformat notasi kompak dengan ICU berbeda
// (mis. 0 jadi "$0.00" di server tapi "$0" di klien), dan selisih itu menjatuhkan hidrasi seluruh halaman.
const trim = (n: number) => String(Number(n.toFixed(2)));
const fmt = {
  usd: { format: (v: number) => v >= 1e6 ? `$${trim(v / 1e6)}M` : v >= 1e3 ? `$${trim(v / 1e3)}K` : `$${Math.round(v)}` },
  int: { format: (v: number) => String(Math.round(v)).replace(/\B(?=(\d{3})+(?!\d))/g, ",") },
};

// Angka yang naik dari 0 saat terlihat (data-count di espalier.html). HTML server menampilkan 0 dan nilai akhir ada
// di teks sr-only; dengan reduced motion nilai akhir langsung tampil.
export function CountUp({ end, format }: { end: number; format: "usd" | "int" }) {
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const show = (v: number) => { el.textContent = fmt[format].format(v); };
    if (matchMedia("(prefers-reduced-motion: reduce)").matches || typeof IntersectionObserver === "undefined") { show(end); return; }
    let raf = 0;
    const io = new IntersectionObserver((es) => {
      if (!es[0].isIntersecting) return;
      io.disconnect();
      const t0 = performance.now();
      const step = (now: number) => {
        const p = Math.min(1, (now - t0) / 1600);
        show(end * (1 - Math.pow(1 - p, 4)));
        if (p < 1) raf = requestAnimationFrame(step);
      };
      raf = requestAnimationFrame(step);
    }, { threshold: 0.4 });
    io.observe(el);
    return () => { io.disconnect(); cancelAnimationFrame(raf); };
  }, [end, format]);
  return (
    <>
      <span ref={ref} aria-hidden>{fmt[format].format(0)}</span>
      <span className="sr-only">{fmt[format].format(end)}</span>
    </>
  );
}
