"use client";
import { useSyncExternalStore } from "react";
import { marketState } from "@/lib/api/market";
import { MarketStatusPill } from "./data";

// Chip status pasar AS di header (.pill.mkt di espalier.html). Server tidak tahu jam klien, jadi snapshot server null:
// chip baru muncul setelah hidrasi dan diperbarui tiap menit. Hanya di layar lebar; halaman Cordon menampilkan versi lengkap.
const subscribe = (cb: () => void) => { const id = setInterval(cb, 60_000); return () => clearInterval(id); };
export function HeaderMarketChip() {
  const state = useSyncExternalStore(subscribe, () => marketState(new Date()), () => null);
  if (!state) return null;
  return <div className="hidden xl:block"><MarketStatusPill state={state} prefix="US market" /></div>;
}
