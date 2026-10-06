import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { hasAuthCookie } from "@/lib/auth/wallets";
import { supabaseKey, supabaseUrl } from "./env";

// Menyegarkan sesi Supabase (token akses berumur pendek) sebelum Server Component membacanya. Server Component tidak
// bisa menulis cookie, jadi penyegaran harus terjadi di sini. Hanya dijalankan untuk rute yang membaca sesi (matcher
// di proxy.ts) dan hanya bila ada cookie sesi: pengunjung anonim tidak memicu panggilan apa pun ke Supabase.
export async function updateSession(request: NextRequest) {
  let response = NextResponse.next({ request });
  if (!supabaseUrl || !supabaseKey) return response;
  if (!hasAuthCookie(request.cookies.getAll().map((c) => c.name))) return response;

  const supabase = createServerClient(supabaseUrl, supabaseKey, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll(list, headers?: Record<string, string>) {
        list.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({ request });
        list.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
        // @supabase/ssr memberi header anti-cache untuk respons yang membawa Set-Cookie (agar CDN tidak menyimpannya).
        Object.entries(headers ?? {}).forEach(([k, v]) => response.headers.set(k, v));
      },
    },
  });
  // getClaims memverifikasi JWT dan menyegarkannya bila kedaluwarsa. Jangan menjalankan kode lain di antara
  // createServerClient dan baris ini.
  await supabase.auth.getClaims();
  return response;
}
