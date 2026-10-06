// APROKSIMASI sesi 24/5 berbasis jam ET. Libur bursa dan oracle pause TIDAK tercakup;
// sumber sebenarnya nanti flag dari keeper/oracle (Fase 2).
export type MarketState = "regular" | "extended" | "overnight" | "closed";
const fmt = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", weekday: "short", hour: "numeric", minute: "numeric", hourCycle: "h23" });
const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export function marketState(d: Date): MarketState {
  const p = Object.fromEntries(fmt.formatToParts(d).map((x) => [x.type, x.value]));
  const day = DAYS.indexOf(p.weekday), m = Number(p.hour) * 60 + Number(p.minute);
  if (day === 6 || (day === 5 && m >= 1200) || (day === 0 && m < 1200)) return "closed";
  if (m >= 570 && m < 960) return "regular";
  if ((m >= 240 && m < 570) || (m >= 960 && m < 1200)) return "extended";
  return "overnight";
}
export function nextChange(d: Date): string | null {
  const s = marketState(d), start = Math.floor(d.getTime() / 900000) * 900000;
  for (let k = 1; k <= 8 * 96; k++) { const t = new Date(start + k * 900000); if (marketState(t) !== s) return t.toISOString(); }
  return null;
}
