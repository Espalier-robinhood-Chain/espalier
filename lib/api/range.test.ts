import test from "node:test";
import assert from "node:assert/strict";
import { parseRange } from "./range.ts";

test("range: nilai valid, default, dan input aneh", () => {
  assert.equal(parseRange("7d").days, 7);
  assert.equal(parseRange("30d").days, 30);
  assert.equal(parseRange(undefined).key, "90d");
  assert.equal(parseRange("999d").key, "90d");
  assert.equal(parseRange("").key, "90d");
  assert.equal(parseRange(["30d", "7d"]).key, "30d");
});
