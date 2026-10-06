import type { NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/proxy";

// Next 16: proxy.ts menggantikan middleware.ts. Hanya rute yang membaca sesi login. Proxy bukan penjaga akses:
// keputusan akses ada di RLS dan di tiap Route Handler (lihat app/api/me/wall-privacy/route.ts).
export async function proxy(request: NextRequest) {
  return updateSession(request);
}

export const config = {
  matcher: ["/wall", "/api/accounts/:path*", "/api/me/:path*"],
};
