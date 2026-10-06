// Logika murni untuk pembaruan langsung (Fase 1 item 20). Tanpa React dan tanpa jaringan, supaya bisa dites.
//
// Pola: Supabase Realtime hanya MEMICU refresh. Setelah ada perubahan di tabel yang relevan, halaman server
// diminta render ulang (router.refresh) dan membaca angka segar lewat jalur yang sama dengan muat pertama.
// Jadi logika turunan (APY, perubahan %, premium simulator) tetap satu-satunya di server.

export type LiveTable = "nav_points" | "rounds";
export type LiveTopic = { table: LiveTable; filter: string };

// Id masuk ke string filter Realtime ("kolom=eq.nilai"). Hanya UUID yang diterima, jadi tak ada karakter
// yang bisa mengubah arti filter.
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Halaman Cordon: titik NAV baru untuk Cordon ini.
export function cordonTopics(cordonId: string): LiveTopic[] {
  return UUID.test(cordonId) ? [{ table: "nav_points", filter: `cordon_id=eq.${cordonId}` }] : [];
}

// Halaman vault: round baru atau berubah (dilelang, settle, premium). Riwayat Harvest di halaman vault
// dibangun dari tabel rounds, jadi satu langganan ini mencakup round aktif dan riwayatnya.
// Tabel harvests (klaim per akun) tidak ditampilkan di halaman vault, jadi tidak dilanggan di sini.
export function vaultTopics(vaultId: string): LiveTopic[] {
  return UUID.test(vaultId) ? [{ table: "rounds", filter: `vault_id=eq.${vaultId}` }] : [];
}

export type LiveStatus = "connecting" | "live" | "paused";

// Status dari callback subscribe() Supabase. SUBSCRIBED = tersambung; sisanya (error, timeout, tertutup) = jeda.
export function statusFromSubscribe(s: string): LiveStatus {
  return s === "SUBSCRIBED" ? "live" : "paused";
}

export const LIVE_TEXT: Record<LiveStatus, { icon: string; text: string }> = {
  connecting: { icon: "○", text: "Connecting to live updates…" },
  live: { icon: "●", text: "Live · this page updates by itself" },
  paused: { icon: "△", text: "Live updates paused · checking again every minute" },
};

// Saat jeda, halaman memeriksa sendiri tiap interval ini (selama tab terlihat).
export const POLL_MS = 60_000;

type Timers = { set: (fn: () => void, ms: number) => unknown; clear: (id: unknown) => void; now: () => number };
const realTimers: Timers = {
  set: (fn, ms) => setTimeout(fn, ms),
  clear: (id) => clearTimeout(id as ReturnType<typeof setTimeout>),
  now: () => Date.now(),
};

// Menggabungkan rentetan event menjadi satu refresh: menunggu `delayMs` setelah event TERAKHIR, tetapi tidak
// pernah menunda lebih dari `maxWaitMs` sejak event PERTAMA (supaya aliran event tanpa henti tetap menyegarkan).
export function createRefreshScheduler(
  run: () => void,
  { delayMs = 800, maxWaitMs = 5000 }: { delayMs?: number; maxWaitMs?: number } = {},
  timers: Timers = realTimers,
) {
  let timer: unknown = null;
  let firstAt = 0;
  return {
    schedule() {
      const now = timers.now();
      if (timer === null) firstAt = now;
      else timers.clear(timer);
      const wait = Math.max(0, Math.min(delayMs, firstAt + maxWaitMs - now));
      timer = timers.set(() => { timer = null; run(); }, wait);
    },
    cancel() {
      if (timer !== null) timers.clear(timer);
      timer = null;
    },
    get pending() { return timer !== null; },
  };
}
