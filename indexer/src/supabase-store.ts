import { createClient } from "@supabase/supabase-js";
import type { NavRow, PositionRow, Store } from "./sync.ts";

// Service role: hanya untuk server ini. JANGAN pernah memakai kunci ini di web (NEXT_PUBLIC_*).
export function createSupabaseStore(url: string, serviceKey: string, cursorKey: string): Store {
  const db = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const check = (what: string, error: { message: string } | null) => { if (error) throw new Error(`${what}: ${error.message}`); };

  return {
    async getCursor() {
      const { data, error } = await db.from("indexer_state").select("value").eq("key", cursorKey).maybeSingle();
      check("baca kursor", error);
      return data ? BigInt(data.value as string) : null;
    },
    async setCursor(next) {
      const { error } = await db.from("indexer_state").upsert({ key: cursorKey, value: next.toString(), updated_at: new Date().toISOString() }, { onConflict: "key" });
      check("tulis kursor", error);
    },
    async upsertCordon(v) {
      const { data, error } = await db.from("cordons").upsert({ address: v.address, symbol: v.symbol, name: v.name }, { onConflict: "address" }).select("id").single();
      // Gagal unik di `symbol` = ada cordon demo bersimbol sama dengan alamat lain: hapus/ganti simbol baris demo itu dulu.
      check(`upsert cordon ${v.symbol}`, error);
      return data!.id as string;
    },
    async replaceAssets(cordonId, rows) {
      const { error } = await db.from("cordon_assets").upsert(rows.map((r) => ({ cordon_id: cordonId, ...r })), { onConflict: "cordon_id,token" });
      check("upsert cordon_assets", error);
      const keep = `(${rows.map((r) => r.token).join(",")})`;
      const del = await db.from("cordon_assets").delete().eq("cordon_id", cordonId).not("token", "in", keep);
      check("hapus aset lama", del.error);
    },
    async upsertPositions(rows: PositionRow[]) {
      const now = new Date().toISOString();
      const { error } = await db.from("positions").upsert(rows.map((r) => ({ ...r, is_demo: false, updated_at: now })), { onConflict: "account,contract" });
      check("upsert positions", error);
    },
    async deletePositions(contract, accounts) {
      const { error } = await db.from("positions").delete().eq("contract", contract).in("account", accounts);
      check("hapus positions", error);
    },
    async upsertNav(row: NavRow) {
      const { error } = await db.from("nav_points").upsert(row, { onConflict: "cordon_id,ts" });
      check("upsert nav_points", error);
    },
  };
}
