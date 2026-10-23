import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { computePayloadVersion } from '../src/catalog-contract.mjs';
import {
  AsyncMutex,
  CatalogLoader,
  MemoryCatalogPublisher,
  MemoryImageStore,
  MemoryQueueStore
} from '../src/catalog-loader.mjs';

const fixture = JSON.parse(await readFile(new URL('../examples/offer-v2-multiple-options.json', import.meta.url), 'utf8'));

function rowFor(payload, overrides = {}) {
  return {
    offerId: payload.id,
    status: 'ready',
    payloadJson: JSON.stringify(payload),
    payloadVersion: computePayloadVersion(payload),
    uploadedVersion: null,
    uploadedAt: null,
    catalogUrl: null,
    uploadError: null,
    uploadAttemptId: null,
    uploadStartedAt: null,
    reloadRequestId: null,
    completedReloadRequestId: null,
    ...overrides
  };
}

function harness(rows = [rowFor(fixture)]) {
  const queue = new MemoryQueueStore(rows);
  const imageStore = new MemoryImageStore();
  const publisher = new MemoryCatalogPublisher();
  let sequence = 0;
  const loader = new CatalogLoader({
    queue,
    imageStore,
    publisher,
    publicationLock: new AsyncMutex(),
    attemptId: () => `attempt-${++sequence}`,
    now: () => new Date('2026-10-23T10:00:00Z'),
    catalogBaseUrl: 'https://catalog.test/'
  });
  return { queue, imageStore, publisher, loader };
}

test('new upload writes a receipt and unchanged rerun does not publish twice', async () => {
  const { queue, publisher, loader } = harness();
  const first = await loader.runOnce();
  assert.equal(first[0].outcome, 'published');
  assert.equal((await queue.getRow(fixture.id)).status, 'uploaded');
  assert.equal(publisher.offers.size, 1);
  await loader.runOnce();
  assert.equal(publisher.publishCount, 1);
});

test('same offer ID with a new version replaces the complete snapshot', async () => {
  const { queue, publisher, loader } = harness();
  await loader.runOnce();
  const changed = structuredClone(fixture);
  changed.project = 'ЖК Обновлённый';
  changed.options = [changed.options[1]];
  assert.equal(queue.resend(changed.id, changed), true);
  await loader.runOnce();
  assert.equal(publisher.offers.size, 1);
  assert.equal(publisher.offers.get(changed.id).project, 'ЖК Обновлённый');
  assert.deepEqual(publisher.offers.get(changed.id).options.map((item) => item.id), ['family-3']);
});

test('ordinary duplicate send differs from one explicit reload cycle', async () => {
  const { queue, publisher, loader } = harness();
  await loader.runOnce();
  assert.equal(queue.resend(fixture.id, fixture), false);
  await loader.runOnce();
  assert.equal(publisher.publishCount, 1);
  const reloadId = queue.requestReload(fixture.id, 'reload-1');
  assert.equal(reloadId, 'reload-1');
  await loader.runOnce();
  assert.equal(publisher.publishCount, 2);
  assert.equal((await queue.getRow(fixture.id)).completedReloadRequestId, 'reload-1');
  await loader.runOnce();
  assert.equal(publisher.publishCount, 2);
});

test('a new version arriving during image preparation is not lost or overwritten', async () => {
  const { queue, publisher } = harness();
  const changed = { ...structuredClone(fixture), project: 'ЖК Версия B' };
  const imageStore = new MemoryImageStore();
  const originalStage = imageStore.stage.bind(imageStore);
  imageStore.stage = async (request) => {
    const staged = await originalStage(request);
    queue.resend(fixture.id, changed);
    return staged;
  };
  const loader = new CatalogLoader({ queue, publisher, imageStore, attemptId: () => 'attempt-race' });
  const [result] = await loader.runOnce();
  assert.equal(result.code, 'attempt_superseded');
  assert.equal(publisher.publishCount, 0);
  const current = await queue.getRow(fixture.id);
  assert.equal(current.status, 'ready');
  assert.equal(current.payloadVersion, computePayloadVersion(changed));
});

test('status write failure after publication is reconciled without republishing', async () => {
  const { queue, publisher, loader } = harness();
  queue.failNextComplete = true;
  const [first] = await loader.runOnce();
  assert.equal(first.code, 'status_write_failed');
  assert.equal(publisher.publishCount, 1);
  await loader.runOnce();
  assert.equal(publisher.publishCount, 1);
  assert.equal((await queue.getRow(fixture.id)).status, 'uploaded');
});

