// Inti indexer, murni terhadap antarmuka Chain dan Store (tanpa viem/Supabase) supaya bisa dites dengan tiruan.
//
// Prinsip (brief §5.1): onchain = sumber kebenaran, DB = cache yang bisa dibangun ulang dari event.
//  * Event Transfer share hanya dipakai untuk tahu AKUN MANA yang berubah; nilai saldo selalu dibaca absolut
//    dari kontrak di blok aman terbaru. Jadi memproses ulang rentang yang sama tidak pernah menggandakan apa pun,
//    dan tidak perlu node arsip untuk backfill.
//  * Urutan tulis: posisi -> NAV -> kursor. Crash di tengah hanya berarti rentang itu diproses ulang.
//  * Hanya blok sedalam `confirmations` yang diindeks, sebagai pengaman reorg.
import { chunkRanges, lower, toDecimal, ZERO } from "./decimal.ts";

export interface ComponentMeta { token: string; ticker: string; weightBps: number }
export interface VaultMeta { address: string; symbol: string; name: string; decimals: number; components: ComponentMeta[] }
export interface TransferLog { from: string; to: string; block: bigint }
export interface NavReading { ok: boolean; totalValueE18: bigint; navPerShareE18: bigint; totalSupply: bigint }

export interface Chain {
  head(): Promise<bigint>;
  blockTimestamp(block: bigint): Promise<Date>;
  meta(): Promise<VaultMeta>;
  transfers(from: bigint, to: bigint): Promise<TransferLog[]>;
  /** Saldo share tiap akun di `block`. Kunci hasil = alamat huruf kecil. */
  balances(accounts: string[], block: bigint): Promise<Map<string, bigint>>;
  nav(block: bigint): Promise<NavReading>;
}

export interface PositionRow { account: string; contract: string; shares: string }
export interface NavRow { cordon_id: string; ts: string; nav_per_share: string; total_supply: string; tvl_usd: string }
export interface Store {
  getCursor(): Promise<bigint | null>;
  setCursor(next: bigint): Promise<void>;
  upsertCordon(v: { address: string; symbol: string; name: string }): Promise<string>;
  replaceAssets(cordonId: string, rows: Array<{ token: string; ticker: string; target_weight_bps: number }>): Promise<void>;
  upsertPositions(rows: PositionRow[]): Promise<void>;
  deletePositions(contract: string, accounts: string[]): Promise<void>;
  upsertNav(row: NavRow): Promise<void>;
}

export interface SyncConfig { startBlock: bigint; confirmations: bigint; logChunk: bigint; balanceBatch: number }
export interface SyncResult { from: bigint; to: bigint; touched: number; navWritten: boolean }

const E18 = 18;

async function writeNav(chain: Chain, store: Store, cordonId: string, decimals: number, block: bigint): Promise<boolean> {
  const n = await chain.nav(block);
  if (!n.ok) return false; // ada komponen tanpa harga valid: jangan tulis angka (kontrak: "jangan tampilkan angkanya")
  const ts = await chain.blockTimestamp(block);
  await store.upsertNav({
    cordon_id: cordonId,
    ts: ts.toISOString(),
    nav_per_share: toDecimal(n.navPerShareE18, E18),
    total_supply: toDecimal(n.totalSupply, decimals),
    tvl_usd: toDecimal(n.totalValueE18, E18),
  });
  return true;
}

/** Pastikan baris cordon dan komposisinya ada. Aman dipanggil berulang. Mengembalikan id cordon. */
export async function bootstrap(chain: Chain, store: Store): Promise<{ meta: VaultMeta; cordonId: string }> {
  const meta = await chain.meta();
  const address = lower(meta.address);
  const cordonId = await store.upsertCordon({ address, symbol: meta.symbol, name: meta.name });
  await store.replaceAssets(cordonId, meta.components.map((c) => ({ token: lower(c.token), ticker: c.ticker, target_weight_bps: c.weightBps })));
  return { meta, cordonId };
}

/** Satu putaran: indeks dari kursor sampai blok aman, lalu perbarui kursor. */
export async function syncOnce(chain: Chain, store: Store, cfg: SyncConfig, boot: { meta: VaultMeta; cordonId: string }): Promise<SyncResult | null> {
  const head = await chain.head();
  const safe = head - cfg.confirmations;
  const cursor = await store.getCursor();
  const from = cursor ?? cfg.startBlock;
  if (safe < from) return null;

  const touched = new Set<string>();
  for (const [a, b] of chunkRanges(from, safe, cfg.logChunk)) {
    for (const t of await chain.transfers(a, b)) {
      for (const x of [lower(t.from), lower(t.to)]) if (x !== ZERO) touched.add(x);
    }
  }

  const contract = lower(boot.meta.address);
  const accounts = [...touched];
  for (let i = 0; i < accounts.length; i += cfg.balanceBatch) {
    const batch = accounts.slice(i, i + cfg.balanceBatch);
    const bal = await chain.balances(batch, safe);
    const rows: PositionRow[] = [];
    const empty: string[] = [];
    for (const acc of batch) {
      const v = bal.get(acc);
      if (v === undefined) throw new Error(`saldo ${acc} tidak dikembalikan`); // jangan menebak: kursor tidak maju
      if (v === 0n) empty.push(acc); else rows.push({ account: acc, contract, shares: toDecimal(v, boot.meta.decimals) });
    }
    if (rows.length) await store.upsertPositions(rows);
    if (empty.length) await store.deletePositions(contract, empty);
  }

  // NAV hanya di ujung (blok aman terbaru): NAV historis butuh node arsip.
  const navWritten = await writeNav(chain, store, boot.cordonId, boot.meta.decimals, safe);
  await store.setCursor(safe + 1n);
  return { from, to: safe, touched: touched.size, navWritten };
}

/** Titik NAV berkala (harga oracle berubah walau tidak ada transaksi). Tidak menyentuh kursor. */
export async function snapshotNav(chain: Chain, store: Store, cfg: SyncConfig, boot: { meta: VaultMeta; cordonId: string }): Promise<boolean> {
  const safe = (await chain.head()) - cfg.confirmations;
  if (safe < cfg.startBlock) return false;
  return writeNav(chain, store, boot.cordonId, boot.meta.decimals, safe);
}
