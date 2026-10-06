import type { SupabaseClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import { ConfigError } from "@/lib/api/http";
import { getWall } from "@/lib/api/queries";
import { createPublicClient } from "@/lib/supabase/public";
import { hasSupabaseEnv } from "@/lib/supabase/env";
import { createClient } from "@/lib/supabase/server";
import { decideAccess, hasAuthCookie, parseWallets, type Access } from "./wallets";

// Penonton = klien Supabase dengan cookie sesinya + alamat wallet yang dia miliki (dari fungsi database
// wallet_addresses, fungsi yang sama dengan yang dipakai kebijakan RLS, jadi tidak ada penguraian JWT di aplikasi).
// RLS tetap penjaga utama; keputusan di sini hanya menentukan pesan yang tampil dan mencegah pembacaan sia-sia.
export type Viewer = { db: SupabaseClient; wallets: string[] };

export async function getViewer(): Promise<Viewer> {
  if (!hasSupabaseEnv) throw new ConfigError();
  const names = (await cookies()).getAll().map((c) => c.name);
  // Tanpa cookie sesi penonton pasti anonim: klien publik cukup, tanpa menyentuh Auth atau menulis cookie.
  if (!hasAuthCookie(names)) return { db: createPublicClient(), wallets: [] };
  const db = await createClient();
  const { data, error } = await db.rpc("wallet_addresses");
  if (error) {
    // Token kedaluwarsa atau sesi dicabut (proxy.ts biasanya sudah menyegarkannya). Jangan biarkan token rusak
    // membuat semua pembacaan gagal: jatuh ke klien anonim.
    console.error("wallet_addresses failed:", error.message);
    return { db: createPublicClient(), wallets: [] };
  }
  return { db, wallets: parseWallets(data) };
}

export async function getWallAccess(v: Viewer, address: string): Promise<Access> {
  const account = address.toLowerCase();
  // RLS: untuk orang lain hanya baris publik yang terlihat; untuk pemilik, barisnya sendiri.
  const { data, error } = await v.db.from("wall_preferences").select("is_private").eq("account", account).maybeSingle();
  if (error) throw new Error(error.message);
  return decideAccess({ address: account, wallets: v.wallets, row: (data as { is_private: boolean } | null) ?? null });
}

// Pilihan privasi wallet yang sedang login (true bila belum pernah memilih). null bila penonton belum login.
export async function getOwnPrivacy(v: Viewer): Promise<boolean | null> {
  const wallet = v.wallets[0];
  if (!wallet) return null;
  const access = await getWallAccess(v, wallet);
  return access.kind === "owner" ? access.isPrivate : null;
}

export type LoadedWall = { kind: "private" } | { kind: "ok"; access: Exclude<Access, { kind: "private" }>; wall: Awaited<ReturnType<typeof getWall>> };

// Dipakai route gambar dan API: periksa akses, baru baca data dengan klien penonton.
export async function loadWall(address: string, viewer?: Viewer): Promise<LoadedWall> {
  const v = viewer ?? (await getViewer());
  const access = await getWallAccess(v, address);
  if (access.kind === "private") return { kind: "private" };
  return { kind: "ok", access, wall: await getWall(address.toLowerCase(), v.db) };
}
