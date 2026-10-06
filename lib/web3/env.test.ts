import test from "node:test";
import assert from "node:assert/strict";
import { MAINNET_PUBLIC_RPC, isSpurLive, isTradeLive, isWeb3Enabled, resolveNetworkMode, resolveSpurTarget, resolveWeb3Env } from "./env.ts";

test("env kosong: wallet mati, mainnet jatuh ke RPC publik, testnet tidak ditawarkan", () => {
  const e = resolveWeb3Env({});
  assert.equal(e.projectId, undefined);
  assert.equal(e.mainnetRpc, MAINNET_PUBLIC_RPC);
  assert.equal(e.testnetRpc, undefined);
  assert.equal(e.siteUrl, "http://localhost:3000");
});

test("spasi dan string kosong dianggap tidak diisi", () => {
  const e = resolveWeb3Env({ NEXT_PUBLIC_REOWN_PROJECT_ID: "  ", NEXT_PUBLIC_RH_RPC_MAINNET: "", NEXT_PUBLIC_RH_RPC_TESTNET: " " });
  assert.equal(e.projectId, undefined);
  assert.equal(e.mainnetRpc, MAINNET_PUBLIC_RPC);
  assert.equal(e.testnetRpc, undefined);
});

test("nilai terisi dipakai apa adanya (dipangkas)", () => {
  const e = resolveWeb3Env({ NEXT_PUBLIC_REOWN_PROJECT_ID: " abc123 ", NEXT_PUBLIC_RH_RPC_MAINNET: "https://rpc.example/m", NEXT_PUBLIC_RH_RPC_TESTNET: "https://rpc.example/t", NEXT_PUBLIC_SITE_URL: "https://espalier.xyz" });
  assert.deepEqual(e, { projectId: "abc123", mainnetRpc: "https://rpc.example/m", testnetRpc: "https://rpc.example/t", siteUrl: "https://espalier.xyz" });
});

import { resolveVaultTarget } from "./env.ts";

const ADDR = "0x5FbDB2315678afecb367f032d93F642f64180aa3";

test("vault: tanpa alamat = demo; chain default testnet 46630; simbol default cMAG7", () => {
  assert.equal(resolveVaultTarget({}), undefined);
  assert.deepEqual(resolveVaultTarget({ NEXT_PUBLIC_CORDON_VAULT_ADDRESS: ADDR }), { address: ADDR, chainId: 46630, symbol: "cMAG7" });
  assert.equal(resolveWeb3Env({ NEXT_PUBLIC_CORDON_VAULT_ADDRESS: ADDR }).vault?.address, ADDR);
});

test("vault: alamat salah bentuk, alamat nol, atau chain ngawur dianggap tidak diisi", () => {
  for (const a of ["0x123", "5FbDB2315678afecb367f032d93F642f64180aa3", ADDR + "00", "0x" + "0".repeat(40), "0x" + "g".repeat(40)]) {
    assert.equal(resolveVaultTarget({ NEXT_PUBLIC_CORDON_VAULT_ADDRESS: a }), undefined, a);
  }
  for (const c of ["abc", "-1", "0", "1.5", "1e3"]) assert.equal(resolveVaultTarget({ NEXT_PUBLIC_CORDON_VAULT_ADDRESS: ADDR, NEXT_PUBLIC_CORDON_VAULT_CHAIN_ID: c }), undefined, c);
});

test("vault: chain dan simbol kustom dipakai", () => {
  assert.deepEqual(resolveVaultTarget({ NEXT_PUBLIC_CORDON_VAULT_ADDRESS: ` ${ADDR} `, NEXT_PUBLIC_CORDON_VAULT_CHAIN_ID: "4663", NEXT_PUBLIC_CORDON_VAULT_SYMBOL: "cTEST" }), { address: ADDR, chainId: 4663, symbol: "cTEST" });
});

test("NEXT_MODE: hanya mainnet/testnet yang dikenal (spasi dan huruf besar diabaikan), selain itu simulasi", () => {
  assert.equal(resolveNetworkMode("mainnet"), "mainnet");
  assert.equal(resolveNetworkMode(" Testnet "), "testnet");
  for (const v of [undefined, "", "  ", "main", "test", "devnet", "1"]) assert.equal(resolveNetworkMode(v), undefined, String(v));
  assert.equal("mode" in resolveWeb3Env({}), false);
  assert.equal(resolveWeb3Env({ NEXT_MODE: "TESTNET" }).mode, "testnet");
});

const KEY = { NEXT_PUBLIC_REOWN_PROJECT_ID: "abc" };
const TRPC = { NEXT_PUBLIC_RH_RPC_TESTNET: "https://rpc.example/t" };

