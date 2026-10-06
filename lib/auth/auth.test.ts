import test from "node:test";
import assert from "node:assert/strict";
import { decideAccess, hasAuthCookie, parsePrivacyBody, parseWallets } from "./wallets.ts";
import { isSameOrigin } from "./request.ts";
import { buildSiweRequest, makeNonce, SIGN_IN_STATEMENT } from "./siwe.ts";

const A = "0x" + "a".repeat(40);
const B = "0x" + "b".repeat(40);

test("parseWallets: huruf kecil, tanpa duplikat, membuang yang bukan alamat", () => {
  assert.deepEqual(parseWallets(["0x" + "A".repeat(40), A, "0x123", 5, null, { a: 1 }]), [A]);
  assert.deepEqual(parseWallets(null), []);
  assert.deepEqual(parseWallets("0x" + "a".repeat(40)), []);
  assert.deepEqual(parseWallets({ 0: A }), []);
});

test("decideAccess: pemilik selalu boleh; tanpa baris = bawaan privat", () => {
  assert.deepEqual(decideAccess({ address: A, wallets: [A], row: null }), { kind: "owner", isPrivate: true });
  assert.deepEqual(decideAccess({ address: A, wallets: [A], row: { is_private: true } }), { kind: "owner", isPrivate: true });
  assert.deepEqual(decideAccess({ address: A, wallets: [A], row: { is_private: false } }), { kind: "owner", isPrivate: false });
  // huruf besar pada alamat yang diketik tidak mengubah hasil
  assert.equal(decideAccess({ address: A.toUpperCase().replace("0X", "0x"), wallets: [A], row: null }).kind, "owner");
});

test("decideAccess: orang lain hanya melihat Wall yang publik", () => {
  assert.deepEqual(decideAccess({ address: A, wallets: [], row: null }), { kind: "private" });
  assert.deepEqual(decideAccess({ address: A, wallets: [], row: { is_private: true } }), { kind: "private" });
  assert.deepEqual(decideAccess({ address: A, wallets: [B], row: { is_private: true } }), { kind: "private" });
  assert.deepEqual(decideAccess({ address: A, wallets: [B], row: { is_private: false } }), { kind: "public" });
  assert.deepEqual(decideAccess({ address: A, wallets: [], row: { is_private: false } }), { kind: "public" });
});

test("decideAccess: nilai aneh gagal tertutup (privat)", () => {
  for (const bad of [undefined, null, "false", 0, "", {}]) {
    const row = { is_private: bad } as unknown as { is_private: boolean };
    assert.equal(decideAccess({ address: A, wallets: [], row }).kind, "private", `is_private=${String(bad)}`);
  }
});

test("parsePrivacyBody: persis satu kunci boolean", () => {
  assert.deepEqual(parsePrivacyBody({ private: true }), { private: true });
  assert.deepEqual(parsePrivacyBody({ private: false }), { private: false });
  for (const bad of [null, undefined, [], "x", 1, {}, { private: "true" }, { private: 1 }, { private: true, account: B }, { priv: true }]) {
    assert.equal(parsePrivacyBody(bad), null, JSON.stringify(bad));
  }
});

test("hasAuthCookie: mengenali cookie sesi Supabase (termasuk yang dipecah)", () => {
  assert.equal(hasAuthCookie(["theme", "sb-abcdef-auth-token"]), true);
  assert.equal(hasAuthCookie(["sb-abcdef-auth-token.0", "sb-abcdef-auth-token.1"]), true);
  assert.equal(hasAuthCookie(["sb-abcdef-auth-token-code-verifier"]), false);
  assert.equal(hasAuthCookie(["theme", "other"]), false);
  assert.equal(hasAuthCookie([]), false);
});

const h = (o: Record<string, string>) => ({ get: (k: string) => o[k.toLowerCase()] ?? null });

test("isSameOrigin: asal sama diterima, selain itu ditolak", () => {
  assert.equal(isSameOrigin(h({ origin: "https://espalier.xyz", host: "espalier.xyz" })), true);
  assert.equal(isSameOrigin(h({ origin: "http://localhost:3000", host: "localhost:3000", "sec-fetch-site": "same-origin" })), true);
  assert.equal(isSameOrigin(h({ origin: "https://espalier.xyz", host: "internal:3000", "x-forwarded-host": "espalier.xyz" })), true);
  assert.equal(isSameOrigin(h({ origin: "https://evil.example", host: "espalier.xyz" })), false);
  assert.equal(isSameOrigin(h({ host: "espalier.xyz" })), false, "tanpa Origin");
  assert.equal(isSameOrigin(h({ origin: "not a url", host: "espalier.xyz" })), false);
  assert.equal(isSameOrigin(h({ origin: "https://espalier.xyz", host: "espalier.xyz", "sec-fetch-site": "cross-site" })), false);
  assert.equal(isSameOrigin(h({ origin: "https://espalier.xyz", host: "espalier.xyz", "sec-fetch-site": "same-site" })), false);
  assert.equal(isSameOrigin(h({ origin: "https://espalier.xyz" })), false, "tanpa host");
});

test("makeNonce: 32 hex, acak, tidak berulang", () => {
  const seen = new Set<string>();
  for (let i = 0; i < 50; i++) { const n = makeNonce(); assert.match(n, /^[0-9a-f]{32}$/); seen.add(n); }
  assert.equal(seen.size, 50);
  assert.equal(makeNonce(() => new Uint8Array(16)), "0".repeat(32));
});

test("buildSiweRequest: domain dan URI dari origin, chain id dari wallet", () => {
  const now = new Date("2026-10-03T00:00:00Z");
  const r = buildSiweRequest({ address: "0x" + "Ab".repeat(20), chainId: 4663, origin: "https://espalier.xyz", now, nonce: "n".repeat(16) });
  assert.equal(r.domain, "espalier.xyz");
  assert.equal(r.uri, "https://espalier.xyz/wall");
  assert.equal(r.chainId, 4663);
  assert.equal(r.version, "1");
  assert.equal(r.issuedAt, now);
  const local = buildSiweRequest({ address: A, chainId: 46630, origin: "http://localhost:3000", now });
  assert.equal(local.domain, "localhost:3000");
  assert.equal(local.uri, "http://localhost:3000/wall");
});

test("buildSiweRequest: masukan tidak valid ditolak", () => {
  const base = { address: A, chainId: 4663, origin: "https://espalier.xyz", now: new Date() };
  assert.throws(() => buildSiweRequest({ ...base, address: "0x123" }));
  assert.throws(() => buildSiweRequest({ ...base, chainId: 0 }));
  assert.throws(() => buildSiweRequest({ ...base, chainId: 1.5 }));
  assert.throws(() => buildSiweRequest({ ...base, origin: "javascript:alert(1)" }));
  assert.throws(() => buildSiweRequest({ ...base, origin: "bukan url" }));
});

test("pernyataan SIWE: satu baris, jelas tanpa transaksi, tanpa kata terlarang", () => {
  assert.doesNotMatch(SIGN_IN_STATEMENT, /[\r\n]/);
  assert.match(SIGN_IN_STATEMENT, /no transaction/i);
  assert.doesNotMatch(SIGN_IN_STATEMENT, /\b(ETF|funds?|index fund|guarantee[ds]?|risk-free|savings?|interest)\b/i);
  assert.doesNotMatch(SIGN_IN_STATEMENT, /(robinhood|paxos|bbvi|jersey|\bRHJ\b)/i);
});
