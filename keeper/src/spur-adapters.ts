import { createClient } from "@supabase/supabase-js";
import { BaseError, ContractFunctionRevertedError, createPublicClient, createWalletClient, getAddress, http, type Account, type Address, type PublicClient } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { aggregatorAbi, harvestAuctionAbi, KEEPER_ROLE, routerFeedAbi, settlementOracleAbi, spurVaultAbi } from "./spur-abi.ts";
import type { FeedReader } from "./spur-plan.ts";
import type { Hex, QuoteRequest, QuoteSource, RawQuote, RoundTerms, SpurCall, SpurChain, SpurExecutor, SpurStore } from "./spur-run.ts";

const ZERO = "0x0000000000000000000000000000000000000000";

/** Alasan singkat dari galat viem (revert kontrak dipisahkan dari galat jaringan lewat pesan yang sama pendek). */
function reasonOf(e: unknown): string {
  if (e instanceof BaseError) {
    const r = e.walk((x) => x instanceof ContractFunctionRevertedError);
    if (r instanceof ContractFunctionRevertedError) return r.data?.errorName ? `revert ${r.data.errorName}` : `revert ${r.reason ?? r.shortMessage}`;
    return e.shortMessage.slice(0, 300);
  }
  return (e instanceof Error ? e.message : String(e)).slice(0, 300);
}
const isRevert = (e: unknown) => e instanceof BaseError && e.walk((x) => x instanceof ContractFunctionRevertedError) !== null;

export interface SpurRuntime { chain: SpurChain; executor: SpurExecutor; account: Address }

/**
 * `kind` "graft": GraftVault mencerminkan SpurVault (fungsi keeper, lelang, dan settlement sama). Bedanya hanya token acuan harga:
 * Spur memakai ASSET (Stock Token yang disimpan vault), Graft memakai UNDERLYING (aset Graft = USDG, bukan acuan harga).
 */
