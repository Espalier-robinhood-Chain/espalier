"use client";

import { useAccount } from "wagmi";
import { ButtonLink } from "./ui";
import { shortAddr } from "@/lib/format";
import { web3Enabled } from "@/lib/web3/env";

// Alamat wallet yang terhubung menjadi kunci The Wall. Read-only: tidak ada tanda tangan atau transaksi.
// Sengaja berupa tautan, bukan redirect otomatis: alamat baru masuk URL (dan log hosting) bila pengguna memilihnya.
function ConnectedWallLink({ current }: { current: string }) {
  const { address, isConnected } = useAccount();
  if (!isConnected || !address || address.toLowerCase() === current.toLowerCase()) return null;
  return <ButtonLink href={`/wall?address=${address}`} variant="ghost">Open my garden · {shortAddr(address)}</ButtonLink>;
}

export function WallWallet({ current }: { current: string }) {
  return web3Enabled ? <ConnectedWallLink current={current} /> : null;
}
