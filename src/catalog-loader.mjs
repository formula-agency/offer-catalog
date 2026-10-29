import { randomUUID } from 'node:crypto';
import { CatalogContractError, computePayloadVersion, normalizeOfferPayload, toPublicOffer } from './catalog-contract.mjs';

export class LoaderError extends Error {
  constructor(code, message, { retryable = false, cause = null } = {}) {
    super(message, { cause });
    this.name = 'LoaderError';
    this.code = code;
    this.retryable = retryable;
  }
}

function errorInfo(error) {
  if (error instanceof CatalogContractError || error instanceof LoaderError) {
    return { code: error.code, message: error.message, retryable: Boolean(error.retryable) };
  }
  return { code: 'unexpected_error', message: 'Непредвиденная ошибка загрузчика.', retryable: true };
}

function pendingReload(row) {
  return Boolean(row.reloadRequestId && row.reloadRequestId !== row.completedReloadRequestId);
}

export class AsyncMutex {
  #tail = Promise.resolve();

  async runExclusive(action) {
    const previous = this.#tail;
    let release;
    this.#tail = new Promise((resolve) => { release = resolve; });
    await previous;
    try {
      return await action();
    } finally {
      release();
    }
  }
}

export class CatalogLoader {
  constructor({
    queue,
    imageStore,
    publisher,
    publicationLock = new AsyncMutex(),
    now = () => new Date(),
    attemptId = () => randomUUID(),
    leaseMilliseconds = 30 * 60 * 1000,
    heartbeatMilliseconds = 5 * 60 * 1000,
    catalogBaseUrl = 'http://localhost/catalog/'
  }) {
    this.queue = queue;
    this.imageStore = imageStore;
    this.publisher = publisher;
    this.publicationLock = publicationLock;
    this.now = now;
    this.attemptId = attemptId;
    this.leaseMilliseconds = leaseMilliseconds;
    this.heartbeatMilliseconds = heartbeatMilliseconds;
    this.catalogBaseUrl = catalogBaseUrl;
  }

