// Supabase palsu untuk menguji web tanpa proyek Supabase: PostgREST (subset), Realtime (postgres_changes)
// dan endpoint admin untuk mengubah data. Menggantikan scripts/fake-postgrest.mjs untuk uji Realtime.
//
//   node scripts/fake-supabase.mjs [port=4010]
//   NEXT_PUBLIC_SUPABASE_URL=http://localhost:4010 NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=fake npm run build
//
// PostgREST: filter eq/gte/in, order, limit. Select diabaikan (semua kolom dikembalikan).
// Realtime: protokol Phoenix serializer v2 (array JSON [join_ref, ref, topic, event, payload]), cukup untuk
//   @supabase/realtime-js: phx_join (balasan memuat id langganan), heartbeat, phx_leave, dan push postgres_changes.
// Admin (POST, JSON):
//   /__admin/mutate  {op:"insert"|"update", table, row, match}   ubah data lalu kirim event ke pelanggan yang cocok
//   /__admin/drop                                                  putuskan semua WebSocket (klien akan menyambung ulang)
//   /__admin/refuse  {on:true|false}                               tolak koneksi WebSocket baru
//   /__admin/reset                                                 kembalikan data awal
//   GET /__admin/stats                                             jumlah pelanggan, riwayat join, jumlah request REST
import http from "node:http";
import { WebSocketServer } from "ws";

const PORT = Number(process.argv[2] ?? 4010);
const a = (c) => "0x" + c.repeat(40);
const d = (s) => `2026-${s}T20:00:00Z`;
export const IDS = {
  cordon: "11111111-1111-4111-8111-111111111111",
  cordon2: "22222222-2222-4222-8222-222222222222",
  vault: "33333333-3333-4333-8333-333333333333",
};
const seed = () => ({
  cordons: [
    { id: IDS.cordon, address: a("1"), symbol: "cMAG7", name: "Magnificent Seven", is_demo: true },
    { id: IDS.cordon2, address: a("9"), symbol: "cCHIP", name: "Chips", is_demo: true },
  ],
  cordon_assets: ["AAPL", "MSFT", "NVDA"].map((t, i) => ({ cordon_id: IDS.cordon, token: a(String(i + 3)), ticker: t, target_weight_bps: [4000, 3500, 2500][i] })),
  nav_points: [
    ...[100, 101, 102].map((n, i) => ({ cordon_id: IDS.cordon, ts: `2026-09-${28 + i}T00:00:00Z`, nav_per_share: n, total_supply: 1000, tvl_usd: n * 1000 })),
    { cordon_id: IDS.cordon2, ts: "2026-09-30T00:00:00Z", nav_per_share: 50, total_supply: 10, tvl_usd: 500 },
  ],
  vaults: [{ id: IDS.vault, address: a("2"), kind: "spur", underlying: "NVDA", symbol: "sNVDA", is_demo: true }],
  rounds: [["09-11", 1], ["09-18", 2], ["09-25", 3], ["10-02", 4]].map(([e, n]) => ({
    vault_id: IDS.vault, round_no: n, strike: 138, expiry: d(e), notional: 10, premium_usdg: 10, spot_start: 100, picker: null,
    settlement_price: n < 4 ? 131 : null, settled_at: n < 4 ? d(e) : null, status: n < 4 ? "settled" : "auctioned",
  })),
  positions: [{ account: a("a"), contract: a("1"), shares: 10, cost_basis_usd: 1000, is_demo: true }],
  harvests: [1, 2, 3].map((n) => ({ account: a("a"), vault_id: IDS.vault, round_no: n, premium_usdg: 10 })),
});
let T = seed();
const stats = { restRequests: 0, joins: [], rest: [] };

// ---- PostgREST (subset)
const cmp = (x, y) => (typeof x === "number" || typeof y === "number" ? Number(x) - Number(y) : x > y ? 1 : x < y ? -1 : 0);
function query(table, params) {
  let rows = [...(T[table] ?? [])];
  for (const [k, v] of params) {
    if (v.startsWith("eq.")) rows = rows.filter((r) => String(r[k]) === v.slice(3));
    else if (v.startsWith("gte.")) rows = rows.filter((r) => cmp(r[k], v.slice(4)) >= 0);
    else if (v.startsWith("in.(")) { const set = v.slice(4, -1).split(","); rows = rows.filter((r) => set.includes(String(r[k]))); }
  }
  const o = params.get("order");
  if (o) { const [c, dir] = o.split("."); rows.sort((x, y) => cmp(x[c], y[c]) * (dir === "desc" ? -1 : 1)); }
  const l = params.get("limit"); if (l) rows = rows.slice(0, Number(l));
  return rows;
}

// ---- Realtime
const wss = new WebSocketServer({ noServer: true });
let nextSubId = 1000;
let refuse = false;
const subs = []; // { ws, topic, joinRef, filters: [{id, event, schema, table, filter}] }
const send = (ws, msg) => ws.readyState === 1 && ws.send(JSON.stringify(msg));

