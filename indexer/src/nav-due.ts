// Murni. Cron memanggil indexer tiap `periodMs` tanpa ingatan antar panggilan, jadi snapshot NAV (tiap `everyMs`)
// ditentukan dari jam dinding: true tepat sekali per jendela `everyMs`, pada panggilan pertama di jendela itu.
export function navDue(nowMs: number, everyMs: number, periodMs = 60_000): boolean {
  return Math.floor(nowMs / everyMs) !== Math.floor((nowMs - periodMs) / everyMs);
}
