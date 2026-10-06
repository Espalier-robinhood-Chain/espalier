"use client";

import { useAppKitTheme } from "@reown/appkit/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { WagmiProvider, type Config } from "wagmi";
import { wagmiAdapter } from "@/lib/web3/config";

// Menyamakan tema modal Reown dengan ThemeToggle (data-theme) dan preferensi sistem.
function ThemeSync() {
  const { setThemeMode } = useAppKitTheme();
  useEffect(() => {
    const el = document.documentElement;
    const mq = matchMedia("(prefers-color-scheme: dark)");
    const apply = () => setThemeMode((el.dataset.theme ?? (mq.matches ? "dark" : "light")) === "dark" ? "dark" : "light");
    apply();
    const mo = new MutationObserver(apply);
    mo.observe(el, { attributes: true, attributeFilter: ["data-theme"] });
    mq.addEventListener("change", apply);
    return () => { mo.disconnect(); mq.removeEventListener("change", apply); };
  }, [setThemeMode]);
  return null;
}

export function Web3Provider({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(() => new QueryClient());
  if (!wagmiAdapter) return <>{children}</>; // NEXT_MODE atau NEXT_PUBLIC_REOWN_PROJECT_ID kosong: wallet connect mati (simulasi)
  return (
    <WagmiProvider config={wagmiAdapter.wagmiConfig as Config}>
      <QueryClientProvider client={queryClient}>
        {children}
        <ThemeSync />
      </QueryClientProvider>
    </WagmiProvider>
  );
}
