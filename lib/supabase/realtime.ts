import type { SupabaseClient } from "@supabase/supabase-js";
import { supabaseKey, supabaseUrl } from "./env";

// Klien khusus Realtime di browser: hanya anon/publishable key, tanpa sesi (tidak menulis cookie atau localStorage).
// Dimuat dengan import() dinamis setelah halaman interaktif, jadi paket Supabase tidak menambah JS awal halaman.
// Satu klien dipakai bersama; promise-nya di-cache supaya tidak membuat banyak koneksi WebSocket.
let cached: Promise<SupabaseClient | null> | null = null;

export function getRealtimeClient(): Promise<SupabaseClient | null> {
  if (!supabaseUrl || !supabaseKey) return Promise.resolve(null);
  cached ??= import("@supabase/supabase-js").then(({ createClient }) =>
    createClient(supabaseUrl as string, supabaseKey as string, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
      realtime: { params: { eventsPerSecond: 5 } },
    }),
  );
  return cached;
}
