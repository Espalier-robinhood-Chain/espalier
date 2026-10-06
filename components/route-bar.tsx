"use client";
import { usePathname } from "next/navigation";

// Garis emas tipis di tepi atas layar yang "tumbuh" setiap pindah halaman (#routeBar di espalier.html).
// key={pathname} memasang ulang elemen, sehingga animasi CSS diputar lagi. Reduced motion: animasi mati, garis tak tampak.
export function RouteBar() {
  const path = usePathname();
  return (
    <div key={path} aria-hidden className="route-bar">
      <svg viewBox="0 0 1000 4" preserveAspectRatio="none"><path d="M0 2H1000" pathLength={1} /></svg>
    </div>
  );
}
