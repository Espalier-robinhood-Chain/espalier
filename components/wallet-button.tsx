"use client";

import { useAppKit } from "@reown/appkit/react";
import { useAccount } from "wagmi";
import { shortAddr } from "@/lib/format";
import { web3Enabled, web3Env } from "@/lib/web3/env";
import { Badge, Button } from "./ui";

// Tombol primer ringkas seperti .wallet di espalier.html (padding 8px 16px, 0.86rem).
const compact = "!px-4 !text-[.86rem]";

// Hanya dirender bila web3Enabled (nilainya konstan per build), jadi hook wagmi selalu punya WagmiProvider.
function ConnectedWalletButton() {
  const { open } = useAppKit();
  const { address, isConnected, status, chain } = useAccount();

  if (status === "connecting" || status === "reconnecting") {
    return <Button type="button" disabled aria-busy="true" className={compact}>Connecting…</Button>;
  }
  if (isConnected && address) {
    if (!chain) {
      // Jaringan wallet bukan Robinhood Chain: bukan hanya warna, ada ikon dan teks.
      return <Button type="button" variant="ghost" onClick={() => open({ view: "Networks" })} className={compact}><span aria-hidden>△&nbsp;</span>Wrong network</Button>;
    }
    return (
      <Button type="button" variant="ghost" className={`${compact} !border-wire font-mono !text-ink hover:!border-bark`} onClick={() => open({ view: "Account" })} aria-label={`Wallet ${address}. Open account`}>
        <span aria-hidden className="size-2 rounded-full bg-fruit" />{shortAddr(address)}
      </Button>
    );
  }
  return <Button type="button" onClick={() => open()} className={compact}>Connect<span className="max-[480px]:hidden"> wallet</span></Button>;
}

export function WalletButton() {
  if (!web3Enabled) {
    // NEXT_MODE kosong = simulasi yang disengaja: tidak ada yang perlu dihubungkan, jadi bukan tombol mati.
    if (!web3Env.mode) {
      return <span title="Simulation mode: no wallet needed and no transaction is sent."><Badge className="!px-3 !py-1.5 !text-[.8rem]">Simulation<span className="max-[480px]:hidden"> mode</span></Badge></span>;
    }
    // NEXT_MODE terisi tapi konfigurasinya belum lengkap (project ID, atau RPC testnet): ini salah konfigurasi.
    return <Button type="button" disabled title="Wallet connection is not configured in this build." className={compact}>Connect<span className="max-[480px]:hidden"> wallet</span></Button>;
  }
  return <ConnectedWalletButton />;
}
