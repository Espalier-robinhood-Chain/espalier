export class ConfigError extends Error {
  constructor() { super("Supabase env belum diisi"); }
}
const CACHE = { "Cache-Control": "public, s-maxage=30, stale-while-revalidate=300" };
// Respons yang bergantung pada cookie sesi (Wall pribadi, preferensi) tidak boleh masuk cache bersama:
// CDN memakai URL sebagai kunci dan mengabaikan cookie, jadi respons pemilik bisa bocor ke orang lain, dan sebaliknya.
export const NO_STORE = { "Cache-Control": "private, no-store" };

export const ok = (data: unknown, cache: Record<string, string> = CACHE) => Response.json(data, { headers: cache });
export const fail = (status: number, error: string) => Response.json({ error }, { status, headers: NO_STORE });
export const ADDRESS = /^0x[0-9a-fA-F]{40}$/;
export const SYMBOL = /^[A-Za-z0-9]{1,16}$/;

// Bungkus handler: 503 jika env belum diisi, 502 jika Supabase gagal.
export async function guard(fn: () => Promise<Response>) {
  try { return await fn(); }
  catch (e) {
    if (e instanceof ConfigError) return fail(503, "supabase_not_configured");
    console.error(e);
    return fail(502, "upstream_error");
  }
}
