// EIP-5792 (wallet_sendCalls): kirim approve x N + mint dalam SATU konfirmasi wallet, atomic.
// Sengaja memakai JSON-RPC mentah (bukan hook wagmi) agar tidak bergantung pada versi wagmi/viem.
// Semua fungsi di sini murni / berbasis `request` yang disuntikkan, jadi bisa diuji tanpa wallet.
import type { Address, Hash, Hex } from 'viem';
import { isUserRejection } from './trade.ts';

export type Call = { to: Address; data: Hex; value?: Hex };
export type Rpc = (args: {
  method: string;
  params?: unknown;
}) => Promise<unknown>;

const hex = (n: number) => `0x${n.toString(16)}`;

/** Wallet menyatakan bisa mengeksekusi batch secara atomic di chain ini? Menerima format capabilities lama dan baru. */
export function supportsAtomicBatch(caps: unknown, chainId: number): boolean {
  if (!caps || typeof caps !== 'object') return false;
  const c =
    (caps as Record<string, unknown>)[hex(chainId)] ??
    (caps as Record<string, unknown>)[String(chainId)];
  if (!c || typeof c !== 'object') return false;
  const o = c as {
    atomic?: { status?: string };
    atomicBatch?: { supported?: boolean };
  };
  // Spek baru: atomic.status = "supported" (wallet sendiri) | "ready" (akan di-upgrade, mis. EOA -> 7702) | "unsupported".
  if (o.atomic?.status === 'supported' || o.atomic?.status === 'ready')
    return true;
  // Draf lama: atomicBatch.supported.
  return o.atomicBatch?.supported === true;
}

export type CallsOutcome =
  | { state: 'pending' }
  | { state: 'success'; hash?: Hash }
  | { state: 'failed'; reason: string };

/** Menyeragamkan hasil wallet_getCallsStatus (v1: "PENDING"/"CONFIRMED", v2: kode 100/200/4xx/5xx/600). */
export function normalizeCallsStatus(res: unknown): CallsOutcome {
  if (!res || typeof res !== 'object') return { state: 'pending' };
  const r = res as {
    status?: number | string;
    receipts?: { transactionHash?: Hash; status?: string }[];
  };
  const last = r.receipts?.[r.receipts.length - 1]?.transactionHash;
  const reverted = r.receipts?.some((x) => x.status === '0x0');
  const s = r.status;
  if (typeof s === 'number') {
    if (s < 200) return { state: 'pending' };
    if (s === 200 && !reverted) return { state: 'success', hash: last };
    if (s === 200) return { state: 'failed', reason: 'reverted' };
    if (s >= 600) return { state: 'failed', reason: 'partial' };
    return { state: 'failed', reason: s >= 500 ? 'reverted' : 'rejected' };
  }
  const u = String(s ?? '').toUpperCase();
  if (u === 'CONFIRMED')
    return reverted
      ? { state: 'failed', reason: 'reverted' }
      : { state: 'success', hash: last };
  if (u === 'FAILED' || u === 'REVERTED')
    return { state: 'failed', reason: 'reverted' };
  return { state: 'pending' };
}

export async function walletSupportsBatch(
  request: Rpc,
  account: Address,
  chainId: number,
): Promise<boolean> {
  try {
    return supportsAtomicBatch(
      await request({
        method: 'wallet_getCapabilities',
        params: [account, [hex(chainId)]],
      }),
      chainId,
    );
  } catch {
    return false; // wallet tidak mengenal metodenya
  }
}

/** Kirim `calls` sebagai batch atomic. Melempar galat wallet apa adanya (termasuk penolakan pengguna). */
export async function sendAtomicBatch(
  request: Rpc,
  account: Address,
  chainId: number,
  calls: Call[],
  opts?: { intervalMs?: number; timeoutMs?: number },
): Promise<Hash | undefined> {
  let sent: unknown;
  try {
    sent = await request({
      method: 'wallet_sendCalls',
      params: [
        {
          version: '2.0.0',
          from: account,
          chainId: hex(chainId),
          atomicRequired: true,
          calls: calls.map((c) => ({
            to: c.to,
            data: c.data,
            value: c.value ?? '0x0',
          })),
        },
      ],
    });
  } catch (e) {
    if (isUserRejection(e)) throw e; // pengguna menolak: hentikan, jangan coba jalur lain
    throw new BatchUnavailable(e); // wallet menolak formatnya: aman untuk fallback karena belum ada yang terkirim
  }
  const id =
    typeof sent === 'string' ? sent : (sent as { id?: string } | null)?.id;
  if (!id) throw new Error('Wallet returned no batch id.');
  const interval = opts?.intervalMs ?? 2000;
  const deadline = Date.now() + (opts?.timeoutMs ?? 5 * 60_000);
  while (Date.now() < deadline) {
    const out = normalizeCallsStatus(
      await request({ method: 'wallet_getCallsStatus', params: [id] }),
    );
    if (out.state === 'success') return out.hash;
    if (out.state === 'failed') throw new BatchFailed(out.reason);
    await new Promise((r) => setTimeout(r, interval));
  }
  throw new BatchFailed('timeout');
}

export class BatchFailed extends Error {
  reason: string;
  constructor(reason: string) {
    super(`Batch ${reason}`);
    this.reason = reason;
  }
}

/** Batch belum terkirim sama sekali (wallet tidak mendukung / menolak format). Aman untuk jatuh ke alur berurutan. */
export class BatchUnavailable extends Error {
  constructor(cause: unknown) {
    super('Batch unavailable', { cause });
  }
}
