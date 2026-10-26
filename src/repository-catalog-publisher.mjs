import { copyFile, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { LoaderError } from './catalog-loader.mjs';

async function readJson(pathname, fallback) {
  try { return JSON.parse(await readFile(pathname, 'utf8')); }
  catch (error) { if (error.code === 'ENOENT') return fallback; throw error; }
}

async function readPublicCatalog(pathname) {
  try {
    const text = await readFile(pathname, 'utf8');
    const json = text.replace(/^\s*window\.QUEUE_OFFERS_CATALOG\s*=\s*/, '').replace(/;\s*$/, '');
    return JSON.parse(json);
  } catch (error) {
    if (error.code === 'ENOENT') return { schemaVersion: 1, generatedAt: null, offers: [] };
    throw new LoaderError('invalid_site_catalog', 'Не удалось прочитать queue-offers-data.js.', { cause: error });
  }
}

async function atomicWrite(pathname, content) {
  await mkdir(path.dirname(pathname), { recursive: true });
  const temporary = `${pathname}.${randomUUID()}.tmp`;
  await writeFile(temporary, content, 'utf8');
  await rename(temporary, pathname);
}

/**
 * Prepares the files used by the browser and delegates deployment/verification
 * to infrastructure-specific code. The callback must not resolve true until
 * the exact version is reachable at the public test/production URL.
 */
export class RepositoryCatalogPublisher {
  constructor({ rootDirectory, deployAndVerify }) {
    if (typeof deployAndVerify !== 'function') {
      throw new Error('RepositoryCatalogPublisher requires deployAndVerify.');
    }
    this.rootDirectory = rootDirectory;
    this.catalogPath = path.join(rootDirectory, 'queue-offers-data.js');
    this.registryPath = path.join(rootDirectory, '.catalog-loader', 'publish-registry.json');
    this.deployAndVerify = deployAndVerify;
  }

  async getReceipt(offerId) {
    const registry = await readJson(this.registryPath, { schemaVersion: 1, offers: {} });
    return registry.offers?.[offerId] ?? null;
  }

  async publish({ offer, image, uploadedVersion, attemptId, reloadRequestId, publishedAt, catalogUrl }) {
    const catalog = await readPublicCatalog(this.catalogPath);
    const registry = await readJson(this.registryPath, { schemaVersion: 1, offers: {} });
    const previous = catalog.offers.find((item) => item.id === offer.id);
    const publicOffer = { ...offer, addedAt: previous?.addedAt ?? publishedAt };
    const offers = catalog.offers.filter((item) => item.id !== offer.id);
    offers.push(publicOffer);
    const deploymentId = randomUUID();
    const receipt = {
      offerId: offer.id,
      uploadedVersion,
      uploadAttemptId: attemptId,
      completedReloadRequestId: reloadRequestId,
      publishedAt,
      catalogUrl,
      deploymentId
    };
    const nextCatalog = { schemaVersion: 1, generatedAt: publishedAt, offers };
    const nextRegistry = {
      schemaVersion: 1,
      generatedAt: publishedAt,
      offers: { ...registry.offers, [offer.id]: receipt }
    };
    const previousCatalogText = await readFile(this.catalogPath, 'utf8').catch(() => null);
    const previousRegistryText = await readFile(this.registryPath, 'utf8').catch(() => null);
    const mediaPath = path.join(this.rootDirectory, ...image.publicPath.split('/'));
    let mediaCreated = false;

    try {
      await mkdir(path.dirname(mediaPath), { recursive: true });
      try {
        await copyFile(image.stagedPath, mediaPath, 1);
        mediaCreated = true;
      } catch (error) {
        if (error.code !== 'EEXIST') throw error;
      }
      await atomicWrite(this.catalogPath, `window.QUEUE_OFFERS_CATALOG = ${JSON.stringify(nextCatalog, null, 2)};\n`);
      await atomicWrite(this.registryPath, `${JSON.stringify(nextRegistry, null, 2)}\n`);
      const verified = await this.deployAndVerify({
        deploymentId,
        uploadedVersion,
        offerId: offer.id,
        catalogUrl,
        publicFiles: [this.catalogPath, mediaPath]
      });
      if (!verified) throw new LoaderError('publish_verification_failed', 'Опубликованная версия не появилась по проверочному URL.', { retryable: true });
      return receipt;
    } catch (error) {
      if (previousCatalogText === null) await rm(this.catalogPath, { force: true });
      else await atomicWrite(this.catalogPath, previousCatalogText);
      if (previousRegistryText === null) await rm(this.registryPath, { force: true });
      else await atomicWrite(this.registryPath, previousRegistryText);
      if (mediaCreated) await rm(mediaPath, { force: true });
      if (error instanceof LoaderError) throw error;
      throw new LoaderError('publish_failed', 'Не удалось подготовить или опубликовать каталог.', { retryable: true, cause: error });
    }
  }
}
