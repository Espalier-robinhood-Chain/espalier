import type { NextConfig } from "next";

// @coinbase/cdp-sdk (dependensi transitif Reown AppKit lewat konektor Base Account) meng-import paket @x402/*,
// yang hanya optional peer dan tidak terpasang. Turbopack gagal me-resolve-nya dan `next build` berhenti.
// Modul-modul itu hanya dipakai untuk pembayaran x402 milik Coinbase SDK, yang tidak dipakai Espalier,
// jadi dialihkan ke modul kosong. Daftar diambil dari import di cdp-sdk 1.57.1; bila versinya naik dan build
// mengeluh "Can't resolve '@x402/...'", tambahkan spesifier-nya di sini. Jika x402 sungguhan dibutuhkan,
// pasang paketnya dan hapus alias ini.
const X402 = [
  "core/client",
  "core/schemas",
  "core/server",
  "evm",
  "evm/auth-capture/client",
  "evm/batch-settlement/client",
  "evm/exact/client",
  "evm/exact/server",
  "evm/exact/v1/client",
  "evm/upto/client",
  "evm/upto/server",
  "express",
  "extensions/bazaar",
  "extensions/builder-code",
  "fetch",
  "svm/exact/client",
  "svm/exact/server",
  "svm/exact/v1/client",
  "svm/upto/client",
  "svm/upto/server",
];
const stub = "./lib/stubs/empty-module.js";

const nextConfig: NextConfig = {
  // NEXT_MODE ("mainnet" | "testnet"; kosong = simulasi) dibaca juga oleh komponen klien. Nilainya di-inline saat build/dev start,
  // jadi setelah mengubahnya, restart `npm run dev` atau build ulang.
  env: { NEXT_MODE: process.env.NEXT_MODE ?? "" },
  turbopack: {
    resolveAlias: Object.fromEntries(X402.map((s) => [`@x402/${s}`, stub])),
  },
};

export default nextConfig;