export async function createSpurRuntime(o: { rpcUrl: string; chainId: number; vault: Address; mode: "dry-run" | "live"; keeperAddress?: Address; privateKey?: Hex; kind?: "spur" | "graft" }): Promise<SpurRuntime> {
  const transport = http(o.rpcUrl, { retryCount: 3 });
  const client = createPublicClient({ transport }) as PublicClient;
  const actual = await client.getChainId();
  if (actual !== o.chainId) throw new Error(`RPC chain ${actual} != KEEPER_CHAIN_ID ${o.chainId}`);

  const vault = getAddress(o.vault);
  const v = { address: vault, abi: spurVaultAbi } as const;
  const [asset, router, settlement, auction, fillWindow, minDuration, maxDuration] = await Promise.all([
    client.readContract({ ...v, functionName: "ASSET" }), client.readContract({ ...v, functionName: "ROUTER" }),
    client.readContract({ ...v, functionName: "SETTLEMENT" }), client.readContract({ ...v, functionName: "AUCTION" }),
    client.readContract({ ...v, functionName: "FILL_WINDOW" }), client.readContract({ ...v, functionName: "MIN_DURATION" }),
    client.readContract({ ...v, functionName: "MAX_DURATION" }),
  ]);
  // Token yang harganya dipakai untuk strike/settlement. Semua pemakaian di bawah (settlement, feed, settle) lewat `priceToken`.
  const priceToken: Address = o.kind === "graft" ? await client.readContract({ ...v, functionName: "UNDERLYING" }) : asset;
  const label = o.kind === "graft" ? "GraftVault" : "SpurVault";
  const a = { address: auction, abi: harvestAuctionAbi } as const;
  const s = { address: settlement, abi: settlementOracleAbi } as const;

  const account: Account = o.mode === "live" ? privateKeyToAccount(o.privateKey!) : { address: getAddress(o.keeperAddress!), type: "json-rpc" };
  if (o.mode === "live" && o.keeperAddress && getAddress(o.keeperAddress) !== account.address) throw new Error("KEEPER_ADDRESS tidak sama dengan alamat dari KEEPER_PRIVATE_KEY");

  // Peran dicek saat start: kunci tanpa peran hanya akan menghasilkan simulasi gagal berulang-ulang.
  const [onVault, onAuction] = await Promise.all([
    client.readContract({ ...v, functionName: "hasRole", args: [KEEPER_ROLE, account.address] }),
    client.readContract({ ...a, functionName: "hasRole", args: [KEEPER_ROLE, account.address] }),
  ]);
  if (!onVault) throw new Error(`${account.address} tidak punya KEEPER_ROLE di ${label} ${vault} (rollRound akan ditolak)`);
  if (!onAuction) throw new Error(`${account.address} tidak punya KEEPER_ROLE di HarvestAuction ${auction} (fill akan ditolak)`);

  let maxPrintDelay: bigint | undefined;
  const chain: SpurChain = {
    vault, auction, chainId: o.chainId,
    async snapshot() {
      const block = await client.getBlock({ blockTag: "latest" });
      const blockNumber = block.number;
      const [paused, active, round] = await Promise.all([
        client.readContract({ ...v, functionName: "paused", blockNumber }), client.readContract({ ...v, functionName: "active", blockNumber }),
        client.readContract({ ...v, functionName: "round", blockNumber }),
      ]);
      const current = round === 0n ? null : await client.readContract({ ...v, functionName: "getRound", args: [round], blockNumber });
      let settlementRecorded = false;
      if (active && current && current.picker !== ZERO && block.timestamp >= current.expiry) {
        settlementRecorded = (await client.readContract({ ...s, functionName: "settlement", args: [priceToken, current.expiry], blockNumber })).exists;
      }
      return {
        now: block.timestamp, paused, active, round, fillWindow: BigInt(fillWindow), minDuration: BigInt(minDuration), maxDuration: BigInt(maxDuration), settlementRecorded,
        current: current ? { start: current.start, expiry: current.expiry, picker: current.picker.toLowerCase(), outcome: current.outcome } : null,
      };
    },
    async roundTerms(round): Promise<RoundTerms> {
      const r = await client.readContract({ ...v, functionName: "getRound", args: [round] });
      return { strikeE18: r.strikeE18, expiry: r.expiry, notional: r.notional, minPremium: r.minPremium, start: r.start };
    },
    isPicker: (p) => client.readContract({ ...a, functionName: "isPicker", args: [getAddress(p)] }),
    async settlementContext() {
      const [feed] = await client.readContract({ address: router, abi: routerFeedAbi, functionName: "feedOf", args: [priceToken] });
      if (feed === ZERO) throw new Error(`router tidak punya feed untuk token acuan ${label}`);
      maxPrintDelay ??= BigInt(await client.readContract({ ...s, functionName: "MAX_PRINT_DELAY" }));
      const reader: FeedReader = {
        async latest() { const [id, , , updatedAt] = await client.readContract({ address: feed, abi: aggregatorAbi, functionName: "latestRoundData" }); return { id, updatedAt }; },
        async round(id) {
          try {
            const [, , , updatedAt] = await client.readContract({ address: feed, abi: aggregatorAbi, functionName: "getRoundData", args: [id] });
            return updatedAt === 0n ? null : { updatedAt };
          } catch (e) { if (isRevert(e)) return null; throw e; } // galat jaringan dilempar: jangan disamakan dengan "round tidak ada"
        },
      };
      return { feed: reader, maxPrintDelay };
    },
  };

  /** Parameter panggilan untuk simulateContract/writeContract. Expiry settlement dibaca dari round aktif di chain. */
  const request = async (c: SpurCall) => {
    switch (c.fn) {
      case "rollRound": return { address: vault, abi: spurVaultAbi, functionName: "rollRound", args: [c.expiry] } as const;
      case "closeUnsold": return { address: vault, abi: spurVaultAbi, functionName: "closeUnsold" } as const;
      case "settleRound": return { address: vault, abi: spurVaultAbi, functionName: "settleRound" } as const;
      case "fill": return { address: auction, abi: harvestAuctionAbi, functionName: "fill", args: [{ ...c.quote, vault: getAddress(c.quote.vault), picker: getAddress(c.quote.picker) }, c.signature] } as const;
      case "settle":
      case "settleFallback": {
        const round = await client.readContract({ ...v, functionName: "round" });
        const r = await client.readContract({ ...v, functionName: "getRound", args: [round] });
        return { address: settlement, abi: settlementOracleAbi, functionName: c.fn, args: [priceToken, r.expiry, c.roundId] } as const;
      }
    }
  };

  const wallet = o.mode === "live" ? createWalletClient({ account, transport }) : null;
  const executor: SpurExecutor = {
    mode: o.mode,
    async simulate(call) {
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await client.simulateContract({ ...(await request(call)), account } as any);
        return { ok: true };
      } catch (e) { return { ok: false, reason: reasonOf(e) }; }
    },
    async send(call) {
      if (!wallet) throw new Error("dry-run executor tidak mengirim transaksi");
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { request: req } = await client.simulateContract({ ...(await request(call)), account } as any);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const hash = await wallet.writeContract(req as any);
      const rc = await client.waitForTransactionReceipt({ hash });
      if (rc.status !== "success") throw new Error(`transaksi ${hash} revert di blok ${rc.blockNumber}`);
      return { txHash: hash, at: new Date() };
    },
  };
  return { chain, executor, account: account.address };
}

