import test from 'node:test';
import assert from 'node:assert/strict';
import { HttpQueueStore } from '../src/http-queue-store.mjs';

const token = 't'.repeat(32);
function response(value, status = 200) { return new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json' } }); }

test('HTTP queue store uses the pre-catalog single-owner API for all mutations', async () => {
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push({ url, options, body: JSON.parse(options.body) });
    const action = url.split('/').pop();
    if (action === 'list') return response({ rows: [{ offerId: 'a'.repeat(32), status: 'ready' }] });
    return response({ applied: true, row: { offerId: 'a'.repeat(32), status: 'uploading' } });
  };
  const store = new HttpQueueStore({ baseUrl: 'https://pre.test/', token, fetchImpl });
  assert.equal((await store.listRows()).length, 1);
  assert.equal((await store.getRow('a'.repeat(32))).status, 'ready');
  const claimed = await store.claim({ offerId: 'a'.repeat(32), payloadVersion: 'v1', reloadRequestId: null, attemptId: 'attempt', startedAt: '2026-10-28T10:00:00.000Z' });
  assert.equal(claimed.status, 'uploading');
  await store.heartbeat({ offerId: 'a'.repeat(32), payloadVersion: 'v1', attemptId: 'attempt', heartbeatAt: '2026-10-28T10:05:00.000Z' });
  await store.retry({ offerId: 'a'.repeat(32), payloadVersion: 'v1', reloadRequestId: null });
  await store.complete({ offerId: 'a'.repeat(32), payloadVersion: 'v1', attemptId: 'attempt', receipt: { uploadedVersion: 'v1' } });
  await store.reconcilePublished({ row: { offerId: 'a'.repeat(32), payloadVersion: 'v1' }, receipt: { uploadedVersion: 'v1' } });
  await store.fail({ offerId: 'a'.repeat(32), payloadVersion: 'v1', attemptId: 'attempt', error: { code: 'x', message: 'ошибка' } });
  await store.rejectDuplicate('a'.repeat(32), 'дубль');
  await store.recoverStale({ now: new Date('2026-10-28T11:00:00Z'), leaseMilliseconds: 1_800_000 });
  assert.deepEqual(calls.map((call) => call.url.split('/').pop()), ['list', 'list', 'claim', 'heartbeat', 'retry', 'complete', 'reconcile', 'fail', 'reject-duplicate', 'recover-stale']);
  assert.ok(calls.every((call) => call.options.headers.authorization === `Bearer ${token}`));
  assert.equal(calls[2].body.uploadAttemptId, 'attempt');
  assert.equal(calls[7].body.uploadError, 'x: ошибка');
});

test('HTTP queue store reports access and network failures without exposing token', async () => {
  const denied = new HttpQueueStore({ baseUrl: 'https://pre.test', token, fetchImpl: async () => response({ error: 'Нет доступа' }, 403) });
  await assert.rejects(() => denied.listRows(), (error) => error.code === 'queue_access_denied' && !error.message.includes(token));
  const offline = new HttpQueueStore({ baseUrl: 'https://pre.test', token, fetchImpl: async () => { throw new Error('offline'); } });
  await assert.rejects(() => offline.listRows(), (error) => error.code === 'queue_service_unavailable' && error.retryable);
});
