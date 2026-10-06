import { fail, guard, NO_STORE, ok } from "@/lib/api/http";
import { getViewer } from "@/lib/auth/server";
import { isSameOrigin } from "@/lib/auth/request";
import { parsePrivacyBody } from "@/lib/auth/wallets";

export const dynamic = "force-dynamic";

// Satu-satunya endpoint tulis di web. Pemeriksaan dilakukan di sini, tidak hanya di proxy.ts:
//   1. asal permintaan sama (lapisan tambahan di atas cookie SameSite=Lax),
//   2. body persis { private: boolean },
//   3. sesi diverifikasi ke server Auth (getUser), bukan hanya dibaca dari cookie,
//   4. wallet diambil dari database (wallet_addresses), bukan dari body: pemilik tidak bisa menunjuk alamat lain,
//   5. RLS menolak sekali lagi bila ada yang lolos.
export async function PUT(request: Request) {
  if (!isSameOrigin(request.headers)) return fail(403, "bad_origin");
  const body = parsePrivacyBody(await request.json().catch(() => null));
  if (!body) return fail(400, "invalid_body");
  return guard(async () => {
    const viewer = await getViewer();
    const wallet = viewer.wallets[0];
    if (!wallet) return fail(401, "not_signed_in");
    const { data: auth, error: authError } = await viewer.db.auth.getUser();
    if (authError || !auth.user) return fail(401, "not_signed_in");
    const { data, error } = await viewer.db
      .from("wall_preferences")
      .upsert({ account: wallet, is_private: body.private }, { onConflict: "account" })
      .select("is_private")
      .single();
    if (error) throw new Error(error.message);
    return ok({ private: data.is_private }, NO_STORE);
  });
}
