// Rentang chart NAV di Page C: nilai dari query string `?range=`. Selain daftar ini jatuh ke default.
export const RANGES = [
  { key: "7d", days: 7, label: "7 days" },
  { key: "30d", days: 30, label: "30 days" },
  { key: "90d", days: 90, label: "90 days" },
] as const;
export type RangeKey = (typeof RANGES)[number]["key"];
export const DEFAULT_RANGE: RangeKey = "90d";

export function parseRange(raw: string | string[] | undefined) {
  const v = Array.isArray(raw) ? raw[0] : raw;
  return RANGES.find((r) => r.key === v) ?? RANGES.find((r) => r.key === DEFAULT_RANGE)!;
}