test('JSON and image access errors are isolated by row', async () => {
  const brokenId = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
  const broken = rowFor(fixture, { offerId: brokenId, payloadJson: '{bad json', payloadVersion: '0'.repeat(64) });
  const deniedPayload = { ...structuredClone(fixture), id: 'cccccccccccccccccccccccccccccccc', imageUrl: 'https://drive.google.com/file/d/1DeniedImage000000000000000/view' };
  const denied = rowFor(deniedPayload);
  const valid = rowFor(fixture);
  const { queue, imageStore, publisher, loader } = harness([broken, denied, valid]);
  imageStore.fail(deniedPayload.imageUrl);
  const results = await loader.runOnce();
  assert.equal(results.find((item) => item.offerId === brokenId).code, 'invalid_json');
  assert.equal(results.find((item) => item.offerId === deniedPayload.id).code, 'image_access_denied');
  assert.equal(publisher.offers.has(fixture.id), true);
  assert.equal((await queue.getRow(fixture.id)).status, 'uploaded');
});

test('failed update keeps the previously published offer', async () => {
  const { queue, publisher, loader } = harness();
  await loader.runOnce();
  const changed = { ...structuredClone(fixture), project: 'ЖК Не должен появиться' };
  queue.resend(fixture.id, changed);
  publisher.failNextPublish = true;
  const [result] = await loader.runOnce();
  assert.equal(result.code, 'publish_failed');
  assert.equal(publisher.offers.get(fixture.id).project, fixture.project);
  assert.equal((await queue.getRow(fixture.id)).status, 'error');
});

test('parallel loader starts claim one version only once', async () => {
  const { queue, imageStore, publisher } = harness();
  const lock = new AsyncMutex();
  const makeLoader = (id) => new CatalogLoader({
    queue,
    imageStore,
    publisher,
    publicationLock: lock,
    attemptId: () => id
  });
  await Promise.all([makeLoader('parallel-a').runOnce(), makeLoader('parallel-b').runOnce()]);
  assert.equal(publisher.publishCount, 1);
  assert.equal((await queue.getRow(fixture.id)).status, 'uploaded');
});

test('A to B to A cannot let the old A attempt finish a newer task', async () => {
  const { queue, publisher } = harness();
  const versionB = { ...structuredClone(fixture), project: 'ЖК B' };
  const imageStore = new MemoryImageStore();
  const originalStage = imageStore.stage.bind(imageStore);
  imageStore.stage = async (request) => {
    const staged = await originalStage(request);
    queue.resend(fixture.id, versionB);
    queue.resend(fixture.id, fixture);
    return staged;
  };
  const loader = new CatalogLoader({ queue, publisher, imageStore, attemptId: () => 'old-a-attempt' });
  const [result] = await loader.runOnce();
  assert.equal(result.code, 'attempt_superseded');
  assert.equal(publisher.publishCount, 0);
  assert.equal((await queue.getRow(fixture.id)).status, 'ready');
});

test('two independent offers are both retained by one static-catalog cycle', async () => {
  const second = { ...structuredClone(fixture), id: 'dddddddddddddddddddddddddddddddd', project: 'ЖК Второй' };
  const { publisher, loader } = harness([rowFor(fixture), rowFor(second)]);
  await loader.runOnce();
  assert.equal(publisher.offers.size, 2);
  assert.equal(publisher.offers.get(fixture.id).project, fixture.project);
  assert.equal(publisher.offers.get(second.id).project, 'ЖК Второй');
});

test('row ID mismatch and missing image are explicit non-retryable errors', async () => {
  const mismatch = rowFor(fixture, { offerId: 'eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee' });
  const missingImagePayload = { ...structuredClone(fixture), id: 'ffffffffffffffffffffffffffffffff', imageUrl: null };
  const { loader } = harness([mismatch, rowFor(missingImagePayload)]);
  const results = await loader.runOnce();
  assert.equal(results.find((item) => item.offerId === mismatch.offerId).code, 'id_mismatch');
  assert.equal(results.find((item) => item.offerId === missingImagePayload.id).code, 'missing_image');
});
