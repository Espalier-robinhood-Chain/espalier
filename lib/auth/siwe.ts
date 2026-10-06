// Bahan pesan Sign-In with Ethereum (EIP-4361) untuk Supabase Auth Web3. Murni: pesan akhirnya disusun di komponen
// klien dengan createSiweMessage dari viem/siwe; di sini hanya parameter dan pemeriksaannya, supaya bisa dites.

// EIP-4361: statement tidak boleh memuat baris baru. Bahasa sederhana, tanpa klaim soal aset.
export const SIGN_IN_STATEMENT = "Sign in to Espalier to manage the privacy of your Wall. This sends no transaction and costs no gas.";

export type SiweRequest = {
  address: string;
  chainId: number;
  domain: string;
  uri: string;
  nonce: string;
  statement: string;
  version: "1";
  issuedAt: Date;
};

// Nonce acak 32 karakter hex (alfanumerik, ≥ 8 seperti syarat EIP-4361). Dibuat di browser.
export function makeNonce(randomBytes: (n: number) => Uint8Array = (n) => crypto.getRandomValues(new Uint8Array(n))): string {
  return Array.from(randomBytes(16), (b) => b.toString(16).padStart(2, "0")).join("");
}

export function buildSiweRequest(args: { address: string; chainId: number; origin: string; now: Date; nonce?: string }): SiweRequest {
  if (!/^0x[0-9a-fA-F]{40}$/.test(args.address)) throw new Error("invalid address");
  if (!Number.isInteger(args.chainId) || args.chainId <= 0) throw new Error("invalid chain id");
  const url = new URL(args.origin); // melempar bila bukan URL
  if (url.protocol !== "https:" && url.protocol !== "http:") throw new Error("invalid origin");
  return {
    address: args.address,
    chainId: args.chainId,
    domain: url.host, // Supabase mencocokkan domain dan URI dengan Redirect URLs project
    uri: `${url.origin}/wall`,
    nonce: args.nonce ?? makeNonce(),
    statement: SIGN_IN_STATEMENT,
    version: "1",
    issuedAt: args.now,
  };
}
