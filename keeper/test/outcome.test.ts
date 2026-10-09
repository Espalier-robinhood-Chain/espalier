import test from "node:test";
import assert from "node:assert/strict";
import { describeCordonOutcome, describeOutcome, keeperEnv, safeText } from "../src/outcome.ts";

test("describeOutcome: hanya 'failed' yang ok=false", () => {
  assert.deepEqual(describeOutcome("spur", { kind: "waiting", reason: "jendela fill 3600s" }), { ok: true, kind: "waiting", line: "spur tunggu: jendela fill 3600s" });
  assert.equal(describeOutcome("graft", { kind: "blocked", job: "spur:roll", reason: "harga basi" }).ok, true);
  assert.equal(describeOutcome("spur", { kind: "dry-run", job: "spur:roll", detail: "expiry 1" }).ok, true);
  const sent = describeOutcome("spur", { kind: "sent", job: "spur:roll", txHash: "0xabc" });
  assert.equal(sent.ok, true); assert.equal(sent.txHash, "0xabc");
  const failed = describeOutcome("graft", { kind: "failed", job: "spur:settle-round", error: "revert", txHash: "0xdef" });
  assert.equal(failed.ok, false); assert.match(failed.line, /GAGAL spur:settle-round: revert/);
});
test("keeperEnv: KEEPER_* mengikuti INDEXER_* hanya bila kosong", () => {
  const a = keeperEnv({ INDEXER_RPC_URL: "https://a", INDEXER_CHAIN_ID: "46630" });
  assert.equal(a.KEEPER_RPC_URL, "https://a"); assert.equal(a.KEEPER_CHAIN_ID, "46630");
  const b = keeperEnv({ INDEXER_RPC_URL: "https://a", KEEPER_RPC_URL: "https://b", KEEPER_CHAIN_ID: " " , INDEXER_CHAIN_ID: "1" });
  assert.equal(b.KEEPER_RPC_URL, "https://b"); assert.equal(b.KEEPER_CHAIN_ID, "1");
});
test("safeText: URL dibuang dan dipotong", () => {
  const t = safeText(new Error("gagal https://x.g.alchemy.com/v2/RAHASIA lalu " + "x".repeat(400)));
  assert.ok(!t.includes("RAHASIA")); assert.ok(t.includes("<url>")); assert.ok(t.length <= 300);
});

test("describeCordonOutcome: hanya 'failed' yang ok=false", () => {
  assert.deepEqual(describeCordonOutcome("cMAG7", { kind: "skipped", reason: "prices not live" }), { ok: true, kind: "skipped", line: "cMAG7 lewati: prices not live" });
  const dry = describeCordonOutcome("cCHIP", { kind: "dry-run", trades: [], driftBps: 1397 });
  assert.equal(dry.ok, true); assert.match(dry.line, /cCHIP DRY-RUN: drift 1397 bps, rencana 0 trade/);
  const pruned = describeCordonOutcome("cVOLT", { kind: "pruned", txHash: "0xabc", before: 1397, after: 40, trades: 6 });
  assert.equal(pruned.ok, true); assert.equal(pruned.txHash, "0xabc"); assert.match(pruned.line, /1397 -> 40 bps \(6 trade\)/);
  const failed = describeCordonOutcome("cMAG7", { kind: "failed", error: "gagal https://x.g.alchemy.com/v2/RAHASIA revert" });
  assert.equal(failed.ok, false); assert.ok(!failed.line.includes("RAHASIA"));
});
