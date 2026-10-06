"use client";

import { useAppKit } from "@reown/appkit/react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { createSiweMessage } from "viem/siwe";
import { useAccount, useSignMessage } from "wagmi";
import { Button } from "./ui";
import { buildSiweRequest } from "@/lib/auth/siwe";
import { shortAddr } from "@/lib/format";
import { createClient } from "@/lib/supabase/client";
import { hasSupabaseEnv } from "@/lib/supabase/env";
import { robinhoodMainnet } from "@/lib/web3/chains";
import { web3Enabled } from "@/lib/web3/env";

// Login wallet (Supabase Auth Web3, EIP-4361) dan pilihan privasi The Wall.
// Tanda tangan hanya membuktikan alamat: tanpa transaksi, tanpa gas. Sesi disimpan Supabase di cookie
// (lihat /privacy). Keputusan akses yang sesungguhnya ada di database (RLS) dan di Route Handler, bukan di sini.
type Props = {
  signedInAs: string | null; // alamat (huruf kecil) dari sesi di server; null bila belum login
  isPrivate: boolean | null; // pilihan tersimpan untuk signedInAs; null bila belum login
};
type Note = { tone: "ok" | "error"; text: string };

function describe(e: unknown): string {
  console.error(e);
  const msg = e instanceof Error ? `${e.name} ${e.message}` : "";
  if (/reject|denied|cancel/i.test(msg)) return "Signing was cancelled. Nothing was sent.";
  // Galat dari Supabase Auth (AuthApiError) membawa `code`/`status`. Dua penyebab pengaturan yang paling umum diberi pesan sendiri.
  const code = typeof e === "object" && e !== null && "code" in e && typeof e.code === "string" ? e.code : "";
  const detail = `${code} ${msg}`;
  if (/web3_provider_disabled|web3.*disabled|provider is disabled/i.test(detail)) return "Wallet sign-in is not switched on for this site yet.";
  if (/redirect|invalid (uri|domain)|\bdomain\b/i.test(detail)) return "This site's address is not allowed for wallet sign-in yet.";
  return `Sign-in did not work${code ? ` (${code})` : ""}. Try again in a moment.`;
}

function Connected({ signedInAs, isPrivate }: Props) {
  const router = useRouter();
  const { open } = useAppKit();
  const { address, isConnected, chainId } = useAccount();
  const { signMessageAsync } = useSignMessage();
  const [busy, setBusy] = useState<"in" | "out" | "save" | null>(null);
  const [note, setNote] = useState<Note | null>(null);
  const [priv, setPriv] = useState(isPrivate ?? true);

  const signedHere = signedInAs !== null && address !== undefined && signedInAs === address.toLowerCase();

  async function signIn() {
    if (!address) return;
    setBusy("in");
    setNote(null);
    try {
      const req = buildSiweRequest({ address, chainId: chainId ?? robinhoodMainnet.id, origin: window.location.origin, now: new Date() });
      const message = createSiweMessage({
        address: req.address as `0x${string}`,
        chainId: req.chainId,
        domain: req.domain,
        nonce: req.nonce,
        uri: req.uri,
        version: req.version,
        statement: req.statement,
        issuedAt: req.issuedAt,
      });
      const signature = await signMessageAsync({ message });
      const { error } = await createClient().auth.signInWithWeb3({ chain: "ethereum", message, signature });
      if (error) throw error;
      router.refresh();
    } catch (e) {
      setNote({ tone: "error", text: describe(e) });
    } finally {
      setBusy(null);
    }
  }

  async function signOut() {
    setBusy("out");
    setNote(null);
    try {
      const { error } = await createClient().auth.signOut({ scope: "local" });
      if (error) throw error;
      router.refresh();
    } catch (e) {
      console.error(e);
      setNote({ tone: "error", text: "Sign-out did not work. Try again in a moment." });
    } finally {
      setBusy(null);
    }
  }

  async function save(next: boolean) {
    const before = priv;
    setPriv(next);
    setBusy("save");
    setNote(null);
    try {
      const res = await fetch("/api/me/wall-privacy", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ private: next }),
      });
      if (!res.ok) throw new Error(`wall-privacy ${res.status}`);
      setNote({ tone: "ok", text: "Saved." });
      router.refresh();
    } catch (e) {
      console.error(e);
      setPriv(before);
      setNote({ tone: "error", text: "Could not save. Your choice was not changed." });
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-4">
      {!isConnected || !address ? (
        <>
          <p className="text-bark">Connect a wallet to sign in. Signing proves the address is yours. It sends no transaction and costs no gas.</p>
          <Button type="button" onClick={() => open()}>Connect wallet</Button>
        </>
      ) : signedHere ? (
        <>
          <p className="text-sm text-bark">Signed in as <span className="font-mono text-ink">{shortAddr(signedInAs)}</span>.</p>
          <label className="flex items-start gap-3">
            <input
              type="checkbox"
              checked={priv}
              disabled={busy !== null}
              onChange={(e) => save(e.target.checked)}
              aria-describedby="wall-privacy-help"
              className="mt-1 size-5 shrink-0 accent-[var(--leaf)]"
            />
            <span>
              <span className="font-medium">Keep my Wall private</span>
              <span id="wall-privacy-help" className="block text-sm text-bark">
                {priv ? "Only you can open it, while signed in with this wallet." : "Anyone who has your address can open it."}
              </span>
            </span>
          </label>
          <Button type="button" variant="ghost" onClick={signOut} disabled={busy !== null}>Sign out</Button>
        </>
      ) : (
        <>
          <p className="text-bark">
            Connected: <span className="font-mono text-ink">{shortAddr(address)}</span>.{" "}
            {signedInAs ? <>You are signed in as <span className="font-mono text-ink">{shortAddr(signedInAs)}</span>, a different wallet.</> : "You are not signed in."}{" "}
            Signing is free and sends no transaction.
          </p>
          <div className="flex flex-wrap gap-2">
            <Button type="button" onClick={signIn} disabled={busy !== null} aria-busy={busy === "in"}>
              {busy === "in" ? "Waiting for your wallet…" : "Sign in with this wallet"}
            </Button>
            {signedInAs && <Button type="button" variant="ghost" onClick={signOut} disabled={busy !== null}>Sign out</Button>}
          </div>
        </>
      )}
      <div aria-live="polite">
        {note && (
          <p role={note.tone === "error" ? "alert" : undefined} className={`text-sm ${note.tone === "error" ? "text-blight" : "text-bark"}`}>
            {note.tone === "error" && <span aria-hidden>△ </span>}
            {note.text}
          </p>
        )}
      </div>
    </div>
  );
}

// Dua flag ini konstan per build, jadi hook wagmi hanya dipanggil bila WagmiProvider pasti ada.
export function WallAccount(props: Props) {
  if (!hasSupabaseEnv) return <p className="text-bark">Sign-in is not set up in this preview.</p>;
  if (!web3Enabled) return <p className="text-bark">Wallet connection is not set up in this preview, so sign-in is not available.</p>;
  return <Connected {...props} />;
}