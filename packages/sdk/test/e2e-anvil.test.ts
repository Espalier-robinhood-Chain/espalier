// E2E terhadap kontrak ASLI (dikompilasi dengan solc-js) di anvil lokal, lewat @espalier/sdk.
// Dilewati bila anvil (ANVIL_BIN) atau contracts/lib (OpenZeppelin) tidak ada.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import {
  createPublicClient, createWalletClient, http, getContract, parseUnits, type Abi, type Address, type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import {
  cordonVaultAbi, oracleRouterAbi, decodeCordonError, fullMask, maxWithSlippage, minWithSlippage,
  readVaultInfo, quoteMint, quoteRedeem, readNav, checkReadiness,
} from "../src/index.ts";

const ANVIL = process.env.ANVIL_BIN ?? "anvil";
const root = path.resolve(import.meta.dirname, "../../../contracts");
const haveLib = fs.existsSync(path.join(root, "lib/openzeppelin-contracts/contracts"));
const require = createRequire(import.meta.url);
const skip = !haveLib ? "contracts/lib (OpenZeppelin) tidak ada" : false;

const PORT = 8561;
const RPC = `http://127.0.0.1:${PORT}`;
const KEY0 = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80" as const;
const KEY1 = "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d" as const;
const admin = privateKeyToAccount(KEY0);
const user = privateKeyToAccount(KEY1);
const pub = createPublicClient({ transport: http(RPC) });
const wAdmin = createWalletClient({ account: admin, transport: http(RPC), chain: undefined });
const wUser = createWalletClient({ account: user, transport: http(RPC), chain: undefined });

let proc: ChildProcess;
const compiled: Record<string, { abi: Abi; bytecode: Hex }> = {};

function compile() {
  const solc = require("solc");
  const files = ["src/MarketSession.sol", "src/OracleRouter.sol", "src/CordonVault.sol", "test/mocks/MockERC20.sol", "test/mocks/MockAggregator.sol"];
  const sources: Record<string, { content: string }> = {};
  for (const f of files) sources[f] = { content: fs.readFileSync(path.join(root, f), "utf8") };
  const remap: [string, string][] = [["@openzeppelin/contracts/", "lib/openzeppelin-contracts/contracts/"], ["forge-std/", "lib/forge-std/src/"]];
  const input = { language: "Solidity", sources, settings: { evmVersion: "cancun", optimizer: { enabled: true, runs: 200 }, outputSelection: { "*": { "*": ["abi", "evm.bytecode.object"] } } } };
  const out = JSON.parse(solc.compile(JSON.stringify(input), { import: (p: string) => {
    let q = p; for (const [a, b] of remap) if (p.startsWith(a)) q = b + p.slice(a.length);
    const f = path.join(root, q);
    return fs.existsSync(f) ? { contents: fs.readFileSync(f, "utf8") } : { error: "not found " + p };
  } }));
  const errs = (out.errors ?? []).filter((e: { severity: string }) => e.severity === "error");
  if (errs.length) throw new Error(errs.map((e: { formattedMessage: string }) => e.formattedMessage).join("\n"));
  for (const f of files) for (const [name, c] of Object.entries<any>(out.contracts[f])) compiled[name] = { abi: c.abi, bytecode: ("0x" + c.evm.bytecode.object) as Hex };
}

async function deploy(name: string, args: unknown[] = []): Promise<Address> {
  const c = compiled[name]!;
  const hash = await wAdmin.deployContract({ abi: c.abi, bytecode: c.bytecode, args, chain: null });
  const r = await pub.waitForTransactionReceipt({ hash });
  assert.ok(r.contractAddress, `deploy ${name}`);
  return r.contractAddress!;
}
async function send(w: typeof wAdmin, address: Address, abi: Abi, functionName: string, args: unknown[] = []) {
  const { request } = await pub.simulateContract({ address, abi, functionName, args, account: w.account });
  const hash = await w.writeContract({ ...request, chain: null });
  const r = await pub.waitForTransactionReceipt({ hash });
  assert.equal(r.status, "success", functionName);
}