  async runOnce() {
    await this.queue.recoverStale?.({ now: this.now(), leaseMilliseconds: this.leaseMilliseconds });
    const rows = await this.queue.listRows();
    const duplicateIds = new Set(
      rows.map((row) => row.offerId).filter((id, index, all) => id && all.indexOf(id) !== index)
    );
    const results = [];

    for (const row of rows) {
      if (duplicateIds.has(row.offerId)) {
        await this.queue.rejectDuplicate?.(row.offerId, 'Повторяющийся ID оффера: исправьте все строки с этим ID.');
        results.push({ offerId: row.offerId, outcome: 'error', code: 'duplicate_offer_id' });
        continue;
      }
      if (!['ready', 'uploading', 'error'].includes(row.status)) continue;
      results.push(await this.#processRow(row));
    }
    return results;
  }

  async #processRow(initialRow) {
    const existingReceipt = await this.publisher.getReceipt(initialRow.offerId);
    const reloadRequested = pendingReload(initialRow);
    const receiptMatches = existingReceipt
      && existingReceipt.uploadedVersion === initialRow.payloadVersion
      && (!reloadRequested || existingReceipt.completedReloadRequestId === initialRow.reloadRequestId);

    if (receiptMatches) {
      await this.queue.reconcilePublished({ row: initialRow, receipt: existingReceipt });
      return { offerId: initialRow.offerId, payloadVersion: initialRow.payloadVersion, reloadRequestId: initialRow.reloadRequestId ?? null, outcome: 'reconciled' };
    }

    if (initialRow.status !== 'ready') {
      return { offerId: initialRow.offerId, outcome: 'busy' };
    }

    const attemptId = this.attemptId();
    const startedAt = this.now().toISOString();
    const claimed = await this.queue.claim({
      offerId: initialRow.offerId,
      payloadVersion: initialRow.payloadVersion,
      reloadRequestId: initialRow.reloadRequestId ?? null,
      attemptId,
      startedAt
    });
    if (!claimed) return { offerId: initialRow.offerId, outcome: 'lost_claim' };

    let stagedImage = null;
    let heartbeatTimer = null;
    let leaseLost = false;
    let heartbeatPending = Promise.resolve();
    const renewLease = async ({ strict = false } = {}) => {
      try {
        const applied = await this.queue.heartbeat?.({
          offerId: claimed.offerId,
          payloadVersion: claimed.payloadVersion,
          attemptId,
          heartbeatAt: this.now().toISOString()
        });
        if (applied === false) leaseLost = true;
      } catch (error) {
        if (strict) {
          throw new LoaderError('lease_renewal_failed', 'Не удалось подтвердить аренду попытки перед публикацией.', { retryable: true, cause: error });
        }
        // A periodic heartbeat may recover on its next tick. Publication still
        // requires one successful synchronous renewal immediately beforehand.
      }
    };
    if (this.queue.heartbeat && this.heartbeatMilliseconds > 0) {
      heartbeatTimer = setInterval(() => {
        heartbeatPending = heartbeatPending.then(renewLease);
      }, this.heartbeatMilliseconds);
      heartbeatTimer.unref?.();
    }
    try {
      const offer = normalizeOfferPayload(claimed.payloadJson);
      if (claimed.offerId !== offer.id) {
        throw new LoaderError('id_mismatch', `ID строки ${claimed.offerId} не совпадает с id ${offer.id} в JSON.`);
      }
      const computedVersion = computePayloadVersion(offer);
      if (computedVersion !== claimed.payloadVersion) {
        throw new LoaderError('payload_version_mismatch', 'Версия данных не совпадает с SHA-256 нормализованной полезной нагрузки.');
      }
      if (!offer.imageUrl) {
        throw new LoaderError('missing_image', 'Не указана обязательная картинка оффера.');
      }

      stagedImage = await this.imageStore.stage({
        offerId: offer.id,
        imageUrl: offer.imageUrl,
        imageRevision: offer.imageRevision,
        attemptId
      });

      await heartbeatPending;
      await renewLease({ strict: true });
      if (leaseLost) {
        throw new LoaderError('attempt_superseded', 'Аренда попытки утрачена до публикации; снимок не опубликован.');
      }

      const receipt = await this.publicationLock.runExclusive(async () => {
        const current = await this.queue.getRow(offer.id);
        if (!current
          || current.status !== 'uploading'
          || current.payloadVersion !== claimed.payloadVersion
          || current.uploadAttemptId !== attemptId) {
          throw new LoaderError('attempt_superseded', 'Во время загрузки поступила новая версия; старая попытка отменена.');
        }

        const publicOffer = toPublicOffer(offer, { imagePath: stagedImage.publicPath });
        return this.publisher.publish({
          offer: publicOffer,
          image: stagedImage,
          uploadedVersion: claimed.payloadVersion,
          attemptId,
          reloadRequestId: pendingReload(claimed) ? claimed.reloadRequestId : null,
          publishedAt: this.now().toISOString(),
          catalogUrl: `${this.catalogBaseUrl.replace(/\/$/, '')}/?offer=${encodeURIComponent(offer.id)}`
        });
      });

      const completed = await this.queue.complete({
        offerId: offer.id,
        payloadVersion: claimed.payloadVersion,
        attemptId,
        receipt
      });
      await this.imageStore.commit?.(stagedImage);
      if (completed === false) {
        return { offerId: offer.id, payloadVersion: claimed.payloadVersion, reloadRequestId: claimed.reloadRequestId ?? null, outcome: 'superseded_after_publish', receipt };
      }
      return { offerId: offer.id, payloadVersion: claimed.payloadVersion, reloadRequestId: claimed.reloadRequestId ?? null, outcome: 'published', receipt };
    } catch (error) {
      await this.imageStore.discard?.(stagedImage);
      const info = errorInfo(error);
      let statusWriteFailed = false;
      try {
        await this.queue.fail({
          offerId: claimed.offerId,
          payloadVersion: claimed.payloadVersion,
          attemptId,
          error: info
        });
      } catch {
        statusWriteFailed = true;
      }
      return { offerId: claimed.offerId, payloadVersion: claimed.payloadVersion, reloadRequestId: claimed.reloadRequestId ?? null, outcome: 'error', statusWriteFailed, ...info };
    } finally {
      if (heartbeatTimer) clearInterval(heartbeatTimer);
      await heartbeatPending;
    }
  }
}

