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

// Spur dan Graft (opsional): masing-masing jalur sendiri; galat di satu jalur tidak menghentikan Cordon atau vault lain.
// Keduanya memakai kode keeper yang sama (GraftVault mencerminkan SpurVault); RFQ dan kunci keeper dipakai bersama.
const spurStore = cfg.spur || cfg.graft ? createSpurStore(cfg.supabaseUrl, cfg.serviceKey) : null;
const rfqCfg = cfg.spur ?? cfg.graft;
const rfq = rfqCfg?.rfqUrl ? createHttpQuoteSource(rfqCfg.rfqUrl, rfqCfg.rfqToken, rfqCfg.rfqTimeoutMs) : null;
type Lane = { name: "spur" | "graft"; rt: Awaited<ReturnType<typeof createSpurRuntime>>; lastKey: string };
const lanes: Lane[] = [];
for (const [name, sc] of [["spur", cfg.spur], ["graft", cfg.graft]] as const) {
  if (!sc) continue;
  const rt = await createSpurRuntime({ rpcUrl: cfg.rpcUrl, chainId: cfg.chainId, vault: sc.vault, mode: sc.mode, keeperAddress: sc.keeperAddress ?? undefined, privateKey: sc.privateKey ?? undefined, kind: name });
  lanes.push({ name, rt, lastKey: "" });
  log(`keeper ${name} siap (mode ${sc.mode}) untuk ${sc.vault}, akun ${rt.account}, RFQ ${rfq ? "aktif" : "TIDAK dikonfigurasi (fill dilewati)"}`);
}

const laneLog = (name: string, o: SpurOutcome) => {
  switch (o.kind) {
    case "waiting": return log(`${name} tunggu: ${o.reason}`);
    case "blocked": return log(`${name} DITAHAN ${o.job}: ${o.reason}`);
    case "dry-run": return log(`${name} DRY-RUN ${o.job}: ${o.detail} (lolos simulasi, tidak dikirim)`);
    case "sent": return log(`${name} ${o.job} terkirim ${o.txHash}`);
    case "failed": return log(`${name} GAGAL ${o.job}: ${o.error}`, o.txHash);
  }
};

let stop = false;
for (const s of ["SIGINT", "SIGTERM"] as const) process.on(s, () => { stop = true; });
while (!stop) {
  try {
    const o = await runOnce(chain, dryRunExecutor, store, kc);
    if (o.kind === "dry-run") log(`DRY-RUN: drift ${o.driftBps} bps, rencana ${o.trades.length} trade (tidak dikirim)`, o.trades.map((t) => ({ in: t.tokenIn, out: t.tokenOut, amountIn: String(t.amountIn), minOut: String(t.minOut) })));
    else if (o.kind === "skipped") log(`lewati: ${o.reason}`);
    else if (o.kind === "failed") log(`GAGAL: ${o.error}`);
    else log(`pruning ${o.txHash}: drift ${o.before} -> ${o.after} bps`);
  } catch (e) { log("galat:", e instanceof Error ? e.message : e); }
  if (spurStore) for (const lane of lanes) {
    try {
      const o = await runSpurOnce(lane.rt.chain, lane.rt.executor, rfq, spurStore);
      // Status yang sama berturut-turut (menunggu/ditahan) dicatat sekali saja supaya log poll 60 detik tidak membanjir.
      const key = o.kind === "sent" || o.kind === "failed" ? "" : `${o.kind}:${"reason" in o ? o.reason : "detail" in o ? o.detail : ""}`;
      if (key === "" || key !== lane.lastKey) laneLog(lane.name, o);
      lane.lastKey = key;
    } catch (e) { log(`galat ${lane.name}:`, e instanceof Error ? e.message : e); }
  }
  await sleep(cfg.pollMs);
}
