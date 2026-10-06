// Konfigurasi dari env (murni, dites). Gagal keras dengan pesan jelas: indexer salah alamat/chain lebih buruk daripada mati.
export interface IndexerConfig {
  rpcUrl: string;
  chainId: number;
  vault: `0x${string}`;
  supabaseUrl: string;
  serviceKey: string;
  startBlock: bigint;
  confirmations: bigint;
  logChunk: bigint;
  balanceBatch: number;
  pollMs: number;
  navEveryMs: number;
  /** Spur Vault (opsional): null bila SPUR_VAULT_ADDRESS kosong. */
  spur: { vault: `0x${string}`; startBlock: bigint; symbol: string | null } | null;
}

const need = (e: Record<string, string | undefined>, k: string) => {
  const v = e[k]?.trim();
  if (!v) throw new Error(`env ${k} wajib diisi`);
  return v;
};
const int = (e: Record<string, string | undefined>, k: string, def: number, min: number) => {
  const raw = e[k]?.trim();
  if (!raw) return def;
  if (!/^\d+$/.test(raw) || Number(raw) < min) throw new Error(`env ${k} harus bilangan bulat >= ${min}`);
  return Number(raw);
};

export function loadConfig(e: Record<string, string | undefined>): IndexerConfig {
  const vault = need(e, "CORDON_VAULT_ADDRESS");
  if (!/^0x[0-9a-fA-F]{40}$/.test(vault) || /^0x0{40}$/.test(vault)) throw new Error("env CORDON_VAULT_ADDRESS bukan alamat valid");
  const start = need(e, "START_BLOCK"); // blok deploy vault; memindai dari 0 di chain besar tidak masuk akal
  if (!/^\d+$/.test(start)) throw new Error("env START_BLOCK harus bilangan bulat >= 0");
  const supabaseUrl = need(e, "SUPABASE_URL");
  if (!/^https?:\/\//.test(supabaseUrl)) throw new Error("env SUPABASE_URL harus diawali http(s)://");
  return {
    spur: loadSpur(e),
    rpcUrl: need(e, "INDEXER_RPC_URL"),
    chainId: int(e, "INDEXER_CHAIN_ID", 46630, 1),
    vault: vault as `0x${string}`,
    supabaseUrl,
    serviceKey: need(e, "SUPABASE_SERVICE_ROLE_KEY"),
    startBlock: BigInt(start),
    confirmations: BigInt(int(e, "CONFIRMATIONS", 5, 0)),
    logChunk: BigInt(int(e, "LOG_CHUNK", 2000, 1)),
    balanceBatch: int(e, "BALANCE_BATCH", 25, 1),
    pollMs: int(e, "POLL_MS", 5000, 500),
    navEveryMs: int(e, "NAV_EVERY_MS", 300_000, 5000),
  };
}

function loadSpur(e: Record<string, string | undefined>): IndexerConfig["spur"] {
  const vault = e.SPUR_VAULT_ADDRESS?.trim();
  if (!vault) return null; // Spur tidak diindeks; konfigurasi lama tetap valid
  if (!/^0x[0-9a-fA-F]{40}$/.test(vault) || /^0x0{40}$/.test(vault)) throw new Error("env SPUR_VAULT_ADDRESS bukan alamat valid");
  const start = need(e, "SPUR_START_BLOCK"); // blok deploy SpurVault
  if (!/^\d+$/.test(start)) throw new Error("env SPUR_START_BLOCK harus bilangan bulat >= 0");
  const symbol = e.SPUR_VAULT_SYMBOL?.trim() || null; // default: "s" + simbol aset (mis. sNVDA)
  if (symbol !== null && !/^[A-Za-z0-9._-]{1,32}$/.test(symbol)) throw new Error("env SPUR_VAULT_SYMBOL tidak valid");
  return { vault: vault as `0x${string}`, startBlock: BigInt(start), symbol };
}
