export const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
export const supabaseKey =
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
export const hasSupabaseEnv = Boolean(supabaseUrl && supabaseKey);

export function requireSupabaseEnv() {
  if (!supabaseUrl || !supabaseKey) {
    throw new Error("Supabase env belum diisi. Salin .env.local.example ke .env.local.");
  }
  return { url: supabaseUrl, key: supabaseKey };
}
