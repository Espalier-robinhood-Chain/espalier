// Satu siklus keeper untuk satu lane, tanpa loop: dipanggil cron (route Vercel yang dipicu pg_cron).
//   spur, graft          : keeper round mingguan (createSpurRuntime + runSpurOnce), mode dari SPUR_MODE / GRAFT_MODE.
//   cordon, cordon1, cordon2 : pruning Cordon (CORDON_VAULT_ADDRESS, lalu EXTRA_CORDONS urutan 1 dan 2), mode dari KEEPER_MODE.
// Memakai kode yang sama dengan main.ts: keadaan dibaca dari chain, dan tidak ada transaksi dikirim sebelum lolos simulasi.
// Hanya testnet: mode live di mainnet (4663) ditolak dari jalur ini.
import { createKeeperChain, createKeeperStore, createLiveExecutor, dryRunExecutor, readCordonLabel } from "./adapters.ts";
import { loadConfig } from "./config.ts";
import { describeCordonOutcome, describeOutcome, keeperEnv, safeText } from "./outcome.ts";
import { runOnce } from "./run.ts";
import { createHttpQuoteSource, createSpurRuntime, createSpurStore } from "./spur-adapters.ts";
import { runSpurOnce } from "./spur-run.ts";

export type Lane = "spur" | "graft" | "cordon" | "cordon1" | "cordon2";
export const LANES: readonly Lane[] = ["spur", "graft", "cordon", "cordon1", "cordon2"];
/** Urutan Cordon sama dengan cfg.cordons: [CORDON_VAULT_ADDRESS, ...EXTRA_CORDONS]. */
const CORDON_INDEX: Partial<Record<Lane, number>> = { cordon: 0, cordon1: 1, cordon2: 2 };
export interface KeeperResult { lane: string; ok: boolean; kind: string; mode?: string; line: string; txHash?: string; ms: number }

export async function runKeeperOnce(env: Record<string, string | undefined>, lane: Lane): Promise<KeeperResult> {
  const t0 = Date.now();
  const res = (r: Omit<KeeperResult, "lane" | "ms">): KeeperResult => ({ lane, ms: Date.now() - t0, ...r });
  try {
    const cfg = loadConfig(keeperEnv(env));

    const ci = CORDON_INDEX[lane];
    if (ci !== undefined) {
      const vault = cfg.cordons[ci];
      if (!vault) return res({ ok: true, kind: "skipped", line: `${lane} tidak dikonfigurasi (CORDON_VAULT_ADDRESS / EXTRA_CORDONS tidak punya Cordon ke-${ci + 1})` });
      if (cfg.mode === "live" && cfg.chainId === 4663) return res({ ok: false, kind: "refused", mode: cfg.mode, line: "keeper live dari cron ditolak di mainnet (4663); pakai worker dengan KMS" });
      const label = await readCordonLabel(cfg.rpcUrl, vault);
      const chain = await createKeeperChain(cfg.rpcUrl, vault, cfg.chainId);
      const exec = cfg.mode === "live" ? await createLiveExecutor(cfg.rpcUrl, vault, cfg.chainId, cfg.privateKey!) : dryRunExecutor;
      const store = createKeeperStore(cfg.supabaseUrl, cfg.serviceKey, vault, label);
      const kc = { thresholdBps: cfg.thresholdBps, minIntervalDays: cfg.minIntervalDays, slippageBps: cfg.slippageBps, minTradeUsdE18: BigInt(cfg.minTradeUsd) * 10n ** 18n, maxTrades: cfg.maxTrades };
      const o = await runOnce(chain, exec, store, kc);
      return res({ ...describeCordonOutcome(label, o), mode: cfg.mode });
    }

    const sc = lane === "spur" ? cfg.spur : cfg.graft;
    if (!sc) return res({ ok: true, kind: "skipped", line: `${lane} tidak dikonfigurasi (env ${lane.toUpperCase()}_VAULT_ADDRESS kosong)` });
    if (sc.mode === "live" && cfg.chainId === 4663) return res({ ok: false, kind: "refused", mode: sc.mode, line: "keeper live dari cron ditolak di mainnet (4663); pakai worker dengan KMS" });
    const rt = await createSpurRuntime({ rpcUrl: cfg.rpcUrl, chainId: cfg.chainId, vault: sc.vault, mode: sc.mode, keeperAddress: sc.keeperAddress ?? undefined, privateKey: sc.privateKey ?? undefined, kind: lane as "spur" | "graft" });
    const rfqCfg = cfg.spur ?? cfg.graft; // RFQ dan kunci dipakai bersama (sama dengan main.ts)
    const rfq = rfqCfg?.rfqUrl ? createHttpQuoteSource(rfqCfg.rfqUrl, rfqCfg.rfqToken, rfqCfg.rfqTimeoutMs) : null;
    const store = createSpurStore(cfg.supabaseUrl, cfg.serviceKey);
    const o = await runSpurOnce(rt.chain, rt.executor, rfq, store);
    const d = describeOutcome(lane, o);
    return res({ ...d, mode: sc.mode, line: `${d.line}${rfq ? "" : " [RFQ tidak dikonfigurasi: fill dilewati]"}` });
  } catch (e) {
    return res({ ok: false, kind: "error", line: `galat: ${safeText(e)}` });
  }
}
