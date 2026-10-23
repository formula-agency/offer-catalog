import { randomUUID } from 'node:crypto';
import { copyFile, mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { LoaderError } from './catalog-loader.mjs';

async function readJson(filePath, fallback) {
  try {
    return JSON.parse(await readFile(filePath, 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') return fallback;
    throw error;
  }
}

async function writeJson(filePath, value) {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

/**
 * Local/test publisher for a static catalog. Every release is immutable and a
 * single small pointer selects the active release, so a failed build keeps the
 * previous catalog readable. A production GitHub Pages deployer must publish
 * the entire prepared release and verify its URL before acknowledging success.
 */
export class StaticReleasePublisher {
  constructor({ rootDirectory, verifyRelease = async () => true }) {
    this.rootDirectory = rootDirectory;
    this.releasesDirectory = path.join(rootDirectory, '.catalog-loader', 'releases');
    this.currentPath = path.join(rootDirectory, '.catalog-loader', 'current.json');
    this.verifyRelease = verifyRelease;
  }

  async getReceipt(offerId) {
    const current = await readJson(this.currentPath, null);
    if (!current?.deploymentId) return null;
    const registry = await readJson(
      path.join(this.releasesDirectory, current.deploymentId, 'registry.json'),
      { offers: {} }
    );
    return registry.offers?.[offerId] ?? null;
  }

  async publish({ offer, image, attemptId, reloadRequestId, publishedAt, catalogUrl }) {
    const current = await readJson(this.currentPath, null);
    let catalog = { schemaVersion: 1, offers: [] };
    let registry = { schemaVersion: 1, offers: {} };
    if (current?.deploymentId) {
      const currentDirectory = path.join(this.releasesDirectory, current.deploymentId);
      catalog = await readJson(path.join(currentDirectory, 'offers.json'), catalog);
      registry = await readJson(path.join(currentDirectory, 'registry.json'), registry);
    }

    const deploymentId = `${publishedAt.replaceAll(/[:.]/g, '-')}-${randomUUID()}`;
    const releaseDirectory = path.join(this.releasesDirectory, deploymentId);
    const receipt = {
      offerId: offer.id,
      uploadedVersion: offer.uploadedVersion,
      uploadAttemptId: attemptId,
      completedReloadRequestId: reloadRequestId,
      publishedAt,
      catalogUrl,
      deploymentId
    };
    const nextOffers = catalog.offers.filter((item) => item.id !== offer.id);
    nextOffers.push(offer);
    const nextCatalog = { schemaVersion: 1, generatedAt: publishedAt, offers: nextOffers };
    const nextRegistry = {
      schemaVersion: 1,
      generatedAt: publishedAt,
      offers: { ...registry.offers, [offer.id]: receipt }
    };

    try {
      await mkdir(this.releasesDirectory, { recursive: true });
      await mkdir(releaseDirectory, { recursive: false });
      const mediaPath = path.join(this.rootDirectory, ...image.publicPath.split('/'));
      await mkdir(path.dirname(mediaPath), { recursive: true });
      try {
        await copyFile(image.stagedPath, mediaPath, 1);
      } catch (error) {
        if (error.code !== 'EEXIST') throw error;
      }
      await writeJson(path.join(releaseDirectory, 'offers.json'), nextCatalog);
      await writeJson(path.join(releaseDirectory, 'registry.json'), nextRegistry);
      const verified = await this.verifyRelease({ deploymentId, releaseDirectory, catalog: nextCatalog, registry: nextRegistry });
      if (!verified) throw new LoaderError('publish_verification_failed', 'Новая версия каталога не прошла проверку доступности.', { retryable: true });
      const pointerTemp = `${this.currentPath}.${randomUUID()}.tmp`;
      await writeJson(pointerTemp, { deploymentId, publishedAt });
      await rename(pointerTemp, this.currentPath);
      return receipt;
    } catch (error) {
      if (error instanceof LoaderError) throw error;
      throw new LoaderError('publish_failed', 'Не удалось собрать статический каталог.', { retryable: true, cause: error });
    }
  }
}
