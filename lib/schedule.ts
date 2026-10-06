// Jadwal ILUSTRATIF untuk demo: round berakhir Jumat 16:00 ET. Ini bukan aturan settlement final.
// Libur bursa dan feed 24/5 (apakah round pertama setelah expiry memakai harga after-hours atau belum ada)
// belum tercakup; sumber sebenarnya nanti keeper/oracle (Fase 2, pertanyaan terbuka 9).
// Murni dan tanpa dependensi supaya bisa diuji dengan `node --test`.

const ET = "America/New_York";
const FRIDAY = 5;
const CLOSE_HOUR = 16;
const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

const etFmt = new Intl.DateTimeFormat("en-US", {
  timeZone: ET, hourCycle: "h23", weekday: "short", year: "numeric", month: "numeric", day: "numeric",
  hour: "numeric", minute: "numeric", second: "numeric",
});

type Wall = { wd: number; y: number; m: number; d: number; h: number; min: number; s: number };

function etWall(t: Date): Wall {
  const p = Object.fromEntries(etFmt.formatToParts(t).map((x) => [x.type, x.value]));
  return { wd: DAYS.indexOf(p.weekday), y: +p.year, m: +p.month, d: +p.day, h: +p.hour % 24, min: +p.minute, s: +p.second };
}

// Selisih ET terhadap UTC (ms) pada saat t, termasuk jam musim panas.
function etOffsetMs(t: Date): number {
  const w = etWall(t);
  return Date.UTC(w.y, w.m - 1, w.d, w.h, w.min, w.s) - Math.floor(t.getTime() / 1000) * 1000;
}

// Jam dinding ET -> instan UTC. Dua putaran cukup karena offset hanya berubah di sekitar 02:00 Minggu,
// jauh dari Jumat 16:00. `day` boleh melewati akhir bulan (Date.UTC menormalkannya).
function etWallToInstant(y: number, m: number, day: number, h: number, min: number): Date {
  const asUtc = Date.UTC(y, m - 1, day, h, min);
  const first = asUtc - etOffsetMs(new Date(asUtc));
  return new Date(asUtc - etOffsetMs(new Date(first)));
}

/** Jumat 16:00 ET berikutnya. Bila `now` tepat atau sudah lewat dari itu, mundur ke Jumat minggu depan. */
export function nextHarvestClose(now: Date): Date {
  const w = etWall(now);
  const ahead = (FRIDAY - w.wd + 7) % 7;
  const target = etWallToInstant(w.y, w.m, w.d + ahead, CLOSE_HOUR, 0);
  return target.getTime() > now.getTime() ? target : etWallToInstant(w.y, w.m, w.d + ahead + 7, CLOSE_HOUR, 0);
}

export function splitDuration(totalSeconds: number): { d: number; h: number; m: number; s: number } {
  const t = Math.max(0, Math.floor(totalSeconds));
  return { d: Math.floor(t / 86400), h: Math.floor((t % 86400) / 3600), m: Math.floor((t % 3600) / 60), s: t % 60 };
}

const localFmt = (timeZone: string) => new Intl.DateTimeFormat("en-GB", { timeZone, weekday: "long", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
const wib = localFmt("Asia/Jakarta");

/** Label jam target: "Friday 16:00 ET" dan padanannya di WIB, mis. "Saturday 03:00 WIB". */
export function whenLabels(target: Date): { et: string; wib: string } {
  return { et: "Friday 16:00 ET", wib: `${wib.format(target)} WIB` };
}