wss.on("connection", (ws) => {
  ws.on("message", (raw) => {
    let msg; try { msg = JSON.parse(raw.toString()); } catch { return; }
    if (!Array.isArray(msg)) return;
    const [joinRef, ref, topic, event, payload] = msg;
    if (event === "heartbeat") return send(ws, [null, ref, "phoenix", "phx_reply", { status: "ok", response: {} }]);
    if (event === "phx_join") {
      const filters = (payload?.config?.postgres_changes ?? []).map((f) => ({ id: nextSubId++, event: f.event, schema: f.schema, table: f.table, filter: f.filter }));
      subs.push({ ws, topic, joinRef, filters });
      stats.joins.push({ topic, filters: filters.map(({ event: e, schema, table, filter }) => ({ event: e, schema, table, filter })) });
      send(ws, [joinRef, ref, topic, "phx_reply", { status: "ok", response: { postgres_changes: filters } }]);
      send(ws, [joinRef, null, topic, "system", { message: "Subscribed to PostgreSQL", status: "ok", extension: "postgres_changes", channel: topic.replace("realtime:", "") }]);
      return;
    }
    if (event === "phx_leave") {
      for (let i = subs.length - 1; i >= 0; i--) if (subs[i].ws === ws && subs[i].topic === topic) subs.splice(i, 1);
      send(ws, [joinRef, ref, topic, "phx_reply", { status: "ok", response: {} }]);
      return send(ws, [joinRef, null, topic, "phx_close", {}]);
    }
    // access_token dan lainnya: diabaikan.
  });
  ws.on("close", () => { for (let i = subs.length - 1; i >= 0; i--) if (subs[i].ws === ws) subs.splice(i, 1); });
});

// Cocok seperti Supabase: tabel sama, event sama (atau *), filter "kolom=eq.nilai" dicek pada record baru.
// DELETE tidak mendukung filter di Supabase; di sini DELETE tidak dipakai.
function matches(f, table, type, record) {
  if (f.schema !== "public" || f.table !== table) return false;
  if (f.event !== "*" && f.event.toUpperCase() !== type) return false;
  if (!f.filter) return true;
  const m = /^([a-z_]+)=eq\.(.*)$/.exec(f.filter);
  return !!m && String(record[m[1]]) === m[2];
}
function emit(table, type, record, old) {
  let delivered = 0;
  for (const s of subs) {
    const ids = s.filters.filter((f) => matches(f, table, type, record)).map((f) => f.id);
    if (!ids.length) continue;
    delivered++;
    send(s.ws, [null, null, s.topic, "postgres_changes", { ids, data: { schema: "public", table, commit_timestamp: new Date().toISOString(), type, columns: [], record, old_record: old ?? {}, errors: null } }]);
  }
  return delivered;
}

const readBody = (req) => new Promise((res) => { let b = ""; req.on("data", (c) => (b += c)); req.on("end", () => res(b ? JSON.parse(b) : {})); });
const json = (res, code, body) => { res.statusCode = code; res.setHeader("content-type", "application/json"); res.end(JSON.stringify(body)); };

const server = http.createServer(async (req, res) => {
  const u = new URL(req.url, "http://x");
  if (u.pathname.startsWith("/__admin/")) {
    const op = u.pathname.slice("/__admin/".length);
    if (op === "stats") return json(res, 200, { subscribers: subs.length, topics: subs.map((s) => s.topic), joins: stats.joins, restRequests: stats.restRequests, refuse });
    const body = await readBody(req);
    if (op === "reset") { T = seed(); stats.joins = []; stats.restRequests = 0; return json(res, 200, { ok: true }); }
    if (op === "refuse") { refuse = !!body.on; return json(res, 200, { refuse }); }
    if (op === "drop") { const n = wss.clients.size; wss.clients.forEach((c) => c.terminate()); return json(res, 200, { dropped: n }); }
    if (op === "mutate") {
      const { table, row, match } = body; let record, old;
      if (body.op === "insert") { T[table].push(row); record = row; }
      else {
        const hit = T[table].find((r) => Object.entries(match).every(([k, v]) => String(r[k]) === String(v)));
        if (!hit) return json(res, 404, { error: "no match" });
        old = { ...hit }; Object.assign(hit, row); record = { ...hit };
      }
      return json(res, 200, { delivered: emit(table, body.op === "insert" ? "INSERT" : "UPDATE", record, old) });
    }
    return json(res, 404, { error: "unknown admin op" });
  }
  const table = u.pathname.split("/").pop();
  stats.restRequests++;
  json(res, 200, query(table, u.searchParams));
});
server.on("upgrade", (req, socket, head) => {
  if (!req.url.startsWith("/realtime/v1/websocket") || refuse) return socket.destroy();
  wss.handleUpgrade(req, socket, head, (ws) => wss.emit("connection", ws, req));
});
server.listen(PORT, () => console.log(`fake-supabase on :${PORT}`));
