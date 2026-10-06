import { test } from "node:test";
import assert from "node:assert/strict";
import { BaseError } from "viem";
import { graftVaultAbi, spurVaultAbi } from "../src/abis.ts";
import { decodeGraftError, graftWriteAbi } from "../src/graft.ts";

const sig = (abi: readonly any[], type: string) => abi.filter((x) => x.type === type).map((x) => x.name).sort();

test("graftVaultAbi = spurVaultAbi + UNDERLYING (antarmuka Graft cermin Spur)", () => {
  const g = sig(graftVaultAbi, "function"), s = sig(spurVaultAbi, "function");
  assert.deepEqual(g.filter((n) => !s.includes(n)), ["UNDERLYING"]);
  assert.deepEqual(s.filter((n) => !g.includes(n)), []);
  assert.deepEqual(sig(graftVaultAbi, "event"), sig(spurVaultAbi, "event"));
  assert.deepEqual(sig(graftVaultAbi, "error"), sig(spurVaultAbi, "error"));
});
test("constructor Graft memakai underlying_", () => {
  const c = (graftVaultAbi as any[]).find((x) => x.type === "constructor");
  assert.ok(c.inputs.some((i: any) => i.name === "underlying_"));
  assert.ok(!c.inputs.some((i: any) => i.name === "premium_"));
});
test("graftWriteAbi memuat error token", () => {
  assert.ok(graftWriteAbi.some((x: any) => x.type === "error" && x.name === "ERC20InsufficientAllowance"));
});
test("decodeGraftError tidak melempar dan mengembalikan Unknown untuk error asing", () => {
  assert.equal(decodeGraftError(new Error("x")).name, "Unknown");
  assert.equal(decodeGraftError(new BaseError("x")).name, "Unknown");
  assert.equal(decodeGraftError(null).name, "Unknown");
});
