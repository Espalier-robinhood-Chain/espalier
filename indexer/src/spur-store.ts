import { createClient } from "@supabase/supabase-js";
import type { PositionRow } from "./sync.ts";
import type { HarvestRow, RoundRow, SpurStore } from "./spur-sync.ts";

// Service role: hanya untuk server ini. JANGAN pernah memakai kunci ini di web (NEXT_PUBLIC_*).
export function createSpurStore(url: string, serviceKey: string, key: string): SpurStore {
  const db = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const check = (what: string, error: { message: string } | null) => { if (error) throw new Error(`${what}: ${error.message}`); };

  return {
    async getCursor() {
      const { data, error } = await db.from("indexer_snapshots").select("cursor").eq("key", key).maybeSingle();
      check("baca kursor spur", error);
      return data ? BigInt(data.cursor as string) : null;
    },
    async loadState() {
      const { data, error } = await db.from("indexer_snapshots").select("state").eq("key", key).single();
      check("baca snapshot spur", error);
      return data!.state;
    },
    async saveSnapshot(cursor, state) {
      const { error } = await db.from("indexer_snapshots").upsert({ key, cursor: cursor.toString(), state, updated_at: new Date().toISOString() }, { onConflict: "key" });
      check("tulis snapshot spur", error);
    },
    async upsertVault(v) {
      // Gagal unik di `symbol` = ada vault demo bersimbol sama dengan alamat lain: hapus/ganti simbol baris demo itu dulu.
      const { data, error } = await db.from("vaults").upsert({ address: v.address, kind: v.kind, underlying: v.underlying, symbol: v.symbol }, { onConflict: "address" }).select("id").single();
      check(`upsert vault ${v.symbol}`, error);
      return data!.id as string;
    },
    async upsertRounds(vaultId: string, rows: RoundRow[]) {
      const { error } = await db.from("rounds").upsert(rows.map((r) => ({ vault_id: vaultId, ...r })), { onConflict: "vault_id,round_no" });
      check("upsert rounds", error);
    },
    async upsertPositions(rows: PositionRow[]) {
      const now = new Date().toISOString();
      const { error } = await db.from("positions").upsert(rows.map((r) => ({ ...r, is_demo: false, updated_at: now })), { onConflict: "account,contract" });
      check("upsert positions spur", error);
    },
    async deletePositions(contract, accounts) {
      const { error } = await db.from("positions").delete().eq("contract", contract).in("account", accounts);
      check("hapus positions spur", error);
    },
    async upsertHarvests(vaultId: string, rows: HarvestRow[]) {
      const { error } = await db.from("harvests").upsert(rows.map((r) => ({ vault_id: vaultId, ...r })), { onConflict: "account,vault_id,round_no" });
      check("upsert harvests", error);
    },
  };
}
