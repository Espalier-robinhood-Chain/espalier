// Pemeriksaan asal permintaan untuk Route Handler yang menulis dengan cookie sesi (lapisan tambahan di atas SameSite=Lax).
// Murni: hanya butuh sesuatu yang punya get(nama), jadi bisa dites tanpa Next.
type HeaderBag = { get(name: string): string | null };

export function isSameOrigin(h: HeaderBag): boolean {
  const site = h.get("sec-fetch-site");
  if (site !== null && site !== "same-origin") return false;
  const origin = h.get("origin");
  if (!origin) return false; // browser selalu mengirim Origin pada PUT/POST; klien tanpa Origin tidak boleh memakai cookie
  let originHost: string;
  try { originHost = new URL(origin).host; } catch { return false; }
  const host = (h.get("x-forwarded-host") ?? h.get("host") ?? "").split(",")[0].trim();
  return host !== "" && originHost === host;
}
