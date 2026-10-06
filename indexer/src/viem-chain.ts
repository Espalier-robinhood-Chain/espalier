import { cordonVaultAbi } from "@espalier/sdk";
import { createPublicClient, erc20Abi, getAddress, http, parseAbiItem, type PublicClient } from "viem";
import { lower } from "./decimal.ts";
import type { Chain, NavReading, TransferLog, VaultMeta } from "./sync.ts";

const transferEvent = parseAbiItem("event Transfer(address indexed from, address indexed to, uint256 value)");

export async function createViemChain(rpcUrl: string, vault: `0x${string}`, expectChainId: number): Promise<Chain> {
  const client = createPublicClient({ transport: http(rpcUrl, { retryCount: 3 }) }) as PublicClient;
  const actual = await client.getChainId();
  if (actual !== expectChainId) throw new Error(`RPC chain ${actual} != INDEXER_CHAIN_ID ${expectChainId}`);
  const address = getAddress(vault);
  const base = { address, abi: cordonVaultAbi } as const;

  return {
    head: () => client.getBlockNumber(),
    async blockTimestamp(block) {
      const b = await client.getBlock({ blockNumber: block });
      return new Date(Number(b.timestamp) * 1000);
    },
    async meta(): Promise<VaultMeta> {
      const [name, symbol, decimals, components, weights] = await Promise.all([
        client.readContract({ ...base, functionName: "name" }),
        client.readContract({ ...base, functionName: "symbol" }),
        client.readContract({ ...base, functionName: "decimals" }),
        client.readContract({ ...base, functionName: "components" }),
        client.readContract({ ...base, functionName: "targetWeightsBps" }),
      ]);
      const tickers = await Promise.all(components.map((token) => client.readContract({ address: token, abi: erc20Abi, functionName: "symbol" })));
      return { address, name, symbol, decimals, components: components.map((token, i) => ({ token, ticker: tickers[i]!, weightBps: Number(weights[i]) })) };
    },
    async transfers(from, to): Promise<TransferLog[]> {
      const logs = await client.getLogs({ address, event: transferEvent, fromBlock: from, toBlock: to });
      return logs.map((l) => ({ from: lower(l.args.from!), to: lower(l.args.to!), block: l.blockNumber }));
    },
    async balances(accounts, block) {
      const out = new Map<string, bigint>();
      await Promise.all(accounts.map(async (a) => {
        out.set(lower(a), await client.readContract({ ...base, functionName: "balanceOf", args: [getAddress(a)], blockNumber: block }));
      }));
      return out;
    },
    async nav(block): Promise<NavReading> {
      const [[ok, totalValueE18, navPerShareE18], totalSupply] = await Promise.all([
        client.readContract({ ...base, functionName: "tryNav", blockNumber: block }),
        client.readContract({ ...base, functionName: "totalSupply", blockNumber: block }),
      ]);
      return { ok, totalValueE18, navPerShareE18, totalSupply };
    },
  };
}
