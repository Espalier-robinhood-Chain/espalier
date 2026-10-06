import { defineChain } from "@reown/appkit/networks";
import { web3Env } from "./env";

// Fakta chain dari checklist (bagian "Chain target"): mainnet 4663, testnet 46630, gas ETH, explorer Blockscout.
const eth = { name: "Ether", symbol: "ETH", decimals: 18 } as const;

export const robinhoodMainnet = defineChain({
  id: 4663,
  caipNetworkId: "eip155:4663",
  chainNamespace: "eip155",
  name: "Robinhood Chain",
  nativeCurrency: eth,
  rpcUrls: { default: { http: [web3Env.mainnetRpc] } },
  blockExplorers: { default: { name: "Blockscout", url: "https://robinhoodchain.blockscout.com" } },
});

// URL RPC publik testnet belum saya verifikasi, jadi testnet hanya aktif bila NEXT_PUBLIC_RH_RPC_TESTNET diisi.
export const robinhoodTestnet = web3Env.testnetRpc
  ? defineChain({
      id: 46630,
      caipNetworkId: "eip155:46630",
      chainNamespace: "eip155",
      name: "Robinhood Chain Testnet",
      nativeCurrency: eth,
      rpcUrls: { default: { http: [web3Env.testnetRpc] } },
      blockExplorers: { default: { name: "Blockscout", url: "https://explorer.testnet.chain.robinhood.com" } },
      testnet: true,
    })
  : null;

// Satu-satunya chain yang ditawarkan ke wallet, ditentukan NEXT_MODE. null = simulasi (atau testnet tanpa RPC).
export const activeChain = web3Env.mode === "mainnet" ? robinhoodMainnet : web3Env.mode === "testnet" ? robinhoodTestnet : null;
