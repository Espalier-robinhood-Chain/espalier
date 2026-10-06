// Murni (tanpa dependensi wallet) supaya bisa diimpor dari server component dan dites dengan node --test.
export const MAINNET_PUBLIC_RPC = "https://rpc.mainnet.chain.robinhood.com"; // rate-limited, bukan untuk produksi

/** NEXT_MODE: jaringan yang dipakai situs. Kosong/tidak dikenal = mode simulasi (tanpa wallet, tanpa transaksi). */
export type NetworkMode = "mainnet" | "testnet";
export const MODE_CHAIN_ID: Record<NetworkMode, number> = { mainnet: 4663, testnet: 46630 };

/** Hanya "mainnet" atau "testnet" (huruf besar/kecil dan spasi diabaikan). Nilai lain, termasuk salah ketik, jatuh ke simulasi. */
export function resolveNetworkMode(raw?: string): NetworkMode | undefined {
  const v = raw?.trim().toLowerCase();
  return v === "mainnet" || v === "testnet" ? v : undefined;
}

/** Vault yang panel mint/redeem-nya hidup (satu CordonVault per deployment). */
export type VaultTarget = { address: `0x${string}`; chainId: number; symbol: string };

/** SpurVault yang panel deposit/withdraw-nya hidup (satu per deployment, mis. sNVDA). */
export type SpurTarget = { address: `0x${string}`; chainId: number; symbol: string };

/** GraftVault yang panel deposit/withdraw-nya hidup (satu per deployment, mis. gNVDA). Bentuknya sama dengan SpurTarget. */
export type GraftTarget = SpurTarget;

export type Web3Env = {
  /** undefined = mode simulasi: wallet connect mati dan semua panel tetap demo. */
  mode?: NetworkMode;
  projectId?: string;
  mainnetRpc: string;
  testnetRpc?: string;
  siteUrl: string;
  /** undefined = panel tetap mode demo (tanpa transaksi). */
  vault?: VaultTarget;
  /** undefined = panel deposit/withdraw Spur tetap mode demo (tanpa transaksi). */
  spur?: SpurTarget;
  /** undefined = panel deposit/withdraw Graft tetap mode demo (tanpa transaksi). */
  graft?: GraftTarget;
};

const clean = (v?: string) => v?.trim() || undefined;

/**
 * Alamat dan chain vault dari env. Alamat yang salah bentuk atau chain yang bukan bilangan bulat positif dianggap
 * tidak diisi (panel jatuh ke demo) alih-alih mengirim transaksi ke tujuan yang tidak jelas. Alamat nol ditolak.
 * Chain default = testnet 46630, karena tahap 1 di alur kerja adalah deploy testnet.
 */
export function resolveVaultTarget(e: Record<string, string | undefined>): VaultTarget | undefined {
  const address = clean(e.NEXT_PUBLIC_CORDON_VAULT_ADDRESS);
  if (!address || !/^0x[0-9a-fA-F]{40}$/.test(address) || /^0x0{40}$/.test(address)) return undefined;
  const rawChain = clean(e.NEXT_PUBLIC_CORDON_VAULT_CHAIN_ID) ?? "46630";
  if (!/^\d+$/.test(rawChain)) return undefined;
  const chainId = Number(rawChain);
  if (!Number.isSafeInteger(chainId) || chainId <= 0) return undefined;
  return { address: address as `0x${string}`, chainId, symbol: clean(e.NEXT_PUBLIC_CORDON_VAULT_SYMBOL) ?? "cMAG7" };
}

/**
 * Satu pemuat untuk SpurVault dan GraftVault (keduanya "vault berantrean" dengan alamat + chain + simbol), aturannya sama dengan
 * `resolveVaultTarget`: alamat salah bentuk atau alamat nol, atau chain yang bukan bilangan bulat positif, dianggap tidak
 * diisi (panel jatuh ke demo). Simbol default = simbol bawaan indexer (`s`/`g` + ticker aset), dan harus sama dengan
 * `vaults.symbol` di Supabase karena itulah yang ada di URL /vaults/<symbol>.
 */
function resolveQueuedVaultTarget(e: Record<string, string | undefined>, p: "SPUR" | "GRAFT", defaultSymbol: string): SpurTarget | undefined {
  const address = clean(e[`NEXT_PUBLIC_${p}_VAULT_ADDRESS`]);
  if (!address || !/^0x[0-9a-fA-F]{40}$/.test(address) || /^0x0{40}$/.test(address)) return undefined;
  const rawChain = clean(e[`NEXT_PUBLIC_${p}_VAULT_CHAIN_ID`]) ?? "46630";
  if (!/^\d+$/.test(rawChain)) return undefined;
  const chainId = Number(rawChain);
  if (!Number.isSafeInteger(chainId) || chainId <= 0) return undefined;
  return { address: address as `0x${string}`, chainId, symbol: clean(e[`NEXT_PUBLIC_${p}_VAULT_SYMBOL`]) ?? defaultSymbol };
}

/** SpurVault dari env. Simbol default `sNVDA`. */
export const resolveSpurTarget = (e: Record<string, string | undefined>): SpurTarget | undefined => resolveQueuedVaultTarget(e, "SPUR", "sNVDA");

/** GraftVault dari env. Simbol default `gNVDA`. */
export const resolveGraftTarget = (e: Record<string, string | undefined>): GraftTarget | undefined => resolveQueuedVaultTarget(e, "GRAFT", "gNVDA");

