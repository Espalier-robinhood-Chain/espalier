import test from "node:test";
import assert from "node:assert/strict";
import { loadConfig } from "../src/config.ts";

const base = { KEEPER_RPC_URL: "http://x", CORDON_VAULT_ADDRESS: "0x" + "11".repeat(20), SUPABASE_URL: "http://s", SUPABASE_SERVICE_ROLE_KEY: "k" };
const V = "0x" + "ee".repeat(20), K = "0x" + "ab".repeat(32), ADDR = "0x" + "90".repeat(20);

test("config: Spur opsional; mode default dry-run", () => {
  assert.equal(loadConfig(base).spur, null);
  const c = loadConfig({ ...base, SPUR_VAULT_ADDRESS: V, KEEPER_ADDRESS: ADDR }).spur!;
  assert.equal(c.mode, "dry-run"); assert.equal(c.rfqUrl, null); assert.equal(c.rfqTimeoutMs, 5000);
});

test("config: live butuh kunci; dry-run butuh alamat; nilai salah ditolak, bukan diabaikan", () => {
  assert.throws(() => loadConfig({ ...base, SPUR_VAULT_ADDRESS: V, SPUR_MODE: "live", KEEPER_ADDRESS: ADDR }), /KEEPER_PRIVATE_KEY/);
  assert.throws(() => loadConfig({ ...base, SPUR_VAULT_ADDRESS: V }), /KEEPER_ADDRESS/);
  assert.throws(() => loadConfig({ ...base, SPUR_VAULT_ADDRESS: V, SPUR_MODE: "yolo", KEEPER_ADDRESS: ADDR }), /SPUR_MODE/);
  assert.throws(() => loadConfig({ ...base, SPUR_VAULT_ADDRESS: V, SPUR_MODE: "live", KEEPER_PRIVATE_KEY: "0x12" }), /KEEPER_PRIVATE_KEY/);
  assert.throws(() => loadConfig({ ...base, SPUR_VAULT_ADDRESS: "0x123", KEEPER_ADDRESS: ADDR }), /SPUR_VAULT_ADDRESS/);
  assert.throws(() => loadConfig({ ...base, SPUR_VAULT_ADDRESS: V, KEEPER_ADDRESS: ADDR, RFQ_URL: "ftp://x" }), /RFQ_URL/);
  assert.equal(loadConfig({ ...base, SPUR_VAULT_ADDRESS: V, SPUR_MODE: "live", KEEPER_PRIVATE_KEY: K, RFQ_URL: "https://r", RFQ_TOKEN: "t" }).spur!.mode, "live");
});

test("config: KEEPER_MODE live untuk pruning Cordon butuh kunci keeper", () => {
  assert.throws(() => loadConfig({ ...base, KEEPER_MODE: "live" }), /KEEPER_PRIVATE_KEY/);
});

test("config: Graft opsional, env sendiri (GRAFT_*), tidak mengubah Spur", () => {
  const c0 = loadConfig({ ...base, SPUR_VAULT_ADDRESS: V, KEEPER_ADDRESS: ADDR });
  assert.equal(c0.graft, null);
  const c = loadConfig({ ...base, SPUR_VAULT_ADDRESS: V, GRAFT_VAULT_ADDRESS: "0x" + "dd".repeat(20), KEEPER_ADDRESS: ADDR });
  assert.equal(c.graft!.vault, "0x" + "dd".repeat(20)); assert.equal(c.graft!.mode, "dry-run"); assert.equal(c.spur!.vault, V);
  // Graft saja, tanpa Spur, juga sah.
  assert.equal(loadConfig({ ...base, GRAFT_VAULT_ADDRESS: V, KEEPER_ADDRESS: ADDR }).spur, null);
  assert.throws(() => loadConfig({ ...base, GRAFT_VAULT_ADDRESS: "0x123", KEEPER_ADDRESS: ADDR }), /GRAFT_VAULT_ADDRESS/);
  assert.throws(() => loadConfig({ ...base, GRAFT_VAULT_ADDRESS: V, GRAFT_MODE: "live", KEEPER_ADDRESS: ADDR }), /GRAFT_MODE=live butuh KEEPER_PRIVATE_KEY/);
  assert.throws(() => loadConfig({ ...base, GRAFT_VAULT_ADDRESS: V, GRAFT_MODE: "yolo", KEEPER_ADDRESS: ADDR }), /GRAFT_MODE/);
  assert.throws(() => loadConfig({ ...base, GRAFT_VAULT_ADDRESS: V }), /KEEPER_ADDRESS/);
});
