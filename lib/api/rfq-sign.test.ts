import test from "node:test";
import assert from "node:assert/strict";
import { recoverTypedDataAddress } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { decideQuote, loadRfqPolicy, parseRfqRequest, quoteTypedData } from "./rfq-sign.ts";

const AUCTION = "0xDb2C751db1A9116c7A92645Cd3B884630242f430", SPUR = "0xe631b31C9d7EF1DEC0f76b756f024189686038F0", GRAFT = "0x2821622d360Ded342648178db155bF3F1b637695";
const env = { RFQ_AUCTION_ADDRESS: AUCTION, SPUR_VAULT_ADDRESS: SPUR, GRAFT_VAULT_ADDRESS: GRAFT };
const body = { chainId: 46630, auction: AUCTION, vault: SPUR, round: "5", strikeE18: "275000000000000000000", expiry: "1791455375", notional: "2000000000000000000", minPremium: "0" };
const NOW = 1791400000;

test("loadRfqPolicy: bawaan, mainnet ditolak, auction wajib", () => {
  const p = loadRfqPolicy(env);
  assert.equal(p.chainId, 46630); assert.equal(p.premium, 5_000_000n); assert.equal(p.maxPremium, 20_000_000n); assert.equal(p.vaults.length, 2);
  assert.throws(() => loadRfqPolicy({ ...env, KEEPER_CHAIN_ID: "4663" }), /testnet/);
  assert.throws(() => loadRfqPolicy({ SPUR_VAULT_ADDRESS: SPUR }), /RFQ_AUCTION_ADDRESS/);
  assert.throws(() => loadRfqPolicy({ RFQ_AUCTION_ADDRESS: AUCTION }), /VAULT/);
  assert.throws(() => loadRfqPolicy({ ...env, RFQ_PREMIUM_RAW: "30000000" }), /melebihi/);
});

test("parseRfqRequest: menerima bentuk keeper, menolak yang rusak", () => {
  const r = parseRfqRequest(body);
  assert.equal(r.round, 5n); assert.equal(r.minPremium, 0n);
  assert.throws(() => parseRfqRequest(null), /objek/);
  assert.throws(() => parseRfqRequest({ ...body, vault: "bukan" }), /vault/);
  assert.throws(() => parseRfqRequest({ ...body, round: "-1" }), /round/);
  assert.throws(() => parseRfqRequest({ ...body, round: String(1n << 64n) }), /melebihi/);
});

test("decideQuote: kebijakan", () => {
  const p = loadRfqPolicy(env), r = parseRfqRequest(body);
  const d = decideQuote(r, p, NOW);
  assert.deepEqual(d, { ok: true, premium: 5_000_000n, deadline: BigInt(NOW + 900) });
  const hi = decideQuote({ ...r, minPremium: 8_000_000n }, p, NOW);
  assert.equal(hi.ok && hi.premium, 8_000_000n); // minPremium di atas premi tetap diikuti
  assert.equal(decideQuote({ ...r, minPremium: 25_000_000n }, p, NOW).ok, false);
  assert.equal(decideQuote({ ...r, vault: "0x1111111111111111111111111111111111111111" }, p, NOW).ok, false);
  assert.equal(decideQuote({ ...r, auction: "0x1111111111111111111111111111111111111111" }, p, NOW).ok, false);
  assert.equal(decideQuote({ ...r, chainId: 1 }, p, NOW).ok, false);
  assert.equal(decideQuote({ ...r, expiry: BigInt(NOW) }, p, NOW).ok, false);
  assert.equal(decideQuote({ ...r, vault: SPUR.toLowerCase() as `0x${string}` }, p, NOW).ok, true); // huruf besar/kecil tidak berpengaruh
});

test("quoteTypedData: tanda tangan bisa dipulihkan ke alamat Picker", async () => {
  const acc = privateKeyToAccount(("0x" + "11".repeat(32)) as `0x${string}`);
  const r = parseRfqRequest(body);
  const td = quoteTypedData(r, acc.address, 5_000_000n, BigInt(NOW + 900));
  const signature = await acc.signTypedData(td);
  const who = await recoverTypedDataAddress({ ...td, signature });
  assert.equal(who, acc.address);
  assert.equal(td.domain.name, "EspalierHarvestAuction"); assert.equal(td.domain.version, "1");
  assert.equal(td.types.Quote.map((f) => f.name).join(","), "vault,picker,round,strikeE18,expiry,notional,premium,deadline");
});

test("mainnet: butuh opt-in, batas eksplisit, dan notional dibatasi", () => {
  const m = { ...env, KEEPER_CHAIN_ID: "4663" };
  assert.throws(() => loadRfqPolicy(m), /RFQ_ALLOW_MAINNET/);
  assert.throws(() => loadRfqPolicy({ ...m, RFQ_ALLOW_MAINNET: "true" }), /RFQ_PREMIUM_RAW wajib/);
  const full = { ...m, RFQ_ALLOW_MAINNET: "true", RFQ_PREMIUM_RAW: "5000000", RFQ_MAX_PREMIUM_RAW: "10000000", RFQ_MAX_NOTIONAL_RAW: "2000000000000000000" };
  assert.throws(() => loadRfqPolicy({ ...full, RFQ_MAX_NOTIONAL_RAW: "" }), /RFQ_MAX_NOTIONAL_RAW wajib/);
  assert.throws(() => loadRfqPolicy({ ...full, RFQ_MAX_NOTIONAL_RAW: "0" }), /lebih dari 0/);
  const p = loadRfqPolicy(full);
  assert.equal(p.chainId, 4663); assert.equal(p.maxNotional, 2_000_000_000_000_000_000n);
  const r = parseRfqRequest({ ...body, chainId: 4663 });
  assert.equal(decideQuote(r, p, NOW).ok, true);
  assert.equal(decideQuote({ ...r, notional: 2_000_000_000_000_000_001n }, p, NOW).ok, false);
});