// ---------------------------------------------------------------------------------------------
// RFQ v0: POST JSON ke RFQ_URL, balasan { quotes: [{ picker, premium, deadline, signature }] } (angka sebagai string desimal).
// Keeper menyusun sisa isi quote sendiri dari state onchain, jadi layanan tidak bisa mengubah strike/expiry/notional.
// ---------------------------------------------------------------------------------------------
export const MAX_QUOTES = 32;
const MAX_SIG_HEX = 4096; // tanda tangan ERC-1271 (smart wallet) bisa panjang; EOA = 130 heks
const ADDR = /^0x[0-9a-fA-F]{40}$/, UINT = /^\d{1,78}$/, HEX = /^0x([0-9a-fA-F]{2})+$/;

export function parseQuotes(json: unknown): RawQuote[] {
  const list = (json as { quotes?: unknown } | null)?.quotes;
  if (!Array.isArray(list)) throw new Error("balasan RFQ: field `quotes` harus array");
  if (list.length > MAX_QUOTES) throw new Error(`balasan RFQ: lebih dari ${MAX_QUOTES} quote`);
  return list.map((q, i) => {
    const o = q as Record<string, unknown>;
    const picker = o?.picker, premium = String(o?.premium ?? ""), deadline = String(o?.deadline ?? ""), sig = o?.signature;
    if (typeof picker !== "string" || !ADDR.test(picker)) throw new Error(`quote[${i}].picker bukan alamat`);
    if (!UINT.test(premium) || !UINT.test(deadline)) throw new Error(`quote[${i}] premium/deadline harus bilangan bulat tak negatif`);
    if (typeof sig !== "string" || !HEX.test(sig) || sig.length > MAX_SIG_HEX + 2) throw new Error(`quote[${i}].signature bukan heks yang wajar`);
    if (BigInt(deadline) >= 1n << 64n) throw new Error(`quote[${i}].deadline melebihi uint64`);
    return { picker: getAddress(picker), premium: BigInt(premium), deadline: BigInt(deadline), signature: sig as Hex };
  });
}

export function createHttpQuoteSource(url: string, authToken: string | null, timeoutMs: number): QuoteSource {
  return {
    async fetch(req: QuoteRequest) {
      const body = JSON.stringify(req, (_k, v) => (typeof v === "bigint" ? v.toString() : v));
      const res = await fetch(url, {
        method: "POST", body, signal: AbortSignal.timeout(timeoutMs),
        headers: { "content-type": "application/json", ...(authToken ? { authorization: `Bearer ${authToken}` } : {}) },
      });
      if (!res.ok) throw new Error(`RFQ HTTP ${res.status}`);
      return parseQuotes(await res.json());
    },
  };
}

export function createSpurStore(url: string, serviceKey: string): SpurStore {
  const db = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const check = (what: string, error: { message: string } | null) => { if (error) throw new Error(`${what}: ${error.message}`); };
  return {
    async startRun(job) {
      const { data, error } = await db.from("keeper_runs").insert({ job, status: "running" }).select("id").single();
      check("keeper_runs insert", error);
      return Number(data!.id);
    },
    async finishRun(id, r) {
      const { error } = await db.from("keeper_runs").update({ status: r.status, finished_at: new Date().toISOString(), tx_hash: r.txHash?.toLowerCase() ?? null, error: r.error ?? null }).eq("id", id);
      check("keeper_runs update", error);
    },
  };
}
