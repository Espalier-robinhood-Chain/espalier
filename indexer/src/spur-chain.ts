import { createPublicClient, erc20Abi, getAddress, http, type PublicClient } from "viem";
import { lower } from "./decimal.ts";
import { SPUR_EVENT_SIGNATURES, spurVaultAbi } from "./spur-abi.ts";
import type { SpurEvent } from "./spur-ledger.ts";
import type { OnchainRound, SpurChain, SpurMeta } from "./spur-sync.ts";
import { parseAbi } from "viem";

const events = parseAbi([...SPUR_EVENT_SIGNATURES]);

/** `kind` "graft" memakai ABI/event yang sama (GraftVault mencerminkan SpurVault), tetapi meta-nya membaca `UNDERLYING`. */
export async function createSpurChain(rpcUrl: string, vault: `0x${string}`, expectChainId: number, kind: "spur" | "graft" = "spur"): Promise<SpurChain> {
  // cacheTime 0: viem menyimpan getBlockNumber 4 detik secara bawaan; kursor indexer harus mengikuti kepala chain, bukan cache.
  const client = createPublicClient({ transport: http(rpcUrl, { retryCount: 3 }), cacheTime: 0 }) as PublicClient;
  const actual = await client.getChainId();
  if (actual !== expectChainId) throw new Error(`RPC chain ${actual} != INDEXER_CHAIN_ID ${expectChainId}`);
  const address = getAddress(vault);
  const base = { address, abi: spurVaultAbi } as const;

  return {
    head: () => client.getBlockNumber(),
    async blockTimestamp(block) {
      const b = await client.getBlock({ blockNumber: block });
      return new Date(Number(b.timestamp) * 1000);
    },
    async meta(): Promise<SpurMeta> {
      const [asset, premium] = await Promise.all([client.readContract({ ...base, functionName: "ASSET" }), client.readContract({ ...base, functionName: "PREMIUM" })]);
      const [assetSymbol, assetDecimals, premiumDecimals] = await Promise.all([
        client.readContract({ address: asset, abi: erc20Abi, functionName: "symbol" }),
        client.readContract({ address: asset, abi: erc20Abi, functionName: "decimals" }),
        client.readContract({ address: premium, abi: erc20Abi, functionName: "decimals" }),
      ]);
      if (kind === "graft") {
        const underlying = await client.readContract({ ...base, functionName: "UNDERLYING" });
        const [underlyingSymbol, underlyingDecimals] = await Promise.all([
          client.readContract({ address: underlying, abi: erc20Abi, functionName: "symbol" }),
          client.readContract({ address: underlying, abi: erc20Abi, functionName: "decimals" }),
        ]);
        return { address, kind, assetSymbol, assetDecimals, premiumDecimals, shareDecimals: 18, underlyingSymbol, notionalDecimals: underlyingDecimals };
      }
      return { address, kind, assetSymbol, assetDecimals, premiumDecimals, shareDecimals: 18 }; // share vault berskala WAD (SpurVault)
    },
    async events(from, to): Promise<SpurEvent[]> {
      const logs = await client.getLogs({ address, events, fromBlock: from, toBlock: to });
      const out: SpurEvent[] = [];
      for (const l of logs) {
        if (l.blockNumber === null || l.logIndex === null) continue; // log pending: tidak terjadi di blok aman
        const pos = { block: l.blockNumber, logIndex: l.logIndex };
        const a = l.args as Record<string, unknown>;
        const acc = () => lower(a.account as string);
        switch (l.eventName) {
          case "Deposited": out.push({ ...pos, type: "Deposited", account: acc(), amount: a.amount as bigint }); break;
          case "DepositCancelled": out.push({ ...pos, type: "DepositCancelled", account: acc(), amount: a.amount as bigint }); break;
          case "WithdrawRequested": out.push({ ...pos, type: "WithdrawRequested", account: acc(), shares: a.shares as bigint }); break;
          case "WithdrawCancelled": out.push({ ...pos, type: "WithdrawCancelled", account: acc(), shares: a.shares as bigint }); break;
          case "RoundStarted": out.push({ ...pos, type: "RoundStarted", round: Number(a.round), ppsStart: a.ppsStart as bigint, totalShares: a.totalShares as bigint }); break;
          case "RoundSkipped": out.push({ ...pos, type: "RoundSkipped", round: Number(a.round), ppsStart: a.ppsStart as bigint }); break;
          case "RoundSold": out.push({ ...pos, type: "RoundSold", round: Number(a.round), picker: lower(a.picker as string), premium: a.premium as bigint }); break;
          case "RoundSettled": out.push({ ...pos, type: "RoundSettled", round: Number(a.round) }); break;
          case "RoundClosedUnsold": out.push({ ...pos, type: "RoundClosedUnsold", round: Number(a.round) }); break;
          case "PremiumClaimed": out.push({ ...pos, type: "PremiumClaimed", account: acc(), amount: a.amount as bigint }); break;
        }
      }
      return out;
    },
    async round(n, block): Promise<OnchainRound> {
      const r = await client.readContract({ ...base, functionName: "getRound", args: [BigInt(n)], blockNumber: block });
      return { ...r, picker: lower(r.picker) };
    },
    async sharesOf(accounts, block) {
      const out = new Map<string, bigint>();
      await Promise.all(accounts.map(async (a) => {
        out.set(lower(a), await client.readContract({ ...base, functionName: "sharesOf", args: [getAddress(a)], blockNumber: block }));
      }));
      return out;
    },
  };
}
