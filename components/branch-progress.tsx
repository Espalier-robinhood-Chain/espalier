"use client";
import { motion, useReducedMotion } from "motion/react";

// value 0..1; tanpa value = loading (tumbuh sekali). Reduced motion: langsung utuh.
export function BranchProgress({ value, label = "Loading" }: { value?: number; label?: string }) {
  const reduce = useReducedMotion();
  const target = value ?? 1;
  return (
    <svg role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={100}
      aria-valuenow={value === undefined ? undefined : Math.round(value * 100)} viewBox="0 0 240 40" className="h-10 w-60">
      <path d="M4 30H110C140 30 140 12 170 12H236" fill="none" stroke="var(--wire)" strokeWidth="1.5" strokeLinecap="round" />
      <motion.path d="M4 30H110C140 30 140 12 170 12H236" fill="none" stroke="var(--bark)" strokeWidth="1.5" strokeLinecap="round"
        initial={{ pathLength: reduce ? target : 0 }} animate={{ pathLength: target }} transition={{ duration: reduce ? 0 : 0.6, ease: "easeOut" }} />
    </svg>
  );
}
