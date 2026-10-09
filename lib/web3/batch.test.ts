import test from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeCallsStatus,
  sendAtomicBatch,
  supportsAtomicBatch,
  walletSupportsBatch,
  BatchFailed,
  BatchUnavailable,
} from './batch.ts';

const A = '0x0000000000000000000000000000000000000001' as const;

test('supportsAtomicBatch: format baru, format lama, dan tidak didukung', () => {
  assert.equal(
    supportsAtomicBatch({ '0x1': { atomic: { status: 'supported' } } }, 1),
    true,
  );
  assert.equal(
    supportsAtomicBatch({ '0x1': { atomic: { status: 'ready' } } }, 1),
    true,
  );
  assert.equal(
    supportsAtomicBatch({ '0x1': { atomicBatch: { supported: true } } }, 1),
    true,
  );
  assert.equal(
    supportsAtomicBatch({ '0x1': { atomic: { status: 'unsupported' } } }, 1),
    false,
  );
  assert.equal(
    supportsAtomicBatch({ '0x2': { atomic: { status: 'supported' } } }, 1),
    false,
  );
  assert.equal(supportsAtomicBatch(null, 1), false);
});

test('normalizeCallsStatus: v1 dan v2', () => {
  assert.deepEqual(normalizeCallsStatus({ status: 'PENDING' }), {
    state: 'pending',
  });
  assert.deepEqual(normalizeCallsStatus({ status: 100 }), { state: 'pending' });
  assert.deepEqual(
    normalizeCallsStatus({
      status: 200,
      receipts: [{ transactionHash: '0xa', status: '0x1' }],
    }),
    { state: 'success', hash: '0xa' },
  );
  assert.deepEqual(
    normalizeCallsStatus({
      status: 'CONFIRMED',
      receipts: [{ transactionHash: '0xb', status: '0x1' }],
    }),
    { state: 'success', hash: '0xb' },
  );
  assert.equal(
    normalizeCallsStatus({ status: 200, receipts: [{ status: '0x0' }] }).state,
    'failed',
  );
  assert.equal(normalizeCallsStatus({ status: 500 }).state, 'failed');
  assert.equal(normalizeCallsStatus({ status: 600 }).state, 'failed');
});

test('walletSupportsBatch: metode tidak dikenal -> false', async () => {
  assert.equal(
    await walletSupportsBatch(
      async () => {
        throw new Error('unsupported');
      },
      A,
      1,
    ),
    false,
  );
});

test('sendAtomicBatch: polling sampai sukses dan mengembalikan hash terakhir', async () => {
  let polls = 0;
  const seen: string[] = [];
  const req = async ({
    method,
    params,
  }: {
    method: string;
    params?: unknown;
  }) => {
    seen.push(method);
    if (method === 'wallet_sendCalls') {
      const p = (params as { atomicRequired: boolean; calls: unknown[] }[])[0]!;
      assert.equal(p.atomicRequired, true);
      assert.equal(p.calls.length, 2);
      return { id: '0xid' };
    }
    return ++polls < 2
      ? { status: 100 }
      : {
          status: 200,
          receipts: [{ transactionHash: '0xmint', status: '0x1' }],
        };
  };
  const h = await sendAtomicBatch(
    req,
    A,
    1,
    [
      { to: A, data: '0x' },
      { to: A, data: '0x' },
    ],
    { intervalMs: 1 },
  );
  assert.equal(h, '0xmint');
  assert.deepEqual(seen, [
    'wallet_sendCalls',
    'wallet_getCallsStatus',
    'wallet_getCallsStatus',
  ]);
});

test('sendAtomicBatch: gagal on-chain -> BatchFailed', async () => {
  const req = async ({ method }: { method: string }) =>
    method === 'wallet_sendCalls' ? '0xid' : { status: 500 };
  await assert.rejects(
    sendAtomicBatch(req, A, 1, [{ to: A, data: '0x' }], { intervalMs: 1 }),
    BatchFailed,
  );
});

test('sendAtomicBatch: wallet menolak format -> BatchUnavailable; penolakan pengguna dilempar apa adanya', async () => {
  await assert.rejects(
    sendAtomicBatch(
      async () => {
        throw new Error('method not supported');
      },
      A,
      1,
      [],
    ),
    BatchUnavailable,
  );
  const rej = Object.assign(new Error('denied'), { code: 4001 });
  await assert.rejects(
    sendAtomicBatch(
      async () => {
        throw rej;
      },
      A,
      1,
      [],
    ),
    (e) => e === rej,
  );
});
