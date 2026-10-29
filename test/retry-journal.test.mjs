import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { RetryJournal } from '../src/retry-journal.mjs';

test('retry journal persists exactly three technical retries and keeps versions separate', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'formula-retry-'));
  let now = new Date('2026-10-29T10:00:00Z');
  const filePath = path.join(directory, 'journal.json');
  const journal = new RetryJournal({ filePath, delaysMilliseconds: [1_000, 5_000, 15_000], now: () => now });
  const base = { offerId: 'a'.repeat(32), payloadVersion: '1'.repeat(64), reloadRequestId: null };
  const row = { ...base, status: 'error' };
  const retryCalls = [];
  const queue = { retry: async (value) => { retryCalls.push(value); return true; } };
  try {
    await journal.record([{ ...base, outcome: 'error', code: 'network', retryable: true }]);
    let saved = JSON.parse(await readFile(filePath, 'utf8'));
    assert.equal(Object.values(saved.entries)[0].nextAttemptAt, '2026-10-29T10:00:01.000Z');
    now = new Date('2026-10-29T10:00:01Z');
    assert.equal(await journal.requeueDue(queue, [row]), 1);

    for (const expectedDelay of [5_000, 15_000]) {
      await journal.record([{ ...base, outcome: 'error', code: 'network', retryable: true }]);
      saved = JSON.parse(await readFile(filePath, 'utf8'));
      const entry = Object.values(saved.entries)[0];
      assert.equal(Date.parse(entry.nextAttemptAt) - now.getTime(), expectedDelay);
      now = new Date(entry.nextAttemptAt);
      assert.equal(await journal.requeueDue(queue, [row]), 1);
    }
    await journal.record([{ ...base, outcome: 'error', code: 'network', retryable: true }]);
    saved = JSON.parse(await readFile(filePath, 'utf8'));
    assert.equal(Object.values(saved.entries)[0].retryCount, 3);
    assert.equal(Object.values(saved.entries)[0].nextAttemptAt, null);
    assert.equal(retryCalls.length, 3);

    const version2 = { ...base, payloadVersion: '2'.repeat(64) };
    await journal.record([{ ...version2, outcome: 'error', code: 'network', retryable: true }]);
    saved = JSON.parse(await readFile(filePath, 'utf8'));
    assert.equal(Object.values(saved.entries).filter((entry) => entry.payloadVersion === version2.payloadVersion)[0].retryCount, 1);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('non-retryable result and successful receipt remove the matching journal entry', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'formula-retry-'));
  const filePath = path.join(directory, 'journal.json');
  const journal = new RetryJournal({ filePath, delaysMilliseconds: [1] });
  const key = { offerId: 'b'.repeat(32), payloadVersion: '3'.repeat(64), reloadRequestId: 'reload-1' };
  try {
    await journal.record([{ ...key, outcome: 'error', code: 'temporary', retryable: true }]);
    await journal.record([{ ...key, outcome: 'error', code: 'bad_json', retryable: false }]);
    let saved = JSON.parse(await readFile(filePath, 'utf8'));
    assert.equal(Object.keys(saved.entries).length, 0);
    await journal.record([{ ...key, outcome: 'error', code: 'temporary', retryable: true }]);
    await journal.record([{ ...key, outcome: 'reconciled' }]);
    saved = JSON.parse(await readFile(filePath, 'utf8'));
    assert.equal(Object.keys(saved.entries).length, 0);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
