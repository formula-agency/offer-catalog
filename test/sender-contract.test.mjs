import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { planExplicitReload, planQueueUpsert } from '../src/sender-contract.mjs';

const fixture = JSON.parse(await readFile(new URL('../examples/offer-v2-multiple-options.json', import.meta.url), 'utf8'));
const now = new Date('2026-10-23T10:00:00Z');

test('unchanged sender click preserves uploaded status, receipts and updated timestamp', () => {
  const created = planQueueUpsert(null, fixture, { now }).row;
  const existing = {
    ...created,
    status: 'uploaded',
    uploadedVersion: created.payloadVersion,
    uploadedAt: '2026-10-23T10:05:00.000Z',
    updatedAt: '2026-10-23T10:00:00.000Z'
  };
  const result = planQueueUpsert(existing, fixture, { now: new Date('2026-10-24T10:00:00Z') });
  assert.equal(result.changed, false);
  assert.equal(result.row.status, 'uploaded');
  assert.equal(result.row.updatedAt, existing.updatedAt);
  assert.equal(result.row.uploadedAt, existing.uploadedAt);
});

test('changed payload requeues same ID while preserving the last published receipt', () => {
  const created = planQueueUpsert(null, fixture, { now }).row;
  const existing = { ...created, status: 'uploaded', uploadedVersion: created.payloadVersion, catalogUrl: 'https://old.test' };
  const changed = { ...structuredClone(fixture), area: 43 };
  const result = planQueueUpsert(existing, changed, { now: new Date('2026-10-24T10:00:00Z') });
  assert.equal(result.changed, true);
  assert.equal(result.row.status, 'ready');
  assert.equal(result.row.uploadedVersion, existing.uploadedVersion);
  assert.equal(result.row.catalogUrl, existing.catalogUrl);
});

test('explicit reload has its own UUID and repeat during upload is idempotent', () => {
  const row = planQueueUpsert(null, fixture, { now }).row;
  const requested = planExplicitReload({ ...row, status: 'uploaded' }, { requestId: 'reload-42' });
  assert.equal(requested.row.reloadRequestId, 'reload-42');
  assert.equal(requested.row.status, 'ready');
  const active = planExplicitReload({ ...requested.row, status: 'uploading' }, { requestId: 'reload-43' });
  assert.equal(active.changed, false);
  assert.equal(active.row.reloadRequestId, 'reload-42');
});
