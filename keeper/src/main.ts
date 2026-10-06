import { createKeeperChain, createKeeperStore, dryRunExecutor } from "./adapters.ts";
import { loadConfig } from "./config.ts";
import { runOnce } from "./run.ts";
import { createHttpQuoteSource, createSpurRuntime, createSpurStore } from "./spur-adapters.ts";
import { runSpurOnce, type SpurOutcome } from "./spur-run.ts";

const log = (m: string, x?: unknown) => console.log(`${new Date().toISOString()} ${m}`, x ?? "");
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const cfg = loadConfig(process.env);
const chain = await createKeeperChain(cfg.rpcUrl, cfg.vault, cfg.chainId);
const store = createKeeperStore(cfg.supabaseUrl, cfg.serviceKey, cfg.vault);
const kc = { thresholdBps: cfg.thresholdBps, minIntervalDays: cfg.minIntervalDays, slippageBps: cfg.slippageBps, minTradeUsdE18: BigInt(cfg.minTradeUsd) * 10n ** 18n, maxTrades: cfg.maxTrades };
log(`keeper siap (mode ${cfg.mode}) untuk ${cfg.vault}`);

// Spur (opsional): jalur sendiri; galat di sini tidak menghentikan Cordon dan sebaliknya.
const sc = cfg.spur;
const spur = sc ? await createSpurRuntime({ rpcUrl: cfg.rpcUrl, chainId: cfg.chainId, vault: sc.vault, mode: sc.mode, keeperAddress: sc.keeperAddress ?? undefined, privateKey: sc.privateKey ?? undefined }) : null;
const spurStore = sc ? createSpurStore(cfg.supabaseUrl, cfg.serviceKey) : null;
const rfq = sc?.rfqUrl ? createHttpQuoteSource(sc.rfqUrl, sc.rfqToken, sc.rfqTimeoutMs) : null;
if (sc && spur) log(`keeper spur siap (mode ${sc.mode}) untuk ${sc.vault}, akun ${spur.account}, RFQ ${rfq ? "aktif" : "TIDAK dikonfigurasi (fill dilewati)"}`);

const spurLog = (o: SpurOutcome) => {
  switch (o.kind) {
    case "waiting": return log(`spur tunggu: ${o.reason}`);
    case "blocked": return log(`spur DITAHAN ${o.job}: ${o.reason}`);
    case "dry-run": return log(`spur DRY-RUN ${o.job}: ${o.detail} (lolos simulasi, tidak dikirim)`);
    case "sent": return log(`spur ${o.job} terkirim ${o.txHash}`);
    case "failed": return log(`spur GAGAL ${o.job}: ${o.error}`, o.txHash);
  }
};

let stop = false;
for (const s of ["SIGINT", "SIGTERM"] as const) process.on(s, () => { stop = true; });
let lastSpurKey = "";
while (!stop) {
  try {
    const o = await runOnce(chain, dryRunExecutor, store, kc);
    if (o.kind === "dry-run") log(`DRY-RUN: drift ${o.driftBps} bps, rencana ${o.trades.length} trade (tidak dikirim)`, o.trades.map((t) => ({ in: t.tokenIn, out: t.tokenOut, amountIn: String(t.amountIn), minOut: String(t.minOut) })));
    else if (o.kind === "skipped") log(`lewati: ${o.reason}`);
    else if (o.kind === "failed") log(`GAGAL: ${o.error}`);
    else log(`pruning ${o.txHash}: drift ${o.before} -> ${o.after} bps`);
  } catch (e) { log("galat:", e instanceof Error ? e.message : e); }
  if (spur && spurStore) {
    try {
      const o = await runSpurOnce(spur.chain, spur.executor, rfq, spurStore);
      // Status yang sama berturut-turut (menunggu/ditahan) dicatat sekali saja supaya log poll 60 detik tidak membanjir.
      const key = o.kind === "sent" || o.kind === "failed" ? "" : `${o.kind}:${"reason" in o ? o.reason : "detail" in o ? o.detail : ""}`;
      if (key === "" || key !== lastSpurKey) spurLog(o);
      lastSpurKey = key;
    } catch (e) { log("galat spur:", e instanceof Error ? e.message : e); }
  }
  await sleep(cfg.pollMs);
}
