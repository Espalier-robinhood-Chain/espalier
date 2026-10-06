import { cordonVaultAbi, oracleRouterAbi } from "@espalier/sdk";
import { createClient } from "@supabase/supabase-js";
import { createPublicClient, erc20Abi, getAddress, http, type PublicClient } from "viem";
import type { Holding } from "./plan.ts";
import type { Executor, KeeperChain, KeeperStore } from "./run.ts";

export async function createKeeperChain(rpcUrl: string, vault: `0x${string}`, expectChainId: number): Promise<KeeperChain> {
  const client = createPublicClient({ transport: http(rpcUrl, { retryCount: 3 }) }) as PublicClient;
  const actual = await client.getChainId();
  if (actual !== expectChainId) throw new Error(`RPC chain ${actual} != KEEPER_CHAIN_ID ${expectChainId}`);
  const base = { address: getAddress(vault), abi: cordonVaultAbi } as const;
  return {
    async snapshot() {
      const [components, weights, balances, router] = await Promise.all([
        client.readContract({ ...base, functionName: "components" }),
        client.readContract({ ...base, functionName: "targetWeightsBps" }),
        client.readContract({ ...base, functionName: "balances" }),
        client.readContract({ ...base, functionName: "ROUTER" }),
      ]);
      let pricesLive = true;
      const holdings: Holding[] = await Promise.all(components.map(async (token, i) => {
        const [decimals, ticker, price] = await Promise.all([
          client.readContract({ address: token, abi: erc20Abi, functionName: "decimals" }),
          client.readContract({ address: token, abi: erc20Abi, functionName: "symbol" }),
          client.readContract({ address: router, abi: oracleRouterAbi, functionName: "tryGetPrice", args: [token] }),
        ]);
        const [status, priceE18] = price;
        if (status !== 0) pricesLive = false; // 0 = Status.Ok; selain itu (pasar tutup, basi, dijeda) = tidak live
        return { token: token.toLowerCase(), ticker, decimals, balance: balances[i]!, priceE18: status === 0 ? priceE18 : 0n, targetBps: Number(weights[i]) };
      }));
      return { holdings, pricesLive };
    },
  };
}

/** Hanya mencatat rencana; tidak mengirim apa pun. Satu-satunya eksekutor sampai kontrak punya fungsi pruning. */
export const dryRunExecutor: Executor = {
  mode: "dry-run",
  async execute() { throw new Error("dry-run executor tidak mengirim transaksi"); },
};

export function createKeeperStore(url: string, serviceKey: string, vault: string): KeeperStore {
  const db = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const check = (what: string, error: { message: string } | null) => { if (error) throw new Error(`${what}: ${error.message}`); };
  let cordonId: string | undefined;
  const id = async () => {
    if (cordonId) return cordonId;
    const { data, error } = await db.from("cordons").select("id").eq("address", vault.toLowerCase()).maybeSingle();
    check("cari cordon", error);
    if (!data) throw new Error("cordon belum ada di database: jalankan indexer dulu");
    return (cordonId = data.id as string);
  };
  return {
    async lastPruningAt() {
      const { data, error } = await db.from("prunings").select("ts").eq("cordon_id", await id()).order("ts", { ascending: false }).limit(1).maybeSingle();
      check("baca prunings", error);
      return data ? new Date(data.ts as string) : null;
    },
    async startRun() {
      const { data, error } = await db.from("keeper_runs").insert({ job: "prune", status: "running" }).select("id").single();
      check("keeper_runs insert", error);
      return Number(data!.id);
    },
    async finishRun(runId, r) {
      const { error } = await db.from("keeper_runs").update({ status: r.status, finished_at: new Date().toISOString(), tx_hash: r.txHash?.toLowerCase() ?? null, error: r.error ?? null }).eq("id", runId);
      check("keeper_runs update", error);
    },
    async recordPruning(p) {
      const { error } = await db.from("prunings").upsert({ cordon_id: await id(), ts: p.ts, drift_before_bps: p.driftBeforeBps, drift_after_bps: p.driftAfterBps, trades: p.trades, tx_hash: p.txHash.toLowerCase() }, { onConflict: "cordon_id,ts" });
      check("upsert prunings", error);
    },
  };
}
