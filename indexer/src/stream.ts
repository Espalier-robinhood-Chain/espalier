// Murni. Nama aliran yang boleh dipanggil cron: "cordon" (utama), "cordon1", "cordon2"... (urutan EXTRA_CORDONS), "spur", "graft".
export type StreamSpec = { kind: "cordon"; index: number } | { kind: "spur" } | { kind: "graft" };

export function parseStream(s: string): StreamSpec | null {
  if (s === "spur") return { kind: "spur" };
  if (s === "graft") return { kind: "graft" };
  const m = /^cordon(\d{0,2})$/.exec(s);
  return m ? { kind: "cordon", index: m[1] === "" ? 0 : Number(m[1]) } : null;
}
