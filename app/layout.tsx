import type { Metadata } from "next";
import localFont from "next/font/local";
import { Providers } from "@/components/providers";
import { RouteBar } from "@/components/route-bar";
import { web3Env } from "@/lib/web3/env";
import "./globals.css";

const fraunces = localFont({ src: "./fonts/fraunces-latin-wght-normal.woff2", variable: "--font-fraunces", weight: "100 900", display: "swap" });
const inter = localFont({ src: "./fonts/inter-latin-wght-normal.woff2", variable: "--font-inter", weight: "100 900", display: "swap" });
const jetbrains = localFont({ src: "./fonts/jetbrains-mono-latin-wght-normal.woff2", variable: "--font-jetbrains", weight: "100 800", display: "swap", preload: false });

// URL situs salah ketik tidak boleh menjatuhkan seluruh situs: kembali ke localhost.
function siteBase() {
  try { return new URL(web3Env.siteUrl); } catch { return new URL("http://localhost:3000"); }
}

export const metadata: Metadata = {
  // metadataBase: tanpa ini URL gambar OG tidak absolut (platform sosial menolaknya). Sama dengan domain situs.
  metadataBase: siteBase(),
  title: "Espalier",
  description: "Plant stocks. Train them. Harvest weekly.",
  openGraph: { siteName: "Espalier", type: "website" },
  twitter: { card: "summary_large_image" },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning className={`${fraunces.variable} ${inter.variable} ${jetbrains.variable}`}>
      <head><script dangerouslySetInnerHTML={{ __html: 'document.documentElement.classList.add("js");try{var t=localStorage.getItem("theme");if(t)document.documentElement.dataset.theme=t}catch(e){}' }} /></head>
      <body className="font-sans antialiased">
        <RouteBar />
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
