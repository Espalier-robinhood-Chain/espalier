import test from "node:test";
import assert from "node:assert/strict";
import { authorized } from "./cron-auth.ts";

test("authorized: hanya header Bearer yang persis sama", () => {
  assert.equal(authorized("Bearer rahasia", "rahasia"), true);
  assert.equal(authorized("Bearer salah!", "rahasia"), false);
  assert.equal(authorized("Bearer rahasia ", "rahasia"), false);
  assert.equal(authorized("rahasia", "rahasia"), false);
  assert.equal(authorized(null, "rahasia"), false);
  assert.equal(authorized("Bearer ", ""), false);
  assert.equal(authorized("Bearer x", undefined), false);
});