let vault: Address, router: Address;
let tokens: Address[] = [];
const erc20: Abi = [
  { type: "function", name: "mint", stateMutability: "nonpayable", inputs: [{ type: "address" }, { type: "uint256" }], outputs: [] },
  { type: "function", name: "approve", stateMutability: "nonpayable", inputs: [{ type: "address" }, { type: "uint256" }], outputs: [{ type: "bool" }] },
  { type: "function", name: "balanceOf", stateMutability: "view", inputs: [{ type: "address" }], outputs: [{ type: "uint256" }] },
];

before(async () => {
  if (skip) return;
  compile();
  proc = spawn(ANVIL, ["--port", String(PORT), "--silent"], { stdio: "ignore" });
  for (let i = 0; i < 50; i++) { try { await pub.getChainId(); break; } catch { await new Promise((r) => setTimeout(r, 200)); } }
  // Rabu 2026-10-07 16:00 UTC = 12:00 ET (sesi regular, DST berlaku)
  await pub.request({ method: "evm_setNextBlockTimestamp" as never, params: [Math.floor(Date.UTC(2026, 9, 7, 16) / 1000)] as never });
  await pub.request({ method: "evm_mine" as never, params: [] as never });

  const market = await deploy("MarketSession", [admin.address]);
  router = await deploy("OracleRouter", [admin.address, "0x0000000000000000000000000000000000000000", 3600n, market]);
  const specs: [string, number, bigint][] = [["AAA", 18, 100n], ["BBB", 18, 50n], ["CCC", 6, 10n]];
  for (const [sym, dec, px] of specs) {
    const t = await deploy("MockERC20", [sym, sym, dec]);
    const f = await deploy("MockAggregator", [8]);
    await send(wAdmin, f, compiled.MockAggregator!.abi, "setRound", [px * 10n ** 8n]);
    await send(wAdmin, router, oracleRouterAbi as Abi, "setAsset", [t, f, 3600n, false]);
    tokens.push(t);
  }
  vault = await deploy("CordonVault", [admin.address, router, "Cordon test", "cT", tokens, [5000, 3000, 2000]]);
  // seed: 100 share; 10 AAA, 20 BBB, 50 CCC (6 desimal)
  const seed = [parseUnits("10", 18), parseUnits("20", 18), parseUnits("50", 6)];
  for (let i = 0; i < 3; i++) {
    await send(wAdmin, tokens[i]!, erc20, "mint", [admin.address, seed[i]!]);
    await send(wAdmin, tokens[i]!, erc20, "approve", [vault, seed[i]!]);
  }
  await send(wAdmin, vault, cordonVaultAbi as Abi, "seed", [parseUnits("100", 18), admin.address, seed]);
  // dana pengguna
  for (let i = 0; i < 3; i++) await send(wAdmin, tokens[i]!, erc20, "mint", [user.address, 10n ** 30n]);
});
after(() => { proc?.kill(); });

test("readVaultInfo + readNav membaca vault asli", { skip }, async () => {
  const info = await readVaultInfo(pub as never, vault);
  assert.equal(info.symbol, "cT");
  assert.deepEqual(info.components.map((a) => a.toLowerCase()), tokens.map((a) => a.toLowerCase()));
  assert.deepEqual([...info.targetWeightsBps], [5000, 3000, 2000]);
  assert.equal(info.totalSupply, parseUnits("100", 18));
  const nav = await readNav(pub as never, vault);
  assert.equal(nav.ok, true);
  // 10×100 + 20×50 + 50×10 = 2500 USD → NAV/share = 25
  assert.equal(nav.totalValueE18, parseUnits("2500", 18));
  assert.equal(nav.navPerShareE18, parseUnits("25", 18));
});

