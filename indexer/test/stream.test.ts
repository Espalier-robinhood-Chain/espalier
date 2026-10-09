import test from "node:test";
import assert from "node:assert/strict";
import { parseStream } from "../src/stream.ts";

test("parseStream: aliran yang dikenal", () => {
  assert.deepEqual(parseStream("cordon"), { kind: "cordon", index: 0 });
  assert.deepEqual(parseStream("cordon1"), { kind: "cordon", index: 1 });
  assert.deepEqual(parseStream("cordon12"), { kind: "cordon", index: 12 });
  assert.deepEqual(parseStream("spur"), { kind: "spur" });
  assert.deepEqual(parseStream("graft"), { kind: "graft" });
});
test("parseStream: menolak yang lain", () => {
  for (const s of ["", "Cordon", "cordon-1", "cordon123", "spur1", "all", "../x", "cordon1 "]) assert.equal(parseStream(s), null, s);
});
