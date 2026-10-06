import { createClient } from "@supabase/supabase-js";
import { ConfigError } from "@/lib/api/http";
import { supabaseKey, supabaseUrl } from "./env";

// Klien read-only tanpa cookie (anon/publishable key) untuk Route Handler data publik.
export function createPublicClient() {
  if (!supabaseUrl || !supabaseKey) throw new ConfigError();
  return createClient(supabaseUrl, supabaseKey, { auth: { persistSession: false, autoRefreshToken: false } });
}
