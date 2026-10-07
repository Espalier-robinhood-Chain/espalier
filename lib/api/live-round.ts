// Server saja. Round yang sedang berjalan dibaca LANGSUNG dari kontrak (eth_call), tanpa menunggu indexer.
// Alasannya: indexer membaca event lewat eth_getLogs (lambat di RPC gratis), sedangkan eth_call tidak terkena batas rentang blok.
// Kontrak = sumber kebenaran; database tetap dipakai untuk riwayat, APY, dan sebagai cadangan bila RPC gagal.
import { graftVaultAbi, spurVaultAbi } from "@espalier/sdk";
import { createPublicClient, erc20Abi, getAddress, http, type PublicClient } from "viem";
import { web3Env } from "@/lib/web3/env";
import { liveRoundRow, type LiveRound } from "./live-round-map";

type VaultRef = { id: string; address: string; kind: "spur" | "graft" };

const TTL_MS = 5_000; // cukup pendek agar round baru langsung terlihat, cukup panjang agar RPC tidak dibanjiri
const TIMEOUT_MS = 4_000; // RPC lambat tidak boleh menahan halaman
type Entry = { at: number; value: Promise<LiveRound | null | undefined> };
const cache = new Map<string, Entry>();
const decimalsCache = new Map<string, { notional: number; premium: number }>();

const rpcFor = (chainId: number): string | undefined =>
  process.env.LIVE_RPC_URL?.trim() || (chainId === 4663 ? web3Env.mainnetRpc : chainId === 46630 ? web3Env.testnetRpc : undefined);

async function decimalsOf(client: PublicClient, vault: `0x${string}`, kind: "spur" | "graft") {
  const hit = decimalsCache.get(vault);
  if (hit) return hit;
  // Sama dengan indexer (spur-chain.ts): notional = desimal ASSET (Spur) atau UNDERLYING (Graft); premium = desimal PREMIUM.
  const notionalToken = kind === "graft"
    ? await client.readContract({ address: vault, abi: graftVaultAbi, functionName: "UNDERLYING" })
    : await client.readContract({ address: vault, abi: spurVaultAbi, functionName: "ASSET" });
  const premiumToken = await client.readContract({ address: vault, abi: spurVaultAbi, functionName: "PREMIUM" });
  const [notional, premium] = await Promise.all([
    client.readContract({ address: notionalToken, abi: erc20Abi, functionName: "decimals" }),
    client.readContract({ address: premiumToken, abi: erc20Abi, functionName: "decimals" }),
  ]);
  const out = { notional: Number(notional), premium: Number(premium) };
  decimalsCache.set(vault, out); // desimal token tidak berubah
  return out;
}

async function read(v: VaultRef): Promise<LiveRound | null | undefined> {
  const target = v.kind === "graft" ? web3Env.graft : web3Env.spur;
  // Hanya vault yang dikonfigurasi di env web (NEXT_PUBLIC_*_VAULT_ADDRESS) dan cocok dengan baris database.
  if (!target || target.address.toLowerCase() !== v.address.toLowerCase()) return undefined;
  const rpc = rpcFor(target.chainId);
  if (!rpc) return undefined;
  const client = createPublicClient({ transport: http(rpc, { timeout: TIMEOUT_MS, retryCount: 0 }) }) as PublicClient;
  const address = getAddress(target.address);
  const abi = (v.kind === "graft" ? graftVaultAbi : spurVaultAbi) as typeof spurVaultAbi;
  const [active, round] = await Promise.all([
    client.readContract({ address, abi, functionName: "active" }),
    client.readContract({ address, abi, functionName: "round" }),
  ]);
  if (!active) return null; // kontrak bilang tidak ada round berjalan: itu jawabannya, bukan "tidak tahu"
  const [r, dec] = await Promise.all([
    client.readContract({ address, abi, functionName: "getRound", args: [round] }),
    decimalsOf(client, address, v.kind),
  ]);
  return liveRoundRow(
    { expiry: r.expiry, strikeE18: r.strikeE18, startPriceE18: r.startPriceE18, notional: r.notional, picker: r.picker, premium: r.premium, outcome: Number(r.outcome) },
    Number(round), v.id, dec.notional, dec.premium,
  );
}

/**
 * Round berjalan menurut kontrak untuk satu vault.
 *  - LiveRound : ada round berjalan (dipakai menggantikan data database)
 *  - null      : kontrak memastikan tidak ada round berjalan
 *  - undefined : tidak diketahui (vault tidak dikonfigurasi, RPC gagal atau lambat): pemanggil memakai database
 */
export async function liveCurrentRound(v: VaultRef): Promise<LiveRound | null | undefined> {
  const key = `${v.kind}:${v.address.toLowerCase()}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.value;
  const value = read(v).catch((e: unknown) => {
    console.warn(`live-round ${key}: ${e instanceof Error ? e.message.split("\n")[0] : String(e)}`);
    return undefined;
  });
  cache.set(key, { at: Date.now(), value });
  return value;
}