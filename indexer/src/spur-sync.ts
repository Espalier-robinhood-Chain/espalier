// Sinkronisasi SpurVault -> Supabase (`vaults`, `rounds`, `harvests`, `positions`). Murni terhadap antarmuka SpurChain/SpurStore.
//
// Pembagian tanggung jawab:
//  * `rounds`: event hanya menandai round mana yang berubah; isinya dibaca ABSOLUT dari `getRound(n)` di blok aman
//    (round bersifat tetap setelah terminal, jadi aman diproses ulang dan tidak butuh node arsip).
//  * `harvests` dan share per akun: dari ledger event-sourced (lihat spur-ledger.ts), karena share per round tidak bisa dibaca belakangan.
//  * Pagar integritas: share tiap akun yang berubah dibandingkan dengan `sharesOf` di blok aman. Beda = galat, kursor tidak maju.
//  * Urutan tulis: rounds -> positions -> harvests -> snapshot (kursor + ledger dalam SATU baris, jadi atomik).
//    Crash di tengah = batch yang sama diproses ulang dari snapshot lama, semua tulis berupa upsert.
import { capEnd, chunkRanges, lower, toDecimal } from "./decimal.ts";
import { applyEvents, ledgerFromJson, ledgerToJson, newLedger, type Effects, type Ledger, type SpurEvent } from "./spur-ledger.ts";
import type { PositionRow, SyncConfig } from "./sync.ts";

export interface SpurMeta {
  address: string; assetSymbol: string; assetDecimals: number; premiumDecimals: number; shareDecimals: number;
  /** Default "spur". Graft memakai struct round, event, dan getter akun yang sama; yang beda hanya tiga bidang di bawah. */
  kind?: "spur" | "graft";
  /** Ticker acuan harga (untuk Graft: simbol `UNDERLYING`). Default = `assetSymbol` (Spur: aset vault itu sendiri). */
  underlyingSymbol?: string;
  /** Desimal `notional`. Spur: desimal aset vault. Graft: desimal Stock Token (aset vault-nya USDG, notional-nya jumlah saham). */
  notionalDecimals?: number;
}
/** Bentuk `SpurVault.getRound(n)`. `outcome`: 0 Pending, 1 Settled, 2 ClosedUnsold. */
export interface OnchainRound {
  start: bigint; expiry: bigint; strikeE18: bigint; startPriceE18: bigint; notional: bigint; minPremium: bigint;
  picker: string; premium: bigint; settlePriceE18: bigint; payout: bigint; outcome: number;
}
export interface SpurChain {
  head(): Promise<bigint>;
  blockTimestamp(block: bigint): Promise<Date>;
  meta(): Promise<SpurMeta>;
  /** Event vault dalam [from, to], boleh tidak terurut (diurutkan di sini). */
  events(from: bigint, to: bigint): Promise<SpurEvent[]>;
  round(n: number, block: bigint): Promise<OnchainRound>;
  /** `sharesOf` tiap akun di `block`. Kunci hasil = alamat huruf kecil. */
  sharesOf(accounts: string[], block: bigint): Promise<Map<string, bigint>>;
}

export interface RoundRow {
  round_no: number; strike: string; expiry: string; notional: string; premium_usdg: string | null; spot_start: string;
  picker: string | null; settlement_price: string | null; settled_at: string | null; status: "open" | "auctioned" | "settled" | "cancelled";
}
export interface HarvestRow { account: string; round_no: number; premium_usdg: string; claimed_at: string | null }
export interface SpurStore {
  getCursor(): Promise<bigint | null>;
  loadState(): Promise<unknown>;
  /** Simpan kursor dan ledger dalam satu tulis atomik. */
  saveSnapshot(cursor: bigint, state: unknown): Promise<void>;
  upsertVault(v: { address: string; symbol: string; underlying: string; kind: "spur" | "graft" }): Promise<string>;
  upsertRounds(vaultId: string, rows: RoundRow[]): Promise<void>;
  upsertPositions(rows: PositionRow[]): Promise<void>;
  deletePositions(contract: string, accounts: string[]): Promise<void>;
  upsertHarvests(vaultId: string, rows: HarvestRow[]): Promise<void>;
}

export interface SpurBoot { meta: SpurMeta; vaultId: string }
export interface SpurSyncConfig extends Pick<SyncConfig, "confirmations" | "logChunk" | "balanceBatch" | "maxChunks"> { startBlock: bigint }
export interface SpurSyncResult { from: bigint; to: bigint; events: number; rounds: number; harvests: number; positions: number; /** true bila dibatasi maxChunks dan masih tertinggal. */ partial?: boolean }

export async function bootstrapSpur(chain: SpurChain, store: SpurStore, symbolOverride: string | null): Promise<SpurBoot> {
  const meta = await chain.meta();
  const kind = meta.kind ?? "spur";
  const underlying = meta.underlyingSymbol ?? meta.assetSymbol;
  const symbol = symbolOverride ?? `${kind === "graft" ? "g" : "s"}${underlying}`;
  const vaultId = await store.upsertVault({ address: lower(meta.address), symbol, underlying, kind });
  return { meta, vaultId };
}