export function resolveWeb3Env(e: Record<string, string | undefined>): Web3Env {
  const vault = resolveVaultTarget(e);
  const spur = resolveSpurTarget(e);
  const graft = resolveGraftTarget(e);
  const mode = resolveNetworkMode(e.NEXT_MODE);
  return {
    ...(mode ? { mode } : {}),
    projectId: clean(e.NEXT_PUBLIC_REOWN_PROJECT_ID),
    mainnetRpc: clean(e.NEXT_PUBLIC_RH_RPC_MAINNET) ?? MAINNET_PUBLIC_RPC,
    testnetRpc: clean(e.NEXT_PUBLIC_RH_RPC_TESTNET),
    siteUrl: clean(e.NEXT_PUBLIC_SITE_URL) ?? "http://localhost:3000",
    ...(vault ? { vault } : {}),
    ...(spur ? { spur } : {}),
    ...(graft ? { graft } : {}),
  };
}

// Next hanya meng-inline process.env.NEXT_PUBLIC_X yang ditulis literal, jadi tiap variabel disebut satu per satu.
// NEXT_MODE tidak berawalan NEXT_PUBLIC_, jadi next.config.ts menyalinnya lewat `env` agar ikut ter-inline ke bundel klien.
export const web3Env = resolveWeb3Env({
  NEXT_MODE: process.env.NEXT_MODE,
  NEXT_PUBLIC_REOWN_PROJECT_ID: process.env.NEXT_PUBLIC_REOWN_PROJECT_ID,
  NEXT_PUBLIC_RH_RPC_MAINNET: process.env.NEXT_PUBLIC_RH_RPC_MAINNET,
  NEXT_PUBLIC_RH_RPC_TESTNET: process.env.NEXT_PUBLIC_RH_RPC_TESTNET,
  NEXT_PUBLIC_SITE_URL: process.env.NEXT_PUBLIC_SITE_URL,
  NEXT_PUBLIC_CORDON_VAULT_ADDRESS: process.env.NEXT_PUBLIC_CORDON_VAULT_ADDRESS,
  NEXT_PUBLIC_CORDON_VAULT_CHAIN_ID: process.env.NEXT_PUBLIC_CORDON_VAULT_CHAIN_ID,
  NEXT_PUBLIC_CORDON_VAULT_SYMBOL: process.env.NEXT_PUBLIC_CORDON_VAULT_SYMBOL,
  NEXT_PUBLIC_SPUR_VAULT_ADDRESS: process.env.NEXT_PUBLIC_SPUR_VAULT_ADDRESS,
  NEXT_PUBLIC_SPUR_VAULT_CHAIN_ID: process.env.NEXT_PUBLIC_SPUR_VAULT_CHAIN_ID,
  NEXT_PUBLIC_SPUR_VAULT_SYMBOL: process.env.NEXT_PUBLIC_SPUR_VAULT_SYMBOL,
  NEXT_PUBLIC_GRAFT_VAULT_ADDRESS: process.env.NEXT_PUBLIC_GRAFT_VAULT_ADDRESS,
  NEXT_PUBLIC_GRAFT_VAULT_CHAIN_ID: process.env.NEXT_PUBLIC_GRAFT_VAULT_CHAIN_ID,
  NEXT_PUBLIC_GRAFT_VAULT_SYMBOL: process.env.NEXT_PUBLIC_GRAFT_VAULT_SYMBOL,
});

/**
 * Wallet connect hanya hidup bila NEXT_MODE diisi, project ID ada, dan (untuk testnet) RPC testnet ada.
 * Kalau salah satu hilang, situs tetap jalan sebagai simulasi (build tanpa env tidak boleh gagal).
 */
export function isWeb3Enabled(env: Web3Env): boolean {
  if (env.projectId === undefined || env.mode === undefined) return false;
  return env.mode === "mainnet" || env.testnetRpc !== undefined;
}

/**
 * Panel mint/redeem untuk `symbol` melakukan transaksi sungguhan hanya bila wallet aktif, vault-nya dikonfigurasi,
 * dan chain vault sama dengan chain NEXT_MODE (vault testnet tidak boleh menerima transaksi di mode mainnet, dan sebaliknya).
 */
export function isTradeLive(env: Web3Env, symbol: string): boolean {
  if (!isWeb3Enabled(env) || !env.mode || !env.vault) return false;
  return env.vault.symbol === symbol && env.vault.chainId === MODE_CHAIN_ID[env.mode];
}

/** Panel deposit/withdraw Spur sungguhan: aturan yang sama dengan `isTradeLive`, untuk SpurVault. */
export function isSpurLive(env: Web3Env, symbol: string): boolean {
  if (!isWeb3Enabled(env) || !env.mode || !env.spur) return false;
  return env.spur.symbol === symbol && env.spur.chainId === MODE_CHAIN_ID[env.mode];
}

/** Panel deposit/withdraw Graft sungguhan: aturan yang sama dengan `isSpurLive`, untuk GraftVault. */
export function isGraftLive(env: Web3Env, symbol: string): boolean {
  if (!isWeb3Enabled(env) || !env.mode || !env.graft) return false;
  return env.graft.symbol === symbol && env.graft.chainId === MODE_CHAIN_ID[env.mode];
}

export const web3Enabled = isWeb3Enabled(web3Env);
export const tradeLive = (symbol: string) => isTradeLive(web3Env, symbol);
export const spurLive = (symbol: string) => isSpurLive(web3Env, symbol);
export const graftLive = (symbol: string) => isGraftLive(web3Env, symbol);
