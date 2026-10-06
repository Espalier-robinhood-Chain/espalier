import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { SPUR_EVENT_SIGNATURES } from "../src/spur-abi.ts";

// Penjaga drift: tiap event yang dipakai indexer harus identik (nama, tipe, indexed, urutan) dengan deklarasi di SpurVault.sol.
const norm = (s: string) => s.replace(/\s+/g, " ").replace(/\s*\(\s*/, "(").replace(/\s*,\s*/g, ", ").replace(/\s*\)\s*;?$/, ")").trim();

test("event ABI indexer sama dengan SpurVault.sol", () => {
  const src = readFileSync(new URL("../../contracts/src/SpurVault.sol", import.meta.url), "utf8");
  const solEvents = new Map<string, string>();
  for (const m of src.matchAll(/event\s+(\w+)\s*\(([^)]*)\)\s*;/g)) solEvents.set(m[1]!, norm(`event ${m[1]}(${m[2]!.trim().replace(/,\s*$/, "")})`));
  for (const sig of SPUR_EVENT_SIGNATURES) {
    const name = /event (\w+)\(/.exec(sig)![1]!;
    assert.ok(solEvents.has(name), `event ${name} tidak ada di SpurVault.sol`);
    assert.equal(norm(sig), solEvents.get(name), `event ${name} berbeda dari kontrak`);
  }
});