/** Baris `rounds` dari state kontrak. null = round tanpa opsi (RoundSkipped): tidak ada strike/expiry, tidak ditulis. */
export function roundRow(r: OnchainRound, meta: SpurMeta, no: number, settledAt: Date | undefined): RoundRow | null {
  if (r.expiry === 0n) return null;
  const sold = lower(r.picker) !== ZERO_ADDR;
  let status: RoundRow["status"];
  if (r.outcome === 1) status = "settled";
  else if (r.outcome === 2) status = "cancelled";
  else if (r.outcome === 0) status = sold ? "auctioned" : "open";
  else throw new Error(`round ${no}: outcome ${r.outcome} tidak dikenal`);
  if (status === "settled" && !settledAt) throw new Error(`round ${no} settled tetapi waktu RoundSettled tidak ada di rentang ini`); // jangan menebak
  return {
    round_no: no,
    strike: toDecimal(r.strikeE18, 18),
    expiry: new Date(Number(r.expiry) * 1000).toISOString(),
    notional: toDecimal(r.notional, meta.notionalDecimals ?? meta.assetDecimals),
    premium_usdg: sold ? toDecimal(r.premium, meta.premiumDecimals) : null,
    spot_start: toDecimal(r.startPriceE18, 18),
    picker: sold ? lower(r.picker) : null,
    settlement_price: status === "settled" ? toDecimal(r.settlePriceE18, 18) : null,
    settled_at: status === "settled" ? settledAt!.toISOString() : null,
    status,
  };
}
const ZERO_ADDR = "0x0000000000000000000000000000000000000000";

function harvestRows(fx: Effects, premiumDecimals: number): HarvestRow[] {
  return [...fx.harvests.values()].map((h) => ({
    account: h.account, round_no: h.round, premium_usdg: toDecimal(h.amount, premiumDecimals), claimed_at: h.claimedAt ? h.claimedAt.toISOString() : null,
  }));
}

export async function syncSpurOnce(chain: SpurChain, store: SpurStore, cfg: SpurSyncConfig, boot: SpurBoot): Promise<SpurSyncResult | null> {
  const safe = (await chain.head()) - cfg.confirmations;
  const cursor = await store.getCursor();
  const from = cursor ?? cfg.startBlock;
  if (safe < from) return null;
  // Tertinggal jauh: paling banyak maxChunks potongan per putaran. Ledger hanya memuat event sampai `end`, jadi pagar integritas
  // membaca kontrak di `end` (bukan `safe`); itu butuh node arsip bila `end` sudah lama (hanya terjadi saat mengejar).
  const end = capEnd(from, safe, cfg.logChunk, cfg.maxChunks);
  const partial = end < safe;

  const ledger: Ledger = cursor === null ? newLedger() : ledgerFromJson(await store.loadState());
  const events: SpurEvent[] = [];
  for (const [a, b] of chunkRanges(from, end, cfg.logChunk)) events.push(...(await chain.events(a, b)));
  events.sort((x, y) => (x.block === y.block ? x.logIndex - y.logIndex : x.block < y.block ? -1 : 1));

  // Waktu blok hanya dibutuhkan untuk settle dan klaim; ambil sekali per blok.
  const times = new Map<bigint, Date>();
  for (const e of events) if ((e.type === "RoundSettled" || e.type === "PremiumClaimed") && !times.has(e.block)) times.set(e.block, await chain.blockTimestamp(e.block));
  const fx = applyEvents(ledger, events, (b) => times.get(b)!);

  const meta = boot.meta, contract = lower(meta.address);

  const rounds: RoundRow[] = [];
  for (const n of [...fx.touchedRounds].sort((a, b) => a - b)) {
    const row = roundRow(await chain.round(n, end), meta, n, fx.settledAt.get(n));
    if (row) rounds.push(row);
  }

  // Pagar integritas: ledger vs kontrak untuk akun yang berubah. Tidak menulis apa pun bila ada selisih.
  const changed = [...fx.changedAccounts];
  const positions: PositionRow[] = [], empty: string[] = [];
  for (let i = 0; i < changed.length; i += cfg.balanceBatch) {
    const batch = changed.slice(i, i + cfg.balanceBatch);
    const onchain = await chain.sharesOf(batch, end);
    for (const acc of batch) {
      const v = onchain.get(acc);
      if (v === undefined) throw new Error(`sharesOf ${acc} tidak dikembalikan`);
      const mine = ledger.accounts.get(acc)?.shares ?? 0n;
      if (v !== mine) throw new Error(`share ${acc}: ledger ${mine} != kontrak ${v} di blok ${end} (ledger tidak dipercaya, kursor tidak maju)`);
      if (v === 0n) empty.push(acc); else positions.push({ account: acc, contract, shares: toDecimal(v, meta.shareDecimals) });
    }
  }

  if (rounds.length) await store.upsertRounds(boot.vaultId, rounds);
  if (positions.length) await store.upsertPositions(positions);
  if (empty.length) await store.deletePositions(contract, empty);
  const harvests = harvestRows(fx, meta.premiumDecimals);
  if (harvests.length) await store.upsertHarvests(boot.vaultId, harvests);
  await store.saveSnapshot(end + 1n, ledgerToJson(ledger));
  return { from, to: end, events: events.length, rounds: rounds.length, harvests: harvests.length, positions: positions.length + empty.length, ...(partial ? { partial } : {}) };
}
