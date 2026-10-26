import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { StaticReleasePublisher } from '../src/static-release-publisher.mjs';

test('failed release verification leaves the previous pointer and receipt active', async () => {
  const rootDirectory = await mkdtemp(path.join(os.tmpdir(), 'catalog-release-'));
  const stagedPath = path.join(rootDirectory, 'staged.png');
  await writeFile(stagedPath, 'image');
  let allow = true;
  const publisher = new StaticReleasePublisher({
    rootDirectory,
    verifyRelease: async () => allow
  });
  const base = {
    offer: { id: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', project: 'A' },
    uploadedVersion: 'v1',
    image: { stagedPath, publicPath: 'media/queue/a/image.png' },
    attemptId: 'attempt-1',
    reloadRequestId: null,
    publishedAt: '2026-10-23T10:00:00.000Z',
    catalogUrl: 'https://catalog.test/?offer=a'
  };
  const first = await publisher.publish(base);
  const pointerBefore = await readFile(path.join(rootDirectory, '.catalog-loader', 'current.json'), 'utf8');
  allow = false;
  await assert.rejects(
    publisher.publish({ ...base, offer: { ...base.offer, project: 'B' }, uploadedVersion: 'v2', attemptId: 'attempt-2' }),
    (error) => error.code === 'publish_verification_failed'
  );
  const pointerAfter = await readFile(path.join(rootDirectory, '.catalog-loader', 'current.json'), 'utf8');
  assert.equal(pointerAfter, pointerBefore);
  assert.equal((await publisher.getReceipt(base.offer.id)).uploadedVersion, first.uploadedVersion);
});