test("wallet aktif hanya bila NEXT_MODE + project ID (+ RPC testnet untuk testnet)", () => {
  assert.equal(isWeb3Enabled(resolveWeb3Env({})), false);
  assert.equal(isWeb3Enabled(resolveWeb3Env({ ...KEY })), false, "project ID saja, tanpa mode = simulasi");
  assert.equal(isWeb3Enabled(resolveWeb3Env({ NEXT_MODE: "mainnet" })), false, "mode tanpa project ID");
  assert.equal(isWeb3Enabled(resolveWeb3Env({ ...KEY, NEXT_MODE: "mainnet" })), true, "mainnet jatuh ke RPC publik");
  assert.equal(isWeb3Enabled(resolveWeb3Env({ ...KEY, NEXT_MODE: "testnet" })), false, "testnet tanpa RPC");
  assert.equal(isWeb3Enabled(resolveWeb3Env({ ...KEY, ...TRPC, NEXT_MODE: "testnet" })), true);
});

test("panel live butuh chain vault sama dengan mode, dan simbol sama", () => {
  const vault = { NEXT_PUBLIC_CORDON_VAULT_ADDRESS: ADDR };
  const on = (e: Record<string, string>, sym = "cMAG7") => isTradeLive(resolveWeb3Env({ ...KEY, ...TRPC, ...vault, ...e }), sym);
  assert.equal(on({ NEXT_MODE: "testnet" }), true);
  assert.equal(on({ NEXT_MODE: "testnet" }, "sNVDA"), false);
  assert.equal(on({ NEXT_MODE: "mainnet" }), false, "vault default 46630 bukan chain mainnet");
  assert.equal(on({ NEXT_MODE: "mainnet", NEXT_PUBLIC_CORDON_VAULT_CHAIN_ID: "4663" }), true);
  assert.equal(on({ NEXT_MODE: "testnet", NEXT_PUBLIC_CORDON_VAULT_CHAIN_ID: "4663" }), false);
  assert.equal(on({}), false, "tanpa NEXT_MODE = simulasi walau vault terisi");
});

const SPUR = { NEXT_PUBLIC_SPUR_VAULT_ADDRESS: ADDR };
const LIVE = { NEXT_MODE: "testnet", NEXT_PUBLIC_REOWN_PROJECT_ID: "abc", NEXT_PUBLIC_RH_RPC_TESTNET: "https://rpc.example/t" };

test("spur: tanpa alamat = demo; default chain 46630 dan simbol sNVDA; deepEqual env lama tidak berubah", () => {
  assert.equal(resolveSpurTarget({}), undefined);
  assert.deepEqual(resolveSpurTarget(SPUR), { address: ADDR, chainId: 46630, symbol: "sNVDA" });
  assert.equal("spur" in resolveWeb3Env({}), false);
  assert.equal(resolveWeb3Env(SPUR).spur?.address, ADDR);
});

test("spur: alamat salah bentuk, alamat nol, atau chain ngawur dianggap tidak diisi", () => {
  for (const a of ["0x123", ADDR + "00", "0x" + "0".repeat(40), "0x" + "g".repeat(40)]) {
    assert.equal(resolveSpurTarget({ NEXT_PUBLIC_SPUR_VAULT_ADDRESS: a }), undefined, a);
  }
  for (const c of ["abc", "-1", "0", "1.5", "1e3"]) assert.equal(resolveSpurTarget({ ...SPUR, NEXT_PUBLIC_SPUR_VAULT_CHAIN_ID: c }), undefined, c);
  // Env spur terpisah dari env CordonVault.
  assert.equal(resolveWeb3Env({ NEXT_PUBLIC_CORDON_VAULT_ADDRESS: ADDR }).spur, undefined);
  assert.equal(resolveWeb3Env(SPUR).vault, undefined);
});

test("spur live: butuh wallet aktif, simbol sama, dan chain vault sama dengan NEXT_MODE", () => {
  const live = (e: Record<string, string>, sym = "sNVDA") => isSpurLive(resolveWeb3Env({ ...LIVE, ...SPUR, ...e }), sym);
  assert.equal(live({}), true);
  assert.equal(live({}, "sTSLA"), false, "simbol lain");
  assert.equal(live({ NEXT_PUBLIC_SPUR_VAULT_SYMBOL: "sTSLA" }), false);
  assert.equal(live({ NEXT_PUBLIC_SPUR_VAULT_SYMBOL: "sTSLA" }, "sTSLA"), true);
  assert.equal(live({ NEXT_MODE: "mainnet" }), false, "vault 46630 bukan chain mainnet");
  assert.equal(live({ NEXT_MODE: "mainnet", NEXT_PUBLIC_SPUR_VAULT_CHAIN_ID: "4663" }), true);
  assert.equal(live({ NEXT_MODE: "" }), false, "tanpa NEXT_MODE = simulasi walau vault terisi");
  assert.equal(live({ NEXT_PUBLIC_REOWN_PROJECT_ID: "" }), false);
  assert.equal(isSpurLive(resolveWeb3Env(LIVE), "sNVDA"), false, "tanpa alamat spur");
  // CordonVault dan SpurVault saling tidak mempengaruhi.
  assert.equal(isTradeLive(resolveWeb3Env({ ...LIVE, ...SPUR }), "cMAG7"), false);
});
