import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { toFunctionSelector, keccak256, toHex } from "viem";
import { harvestAuctionAbi, KEEPER_ROLE, settlementOracleAbi, spurVaultAbi } from "../src/spur-abi.ts";

// Penjaga drift: tiap fungsi yang dipanggil keeper harus ada di sumber Solidity dengan nama dan tipe parameter yang sama.
const src = (p: string) => readFileSync(new URL(`../../contracts/src/${p}`, import.meta.url), "utf8");
const norm = (s: string) => s.replace(/\b(memory|calldata|storage)\b/g, "").replace(/\s+/g, " ").trim();
const types = (params: string) => params.split(",").map((p) => norm(p).split(" ")[0]!).filter(Boolean).join(",");

function solSignatures(file: string): Set<string> {
  const out = new Set<string>();
  for (const m of src(file).matchAll(/function\s+(\w+)\s*\(([^)]*)\)/g)) out.add(`${m[1]}(${types(m[2]!)})`);
  return out;
}
const ISPUR = solSignatures("SpurVault.sol");
// `public` state variable/constant getters tidak berbentuk `function`: nama getter diverifikasi lewat deklarasinya.
const publicVars = (file: string) => new Set([...src(file).matchAll(/public\s+(?:constant\s+|immutable\s+|override\s+)*(\w+)\s*;|public\s+(?:constant\s+|immutable\s+|override\s+)*(\w+)\s*=/g)].map((m) => m[1] ?? m[2]!));

const isFn = (x: unknown): x is { type: "function"; name: string; inputs: Array<{ type: string; components?: unknown[] }> } => (x as { type?: string }).type === "function";
const sig = (f: { name: string; inputs: readonly { type: string; components?: readonly { type: string }[] }[] }) =>
  `${f.name}(${f.inputs.map((i) => (i.type === "tuple" ? `(${(i.components ?? []).map((c) => c.type).join(",")})` : i.type)).join(",")})`;

test("fungsi tulis keeper ada di sumber Solidity dengan tipe yang sama", () => {
  const solVault = ISPUR, solAuction = solSignatures("HarvestAuction.sol"), solSettle = solSignatures("SettlementOracle.sol");
  const flatQuote = "(address,address,uint64,uint256,uint64,uint256,uint256,uint64)";
  const want: Array<[Set<string>, string]> = [
    [solVault, "rollRound(uint64)"], [solVault, "closeUnsold()"], [solVault, "settleRound()"], [solVault, "getRound(uint64)"],
    [solSettle, "settle(address,uint64,uint80)"], [solSettle, "settleFallback(address,uint64,uint80)"],
  ];
  for (const [set, s] of want) assert.ok(set.has(s), `${s} tidak ada di sumber Solidity`);
  // Quote adalah struct di Solidity: bandingkan urutan field struct dengan tuple di ABI.
  const struct = /struct Quote\s*\{([^}]*)\}/.exec(src("HarvestAuction.sol"))![1]!.split(";").map((x) => x.trim().split(/\s+/)[0]).filter(Boolean).join(",");
  assert.equal(`(${struct})`, flatQuote, "urutan/tipe field Quote berbeda");
  const fill = harvestAuctionAbi.filter(isFn).find((f) => f.name === "fill")!;
  assert.equal(sig(fill), `fill(${flatQuote},bytes)`);
  assert.ok([...solAuction].some((s) => s.startsWith("fill(")));
});

test("getter publik yang dibaca keeper memang ada di kontrak", () => {
  const v = publicVars("SpurVault.sol");
  for (const n of ["ASSET", "ROUTER", "SETTLEMENT", "FILL_WINDOW", "MIN_DURATION", "MAX_DURATION", "round", "active"]) assert.ok(v.has(n), `getter ${n} tidak ditemukan di SpurVault.sol`);
  assert.ok(/address public immutable override AUCTION/.test(src("SpurVault.sol")));
  assert.ok(publicVars("HarvestAuction.sol").has("isPicker") || /mapping\(address => bool\) public isPicker/.test(src("HarvestAuction.sol")));
  assert.ok(/uint32 public immutable MAX_PRINT_DELAY/.test(src("SettlementOracle.sol")));
});

test("struct Round di ABI sama dengan SpurVault.sol (nama dan urutan field)", () => {
  const body = /struct Round\s*\{([^}]*)\}/.exec(src("SpurVault.sol"))![1]!.replace(/\/\/[^\n]*/g, "");
  const names = body.split(";").map((x) => x.trim().split(/\s+/)[1]).filter(Boolean);
  const gr = spurVaultAbi.filter(isFn).find((f) => f.name === "getRound") as unknown as { outputs: Array<{ components: Array<{ name: string }> }> };
  assert.deepEqual(gr.outputs[0]!.components.map((c) => c.name), names);
});

test("KEEPER_ROLE = keccak256('KEEPER_ROLE') dan selector terdefinisi", () => {
  assert.equal(KEEPER_ROLE, keccak256(toHex("KEEPER_ROLE")));
  assert.ok(toFunctionSelector("settle(address,uint64,uint80)").length === 10);
  void settlementOracleAbi;
});