test("alur mint → redeem lewat helper SDK", { skip }, async () => {
  const shares = parseUnits("10", 18);
  const q = await quoteMint(pub as never, vault, shares);
  assert.deepEqual([...q.amounts], [parseUnits("1", 18), parseUnits("2", 18), parseUnits("5", 6)]);
  assert.equal(q.feeShares, 0n);

  const ready = await checkReadiness(pub as never, vault, user.address, tokens, q.amounts);
  assert.ok(ready.every((r) => r.enoughBalance && r.needsApproval), "belum ada allowance");
  for (const r of ready) await send(wUser, r.token, erc20, "approve", [vault, r.needed]);
  const ready2 = await checkReadiness(pub as never, vault, user.address, tokens, q.amounts);
  assert.ok(ready2.every((r) => !r.needsApproval));

  await send(wUser, vault, cordonVaultAbi as Abi, "mint", [shares, user.address, maxWithSlippage(q.amounts, 50)]);
  const bal = await pub.readContract({ address: vault, abi: cordonVaultAbi, functionName: "balanceOf", args: [user.address] });
  assert.equal(bal, shares);

  const r = await quoteRedeem(pub as never, vault, shares);
  const mask = fullMask(3);
  assert.equal(mask, 7n);
  const before3 = await Promise.all(tokens.map((t) => pub.readContract({ address: t, abi: erc20, functionName: "balanceOf", args: [user.address] }) as Promise<bigint>));
  await send(wUser, vault, cordonVaultAbi as Abi, "redeem", [shares, user.address, mask, minWithSlippage(r.amounts, 50)]);
  const after3 = await Promise.all(tokens.map((t) => pub.readContract({ address: t, abi: erc20, functionName: "balanceOf", args: [user.address] }) as Promise<bigint>));
  for (let i = 0; i < 3; i++) assert.equal(after3[i]! - before3[i]!, r.amounts[i]!, `komponen ${i}`);
});

test("decodeCordonError: ZeroAmount, SlippageExceeded(index), InvalidMask", { skip }, async () => {
  const c = getContract({ address: vault, abi: cordonVaultAbi, client: pub });
  const sim = async (fn: string, args: unknown[]) => {
    try { await pub.simulateContract({ address: vault, abi: cordonVaultAbi, functionName: fn as never, args: args as never, account: user.address }); return null; }
    catch (e) { if (process.env.DEBUG_ERR) console.log(String((e as Error).message).slice(0, 600)); return decodeCordonError(e); }
  };
  void c;
  // allowance habis dipakai test sebelumnya → beri allowance besar supaya yang diuji murni slippage
  for (const t of tokens) await send(wUser, t, erc20, "approve", [vault, 10n ** 29n]);
  assert.deepEqual(await sim("mint", [0n, user.address, [0n, 0n, 0n]]), { name: "ZeroAmount" });
  const shares = parseUnits("10", 18);
  const q = await quoteMint(pub as never, vault, shares);
  const tooLow = [...q.amounts]; tooLow[1] = tooLow[1]! - 1n;
  assert.deepEqual(await sim("mint", [shares, user.address, tooLow]), { name: "SlippageExceeded", index: 1 });
  assert.deepEqual(await sim("redeem", [shares, user.address, 0n, [0n, 0n, 0n]]), { name: "InvalidMask" });
  assert.deepEqual(decodeCordonError(new Error("bukan error viem")), { name: "Unknown" });
  // tanpa allowance: error OZ terdeteksi sebagai ERC20InsufficientAllowance, bukan Unknown
  for (const t of tokens) await send(wUser, t, erc20, "approve", [vault, 0n]);
  const noAllowance = await sim("mint", [shares, user.address, q.amounts]);
  assert.equal(noAllowance?.name, "ERC20InsufficientAllowance");
  // komponen dengan kebutuhan 0 tidak butuh approval walau allowance 0
  const zero = await checkReadiness(pub as never, vault, user.address, tokens, [0n, q.amounts[1]!, 0n]);
  assert.deepEqual(zero.map((r) => r.needsApproval), [false, true, false]);
});

test("aset dijeda: mint ditolak AssetPaused(token), redeem tetap jalan", { skip }, async () => {
  await send(wAdmin, router, oracleRouterAbi as Abi, "pauseAsset", [tokens[2]]);
  const shares = parseUnits("1", 18);
  const q = await quoteMint(pub as never, vault, shares);
  let err; try { await pub.simulateContract({ address: vault, abi: cordonVaultAbi, functionName: "mint", args: [shares, user.address, maxWithSlippage(q.amounts, 50)], account: user.address }); } catch (e) { err = decodeCordonError(e); }
  assert.equal(err?.name, "AssetPaused");
  assert.equal(err?.token?.toLowerCase(), tokens[2]!.toLowerCase());
  // redeem in-kind milik admin (seed) masih bisa disimulasikan
  const r = await quoteRedeem(pub as never, vault, shares);
  await pub.simulateContract({ address: vault, abi: cordonVaultAbi, functionName: "redeem", args: [shares, admin.address, 7n, minWithSlippage(r.amounts, 50)], account: admin.address });
});
