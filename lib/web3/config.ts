import { WagmiAdapter } from "@reown/appkit-adapter-wagmi";
import { createAppKit } from "@reown/appkit/react";
import { activeChain } from "./chains";
import { web3Env } from "./env";

// ssr: true tanpa cookieStorage: layout akar tidak perlu membaca headers(), jadi halaman statis (/docs, /terms, dst.) tetap statis.
// Akibatnya status koneksi dipulihkan setelah mount (tombol sempat tampil "Connect wallet" sesaat).
// Tanpa NEXT_MODE (atau tanpa project ID) tidak ada adapter: situs berjalan sebagai simulasi tanpa wallet.
export const wagmiAdapter = web3Env.projectId && activeChain
  ? new WagmiAdapter({ ssr: true, projectId: web3Env.projectId, networks: [activeChain] })
  : null;

if (wagmiAdapter && web3Env.projectId && activeChain) {
  createAppKit({
    adapters: [wagmiAdapter],
    projectId: web3Env.projectId,
    networks: [activeChain],
    defaultNetwork: activeChain,
    metadata: {
      name: "Espalier",
      description: "Plant stocks. Train them. Harvest weekly.",
      url: web3Env.siteUrl, // harus sama dengan domain situs, kalau tidak Reown menolak/menandai
      icons: [],
    },
    // Privasi: /privacy menyatakan tanpa analitik. Fitur email, sosial, onramp, dan swap tidak dipakai.
    features: { analytics: false, email: false, socials: false, onramp: false, swaps: false },
    themeVariables: { "--w3m-font-family": "var(--font-inter), system-ui, sans-serif", "--w3m-border-radius-master": "2px" },
  });
}
