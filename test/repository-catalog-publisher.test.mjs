import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { RepositoryCatalogPublisher } from '../src/repository-catalog-publisher.mjs';

test('repository publisher writes only the public projection and waits for verification', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'catalog-repository-'));
  const stagedPath = path.join(root, 'staged.png');
  await writeFile(stagedPath, 'image');
  let verified = false;
  const publisher = new RepositoryCatalogPublisher({
    rootDirectory: root,
    deployAndVerify: async ({ publicFiles, uploadedVersion }) => {
      assert.equal(publicFiles.length, 2);
      assert.equal(uploadedVersion, 'version-1');
      verified = true;
      return true;
    }
  });
  const receipt = await publisher.publish({
    offer: { id: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', project: 'ЖК Тест', imagePath: 'media/queue/a/image.png', options: [] },
    image: { stagedPath, publicPath: 'media/queue/a/image.png' },
    uploadedVersion: 'version-1',
    attemptId: 'attempt-1',
    reloadRequestId: null,
    publishedAt: '2026-10-26T08:00:00.000Z',
    catalogUrl: 'https://catalog.test/?offer=a'
  });
  assert.equal(verified, true);
  assert.equal(receipt.uploadedVersion, 'version-1');
  const source = await readFile(path.join(root, 'queue-offers-data.js'), 'utf8');
  assert.doesNotMatch(source, /uploadedVersion|uploadAttemptId|catalogUrl/);
  assert.match(source, /ЖК Тест/);
});
