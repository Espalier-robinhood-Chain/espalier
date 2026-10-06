export interface Config {
  rpcUrl: string; chainId: number; vault: `0x${string}`; supabaseUrl: string; serviceKey: string;
  mode: "dry-run"; pollMs: number; thresholdBps: number; minIntervalDays: number; slippageBps: number; minTradeUsd: number; maxTrades: number;
  /** Keeper Spur (opsional): null bila SPUR_VAULT_ADDRESS kosong. */
  spur: SpurConfig | null;
}
export interface SpurConfig {
  vault: `0x${string}`; mode: "dry-run" | "live"; keeperAddress: `0x${string}` | null; privateKey: `0x${string}` | null;
  rfqUrl: string | null; rfqToken: string | null; rfqTimeoutMs: number;
}
const need = (e: Record<string, string | undefined>, k: string) => { const v = e[k]?.trim(); if (!v) throw new Error(`env ${k} wajib diisi`); return v; };
const int = (e: Record<string, string | undefined>, k: string, def: number, min: number, max = Number.MAX_SAFE_INTEGER) => {
  const raw = e[k]?.trim(); if (!raw) return def;
  if (!/^\d+$/.test(raw) || Number(raw) < min || Number(raw) > max) throw new Error(`env ${k} harus bilangan bulat ${min}..${max}`);
  return Number(raw);
};
export function loadConfig(e: Record<string, string | undefined>): Config {
  const vault = need(e, "CORDON_VAULT_ADDRESS");
  if (!/^0x[0-9a-fA-F]{40}$/.test(vault) || /^0x0{40}$/.test(vault)) throw new Error("env CORDON_VAULT_ADDRESS bukan alamat valid");
  const url = need(e, "SUPABASE_URL");
  if (!/^https?:\/\//.test(url)) throw new Error("env SUPABASE_URL harus diawali http(s)://");
  // Mode live sengaja belum ada: kontrak belum punya fungsi pruning. Nilai selain dry-run ditolak, bukan diam-diam diabaikan.
  const mode = e.KEEPER_MODE?.trim() || "dry-run";
  if (mode !== "dry-run") throw new Error(`KEEPER_MODE=${mode} belum didukung: CordonVault belum punya fungsi pruning (hanya dry-run)`);
  return {
    rpcUrl: need(e, "KEEPER_RPC_URL"), chainId: int(e, "KEEPER_CHAIN_ID", 46630, 1), vault: vault as `0x${string}`,
    supabaseUrl: url, serviceKey: need(e, "SUPABASE_SERVICE_ROLE_KEY"), mode,
    pollMs: int(e, "POLL_MS", 60_000, 5000), thresholdBps: int(e, "DRIFT_THRESHOLD_BPS", 100, 1, 10_000),
    minIntervalDays: int(e, "MIN_INTERVAL_DAYS", 30, 0), slippageBps: int(e, "SLIPPAGE_BPS", 50, 0, 10_000),
    minTradeUsd: int(e, "MIN_TRADE_USD", 50, 0), maxTrades: int(e, "MAX_TRADES", 16, 1, 64),
    spur: loadSpur(e),
  };
}

const ADDR = /^0x[0-9a-fA-F]{40}$/;
function loadSpur(e: Record<string, string | undefined>): SpurConfig | null {
  const vault = e.SPUR_VAULT_ADDRESS?.trim();
  if (!vault) return null; // Spur tidak dijalankan; konfigurasi lama tetap valid
  if (!ADDR.test(vault) || /^0x0{40}$/.test(vault)) throw new Error("env SPUR_VAULT_ADDRESS bukan alamat valid");
  const mode = e.SPUR_MODE?.trim() || "dry-run"; // aman secara default: live harus diminta eksplisit
  if (mode !== "dry-run" && mode !== "live") throw new Error(`env SPUR_MODE harus dry-run atau live (bukan ${mode})`);
  const pk = e.KEEPER_PRIVATE_KEY?.trim() || null;
  if (pk !== null && !/^0x[0-9a-fA-F]{64}$/.test(pk)) throw new Error("env KEEPER_PRIVATE_KEY harus 0x + 64 heks");
  const addr = e.KEEPER_ADDRESS?.trim() || null;
  if (addr !== null && !ADDR.test(addr)) throw new Error("env KEEPER_ADDRESS bukan alamat valid");
  if (mode === "live" && pk === null) throw new Error("SPUR_MODE=live butuh KEEPER_PRIVATE_KEY");
  if (mode === "dry-run" && pk === null && addr === null) throw new Error("SPUR_MODE=dry-run butuh KEEPER_ADDRESS (akun KEEPER untuk simulasi)");
  const rfqUrl = e.RFQ_URL?.trim() || null;
  if (rfqUrl !== null && !/^https?:\/\//.test(rfqUrl)) throw new Error("env RFQ_URL harus diawali http(s)://");
  return {
    vault: vault as `0x${string}`, mode, keeperAddress: addr as `0x${string}` | null, privateKey: pk as `0x${string}` | null,
    rfqUrl, rfqToken: e.RFQ_TOKEN?.trim() || null, rfqTimeoutMs: int(e, "RFQ_TIMEOUT_MS", 5000, 500, 60_000),
  };
}
