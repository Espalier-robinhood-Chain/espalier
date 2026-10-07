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
  /** Cordon tambahan (opsional, mis. cCHIP): EXTRA_CORDONS="0xalamat@blokDeploy,0xalamat@blokDeploy". Kosong = tidak ada. */
  extraCordons: { vault: `0x${string}`; startBlock: bigint }[];
  /** Spur Vault (opsional): null bila SPUR_VAULT_ADDRESS kosong. */
  spur: { vault: `0x${string}`; startBlock: bigint; symbol: string | null } | null;
  /** Graft Vault (opsional): null bila GRAFT_VAULT_ADDRESS kosong. Bentuknya sama dengan `spur`. */
  graft: { vault: `0x${string}`; startBlock: bigint; symbol: string | null } | null;
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
    extraCordons: loadExtraCordons(e, vault),
    spur: loadSpur(e),
    graft: loadGraft(e),
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

// Satu pemuat untuk Spur dan Graft: prefiks env berbeda (SPUR_* / GRAFT_*), aturan sama.
function loadVault(e: Record<string, string | undefined>, p: "SPUR" | "GRAFT"): IndexerConfig["spur"] {
  const vault = e[`${p}_VAULT_ADDRESS`]?.trim();
  if (!vault) return null; // tidak diindeks; konfigurasi lama tetap valid
  if (!/^0x[0-9a-fA-F]{40}$/.test(vault) || /^0x0{40}$/.test(vault)) throw new Error(`env ${p}_VAULT_ADDRESS bukan alamat valid`);
  const start = need(e, `${p}_START_BLOCK`); // blok deploy vault
  if (!/^\d+$/.test(start)) throw new Error(`env ${p}_START_BLOCK harus bilangan bulat >= 0`);
  const symbol = e[`${p}_VAULT_SYMBOL`]?.trim() || null; // default: "s"/"g" + ticker (mis. sNVDA, gNVDA)
  if (symbol !== null && !/^[A-Za-z0-9._-]{1,32}$/.test(symbol)) throw new Error(`env ${p}_VAULT_SYMBOL tidak valid`);
  return { vault: vault as `0x${string}`, startBlock: BigInt(start), symbol };
}
const loadSpur = (e: Record<string, string | undefined>) => loadVault(e, "SPUR");
const loadGraft = (e: Record<string, string | undefined>) => loadVault(e, "GRAFT");

/**
 * EXTRA_CORDONS: daftar "alamat@blokDeploy" dipisah koma. Tiap Cordon punya kursor dan snapshot NAV sendiri (kunci
 * `cordon:<chain>:<alamat>`), jadi menambah cCHIP tidak menyentuh data cMAG7. Gagal keras bila salah bentuk, duplikat,
 * atau sama dengan CORDON_VAULT_ADDRESS.
 */
function loadExtraCordons(e: Record<string, string | undefined>, primary: string): IndexerConfig["extraCordons"] {
  const raw = e.EXTRA_CORDONS?.trim();
  if (!raw) return [];
  const seen = new Set<string>([primary.toLowerCase()]);
  return raw.split(",").map((part) => part.trim()).filter(Boolean).map((part) => {
    const [addr, block, ...rest] = part.split("@");
    if (rest.length || !addr || !block) throw new Error(`env EXTRA_CORDONS: "${part}" harus berbentuk 0xalamat@blokDeploy`);
    if (!/^0x[0-9a-fA-F]{40}$/.test(addr) || /^0x0{40}$/.test(addr)) throw new Error(`env EXTRA_CORDONS: alamat tidak valid (${addr})`);
    if (!/^\d+$/.test(block)) throw new Error(`env EXTRA_CORDONS: blok deploy untuk ${addr} harus bilangan bulat >= 0`);
    if (seen.has(addr.toLowerCase())) throw new Error(`env EXTRA_CORDONS: alamat ganda atau sama dengan CORDON_VAULT_ADDRESS (${addr})`);
    seen.add(addr.toLowerCase());
    return { vault: addr as `0x${string}`, startBlock: BigInt(block) };
  });
}
