import test from "node:test";
import assert from "node:assert/strict";
import { loadFeedConfig, usdToE8 } from "./feed-config.ts";

const A = "0x4ecE119001a4aD14f2D614C258eD18E0e5741600", B = "0x3912c0A783177A042F536E3f6aEeF9ed725572D4";
const ok = { INDEXER_RPC_URL: "https://rpc.example/v2/x", FEED_ADDRESSES: `${A}=250, ${B}=15.5`, FEED_BOT_PRIVATE_KEY: "0x" + "ab".repeat(32) };

test("usdToE8: dolar ke 8 desimal", () => {
  assert.equal(usdToE8("250"), 25000000000n);
  assert.equal(usdToE8("15.5"), 1550000000n);
  assert.equal(usdToE8("0.03"), 3000000n);
  assert.equal(usdToE8("3.12345678"), 312345678n);
  for (const bad of ['0', '0.0', '-1', '1.123456789', 'abc', '', '1e3'])
    assert.throws(() => usdToE8(bad), Error, bad);
});
test("loadFeedConfig: harga per feed dan nilai bawaan", () => {
  const c = loadFeedConfig(ok);
  assert.equal(c.chainId, 46630);
  assert.deepEqual(c.feeds, [{ address: A, price: 25000000000n }, { address: B, price: 1550000000n }]);
  const d = loadFeedConfig({ ...ok, FEED_ADDRESSES: `${A},${B}=300`, FEED_DEFAULT_USD: "240" });
  assert.deepEqual(d.feeds.map((f) => f.price), [24000000000n, 30000000000n]);
  assert.equal(loadFeedConfig({ ...ok, FEED_ADDRESSES: A }).feeds[0].price, 25000000000n); // default 250
});
test("loadFeedConfig: menolak mainnet, alamat ganda, harga dan kunci buruk", () => {
  assert.throws(() => loadFeedConfig({ ...ok, INDEXER_CHAIN_ID: "4663" }), /testnet/);
  assert.throws(() => loadFeedConfig({ ...ok, FEED_ADDRESSES: `${A},${A.toLowerCase()}=1` }), /ganda/);
  assert.throws(() => loadFeedConfig({ ...ok, FEED_ADDRESSES: "0x123" }), /tidak valid/);
  assert.throws(() => loadFeedConfig({ ...ok, FEED_ADDRESSES: `${A}=0` }), /harga/);
  assert.throws(() => loadFeedConfig({ ...ok, FEED_ADDRESSES: `${A}=1=2` }), /salah bentuk/);
  assert.throws(() => loadFeedConfig({ ...ok, FEED_BOT_PRIVATE_KEY: "0x12" }), /FEED_BOT_PRIVATE_KEY/);
  assert.throws(() => loadFeedConfig({ ...ok, INDEXER_RPC_URL: "" }), /RPC/);
});
test("loadFeedConfig: pesan galat tidak membocorkan kunci", () => {
  let msg = "";
  try { loadFeedConfig({ ...ok, FEED_BOT_PRIVATE_KEY: "0x" + "cd".repeat(31) }); } catch (e) { msg = String((e as Error).message); }
  assert.ok(msg.length > 0, "harus melempar");
  assert.ok(!msg.includes("cdcd"));
});
