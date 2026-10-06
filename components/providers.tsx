"use client";

import { MotionConfig } from "motion/react";
import { Web3Provider } from "./web3-provider";

// reducedMotion="user": hormati prefers-reduced-motion di semua komponen Motion.
export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <MotionConfig reducedMotion="user">
      <Web3Provider>{children}</Web3Provider>
    </MotionConfig>
  );
}
