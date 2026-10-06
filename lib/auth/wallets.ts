// Logika akses The Wall yang murni (tanpa dependensi), supaya bisa dites dengan node --test dan dipakai server maupun klien.
// Keputusan akses di sini hanyalah lapisan kedua: lapisan pertama adalah RLS di database (migrasi 0004).

const ADDRESS_LC = /^0x[0-9a-f]{40}$/;

// Hasil rpc `wallet_addresses` → daftar alamat huruf kecil. Apa pun yang bukan alamat dibuang (gagal tertutup).
export function parseWallets(data: unknown): string[] {
  if (!Array.isArray(data)) return [];
  const out = new Set<string>();
  for (const v of data) {
    if (typeof v !== "string") continue;
    const a = v.toLowerCase();
    if (ADDRESS_LC.test(a)) out.add(a);
  }
  return [...out];
}

// Baris `wall_preferences` seperti yang terlihat oleh penonton (RLS: baris publik, atau baris milik sendiri).
export type PrefRow = { is_private: boolean } | null;

export type Access =
  | { kind: "owner"; isPrivate: boolean } // penonton sedang login dengan wallet ini
  | { kind: "public" } // pemilik memilih membuka Wall-nya
  | { kind: "private" }; // bawaan: tanpa baris preferensi, atau baris privat, atau bukan pemilik

export function decideAccess(args: { address: string; wallets: readonly string[]; row: PrefRow }): Access {
  const address = args.address.toLowerCase();
  if (args.wallets.includes(address)) {
    // Tanpa baris = bawaan privat (brief: "default privat").
    return { kind: "owner", isPrivate: args.row ? args.row.is_private !== false : true };
  }
  // Hanya `false` yang persis berarti publik. null, undefined, string, atau apa pun lainnya = privat.
  return args.row && args.row.is_private === false ? { kind: "public" } : { kind: "private" };
}

// Body PUT /api/me/wall-privacy: persis satu kunci `private` bertipe boolean.
export function parsePrivacyBody(body: unknown): { private: boolean } | null {
  if (typeof body !== "object" || body === null || Array.isArray(body)) return null;
  const keys = Object.keys(body);
  if (keys.length !== 1 || keys[0] !== "private") return null;
  const v = (body as Record<string, unknown>).private;
  return typeof v === "boolean" ? { private: v } : null;
}

// Nama cookie sesi @supabase/ssr: sb-<project>-auth-token, dipecah jadi .0, .1 bila besar.
// Tanpa cookie ini penonton pasti anonim, jadi server tidak perlu bertanya apa pun ke database soal siapa dia.
const AUTH_COOKIE = /^sb-.+-auth-token(\.\d+)?$/;
export const hasAuthCookie = (names: readonly string[]) => names.some((n) => AUTH_COOKIE.test(n));