export class MemoryQueueStore {
  constructor(rows = []) {
    this.rows = rows.map((row) => structuredClone(row));
    this.failNextComplete = false;
  }

  async listRows() { return structuredClone(this.rows); }
  async getRow(offerId) { return structuredClone(this.rows.find((row) => row.offerId === offerId) ?? null); }

  async claim({ offerId, payloadVersion, reloadRequestId, attemptId, startedAt }) {
    const row = this.rows.find((candidate) => candidate.offerId === offerId);
    if (!row || row.status !== 'ready' || row.payloadVersion !== payloadVersion) return null;
    if ((row.reloadRequestId ?? null) !== reloadRequestId) return null;
    row.status = 'uploading';
    row.uploadAttemptId = attemptId;
    row.uploadStartedAt = startedAt;
    row.uploadError = null;
    return structuredClone(row);
  }

  async complete({ offerId, payloadVersion, attemptId, receipt }) {
    if (this.failNextComplete) {
      this.failNextComplete = false;
      throw new LoaderError('status_write_failed', 'Публикация завершена, но запись квитанции недоступна.', { retryable: true });
    }
    const row = this.rows.find((candidate) => candidate.offerId === offerId);
    if (!row || row.payloadVersion !== payloadVersion || row.uploadAttemptId !== attemptId) return false;
    row.status = 'uploaded';
    row.uploadedVersion = receipt.uploadedVersion;
    row.uploadedAt = receipt.publishedAt;
    row.catalogUrl = receipt.catalogUrl;
    row.uploadError = null;
    row.uploadAttemptId = null;
    row.uploadStartedAt = null;
    row.completedReloadRequestId = receipt.completedReloadRequestId ?? row.completedReloadRequestId ?? null;
    return true;
  }

  async heartbeat({ offerId, payloadVersion, attemptId, heartbeatAt }) {
    const row = this.rows.find((candidate) => candidate.offerId === offerId);
    if (!row || row.status !== 'uploading' || row.payloadVersion !== payloadVersion || row.uploadAttemptId !== attemptId) return false;
    row.uploadStartedAt = heartbeatAt;
    return true;
  }

  async retry({ offerId, payloadVersion, reloadRequestId }) {
    const row = this.rows.find((candidate) => candidate.offerId === offerId);
    if (!row || row.status !== 'error' || row.payloadVersion !== payloadVersion || (row.reloadRequestId ?? null) !== (reloadRequestId ?? null)) return false;
    row.status = 'ready';
    row.uploadError = null;
    row.uploadAttemptId = null;
    row.uploadStartedAt = null;
    return true;
  }

  async reconcilePublished({ row: snapshot, receipt }) {
    const row = this.rows.find((candidate) => candidate.offerId === snapshot.offerId);
    if (!row || row.payloadVersion !== snapshot.payloadVersion) return false;
    row.status = 'uploaded';
    row.uploadedVersion = receipt.uploadedVersion;
    row.uploadedAt = receipt.publishedAt;
    row.catalogUrl = receipt.catalogUrl;
    row.uploadError = null;
    row.uploadAttemptId = null;
    row.uploadStartedAt = null;
    row.completedReloadRequestId = receipt.completedReloadRequestId ?? row.completedReloadRequestId ?? null;
    return true;
  }

