"use client";
import { useRef } from "react";

// Kartu miring mengikuti kursor, dengan kilau lembut (data-tilt di espalier.html). Hanya untuk pointer halus (mouse/pen)
// dan tanpa reduced motion; selain itu kartu diam (kecuali rotasi dasar `rz`, misalnya Harvest Card -1.2deg).
export function Tilt({ max = 5, rz = "0deg", className = "", children }: { max?: number; rz?: string; className?: string; children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const live = () => typeof matchMedia === "function" && matchMedia("(pointer: fine)").matches && !matchMedia("(prefers-reduced-motion: reduce)").matches;
  const set = (el: HTMLElement, v: Record<string, string>) => { for (const k in v) el.style.setProperty(k, v[k]); };
  const onMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const el = ref.current;
    if (!el || e.pointerType === "touch" || !live()) return;
    const r = el.getBoundingClientRect(), x = (e.clientX - r.left) / r.width, y = (e.clientY - r.top) / r.height;
    el.classList.add("tilting");
    set(el, { "--ry": `${((x - 0.5) * max * 2).toFixed(2)}deg`, "--rx": `${((0.5 - y) * max * 2).toFixed(2)}deg`, "--rz": "0deg", "--gx": `${x * 100}%`, "--gy": `${y * 100}%` });
  };
  const onLeave = () => {
    const el = ref.current;
    if (!el) return;
    el.classList.remove("tilting");
    set(el, { "--rx": "0deg", "--ry": "0deg", "--rz": rz });
  };
  return (
    <div ref={ref} className={`tilt relative ${className}`} style={{ "--rz": rz } as React.CSSProperties} onPointerMove={onMove} onPointerLeave={onLeave}>
      {children}
      <span aria-hidden className="glare" />
    </div>
  );
}
