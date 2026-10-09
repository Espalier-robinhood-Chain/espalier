// Murni (tanpa viem) supaya bisa dites. Konfigurasi penyegar feed mock (testnet saja).
// FEED_ADDRESSES: "alamat=harga,alamat=harga,...", harga dalam dolar (mis. 250 atau 15.5). Tanpa "=harga" dipakai FEED_DEFAULT_USD.
export interface FeedEntry { address: `0x${string}`; price: bigint } // price: 8 desimal (250 -> 25000000000)
export interface FeedConfig { rpcUrl: string; chainId: number; feeds: FeedEntry[]; privateKey: `0x${string}` }

const ADDR = /^0x[0-9a-fA-F]{40}$/;

/** Dolar desimal -> bilangan 8 desimal. "250" -> 25000000000n, "15.5" -> 1550000000n. Menolak nol, negatif, dan >8 desimal. */
export function usdToE8(s: string): bigint {
  const m = /^(\d{1,9})(?:\.(\d{1,8}))?$/.exec(s.trim());
  if (!m) throw new Error(`harga bukan dolar valid: "${s.slice(0, 20)}"`);
  const v = BigInt(m[1]) * 100_000_000n + BigInt((m[2] ?? "").padEnd(8, "0") || "0");
  if (v <= 0n) throw new Error("harga harus lebih dari 0");
  return v;
}

export function loadFeedConfig(e: Record<string, string | undefined>): FeedConfig {
  const chainId = Number(e.FEED_CHAIN_ID?.trim() || e.INDEXER_CHAIN_ID?.trim() || 46630);
  if (!Number.isInteger(chainId) || chainId < 1) throw new Error("chain id tidak valid");
  if (chainId === 4663) throw new Error("penyegar feed hanya untuk testnet (feed mock), bukan mainnet 4663");
  const rpcUrl = e.FEED_RPC_URL?.trim() || e.INDEXER_RPC_URL?.trim() || "";
  if (!/^https?:\/\//.test(rpcUrl)) throw new Error("env FEED_RPC_URL (atau INDEXER_RPC_URL) wajib diisi");
  const dflt = usdToE8(e.FEED_DEFAULT_USD?.trim() || "250");
  const parts = (e.FEED_ADDRESSES ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  if (!parts.length) throw new Error("env FEED_ADDRESSES wajib diisi (alamat=harga, dipisah koma)");
  const seen = new Set<string>();
  const feeds = parts.map((p): FeedEntry => {
    const [addr, price, ...rest] = p.split("=");
    if (rest.length) throw new Error(`entri feed salah bentuk: ${p.slice(0, 14)}...`);
    if (!ADDR.test(addr) || /^0x0{40}$/.test(addr)) throw new Error(`alamat feed tidak valid: ${addr.slice(0, 12)}...`);
    if (seen.has(addr.toLowerCase())) throw new Error(`FEED_ADDRESSES berisi alamat ganda: ${addr.slice(0, 12)}...`);
    seen.add(addr.toLowerCase());
    return { address: addr as `0x${string}`, price: price === undefined ? dflt : usdToE8(price) };
  });
  const pk = e.FEED_BOT_PRIVATE_KEY?.trim() ?? "";
  if (!/^0x[0-9a-fA-F]{64}$/.test(pk)) throw new Error("env FEED_BOT_PRIVATE_KEY wajib diisi (0x + 64 heksadesimal)");
  return { rpcUrl, chainId, feeds, privateKey: pk as `0x${string}` };
}
