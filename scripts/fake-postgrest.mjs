import http from "node:http";
const a = (c) => "0x" + c.repeat(40);
const d = (s) => `2026-${s}T20:00:00Z`;
const T = {
  cordons: [{ id: "c1", address: a("1"), symbol: "cMAG7", name: "Magnificent Seven", is_demo: true }],
  cordon_assets: ["AAPL", "MSFT", "NVDA"].map((t, i) => ({ cordon_id: "c1", token: a(String(i + 3)), ticker: t, target_weight_bps: [4000, 3500, 2500][i] })),
  nav_points: [100, 101, 102].map((n, i) => ({ cordon_id: "c1", ts: `2026-09-${28 + i}T00:00:00Z`, nav_per_share: n, total_supply: 1000, tvl_usd: n * 1000 })),
  vaults: [{ id: "v1", address: a("2"), kind: "spur", underlying: "NVDA", symbol: "sNVDA", is_demo: true }],
  rounds: [["09-11", 1], ["09-18", 2], ["09-25", 3], ["10-02", 4]].map(([e, n]) => ({ vault_id: "v1", round_no: n, strike: 138, expiry: d(e), notional: 10, premium_usdg: 10, spot_start: 100, picker: null, settlement_price: n < 4 ? 131 : null, settled_at: n < 4 ? d(e) : null, status: n < 4 ? "settled" : "auctioned" })),
  positions: [{ account: a("a"), contract: a("1"), shares: 10, cost_basis_usd: 1000, is_demo: true }, { account: a("a"), contract: a("2"), shares: 5, cost_basis_usd: 600, is_demo: true }],
  harvests: [1, 2, 3].map((n) => ({ account: a("a"), vault_id: "v1", round_no: n, premium_usdg: 10 })),
};
http.createServer((req, res) => {
  const u = new URL(req.url, "http://x"), table = u.pathname.split("/").pop();
  let rows = [...(T[table] ?? [])];
  for (const [k, v] of u.searchParams) if (v.startsWith("eq.")) rows = rows.filter((r) => String(r[k]) === v.slice(3));
  const o = u.searchParams.get("order");
  if (o) { const [c, dir] = o.split("."); rows.sort((x, y) => (x[c] > y[c] ? 1 : -1) * (dir === "desc" ? -1 : 1)); }
  const l = u.searchParams.get("limit"); if (l) rows = rows.slice(0, Number(l));
  res.setHeader("content-type", "application/json"); res.end(JSON.stringify(rows));
}).listen(4010);