  async fail({ offerId, payloadVersion, attemptId, error }) {
    const row = this.rows.find((candidate) => candidate.offerId === offerId);
    if (!row || row.payloadVersion !== payloadVersion || row.uploadAttemptId !== attemptId) return false;
    row.status = 'error';
    row.uploadError = `${error.code}: ${error.message}`;
    row.uploadAttemptId = null;
    row.uploadStartedAt = null;
    return true;
  }

  async recoverStale({ now, leaseMilliseconds }) {
    for (const row of this.rows) {
      if (row.status !== 'uploading' || !row.uploadStartedAt) continue;
      if (now.getTime() - Date.parse(row.uploadStartedAt) > leaseMilliseconds) {
        row.status = 'ready';
        row.uploadAttemptId = null;
        row.uploadStartedAt = null;
        row.uploadError = 'Предыдущая попытка прервана; задача возвращена в очередь.';
      }
    }
  }

  async rejectDuplicate(offerId, message) {
    for (const row of this.rows.filter((candidate) => candidate.offerId === offerId)) {
      row.status = 'error';
      row.uploadError = `duplicate_offer_id: ${message}`;
    }
  }

  resend(offerId, payloadJson) {
    const row = this.rows.find((candidate) => candidate.offerId === offerId);
    const payloadVersion = computePayloadVersion(payloadJson);
    if (row.payloadVersion === payloadVersion) return false;
    row.payloadJson = typeof payloadJson === 'string' ? payloadJson : JSON.stringify(payloadJson);
    row.payloadVersion = payloadVersion;
    row.status = 'ready';
    row.uploadError = null;
    row.uploadAttemptId = null;
    row.uploadStartedAt = null;
    row.reloadRequestId = null;
    return true;
  }

  requestReload(offerId, reloadRequestId = randomUUID()) {
    const row = this.rows.find((candidate) => candidate.offerId === offerId);
    if (row.status === 'uploading') return row.reloadRequestId ?? null;
    row.reloadRequestId = reloadRequestId;
    row.status = 'ready';
    row.uploadError = null;
    return reloadRequestId;
  }
}

export class MemoryImageStore {
  constructor() {
    this.failures = new Map();
    this.staged = [];
  }

  fail(imageUrl, code = 'image_access_denied') { this.failures.set(imageUrl, code); }

  async stage({ offerId, imageUrl, imageRevision, attemptId }) {
    const code = this.failures.get(imageUrl);
    if (code) throw new LoaderError(code, `Не удалось получить изображение: ${code}.`);
    const image = {
      offerId,
      imageUrl,
      imageRevision,
      attemptId,
      contentType: 'image/png',
      bytes: Buffer.from(`image:${imageUrl}:${imageRevision ?? ''}`),
      publicPath: `media/${offerId}.png`
    };
    this.staged.push(image);
    return image;
  }
}

export class MemoryCatalogPublisher {
  constructor() {
    this.offers = new Map();
    this.receipts = new Map();
    this.publishCount = 0;
    this.failNextPublish = false;
  }

  async getReceipt(offerId) { return structuredClone(this.receipts.get(offerId) ?? null); }

  async publish({ offer, uploadedVersion, attemptId, reloadRequestId, publishedAt, catalogUrl }) {
    if (this.failNextPublish) {
      this.failNextPublish = false;
      throw new LoaderError('publish_failed', 'Тестовый сбой публикации.', { retryable: true });
    }
    const nextOffers = new Map(this.offers);
    const nextReceipts = new Map(this.receipts);
    const receipt = {
      offerId: offer.id,
      uploadedVersion,
      uploadAttemptId: attemptId,
      completedReloadRequestId: reloadRequestId,
      publishedAt,
      catalogUrl,
      deploymentId: randomUUID()
    };
    const previousOffer = this.offers.get(offer.id);
    nextOffers.set(offer.id, structuredClone({ ...offer, addedAt: previousOffer?.addedAt ?? publishedAt }));
    nextReceipts.set(offer.id, receipt);
    this.offers = nextOffers;
    this.receipts = nextReceipts;
    this.publishCount += 1;
    return structuredClone(receipt);
  }
}
