import { LoaderError } from './catalog-loader.mjs';

export class HttpQueueStore {
  constructor({ baseUrl, token, fetchImpl = globalThis.fetch, timeoutMilliseconds = 30_000 }) {
    if (!baseUrl || !/^https?:\/\//.test(baseUrl)) throw new Error('HttpQueueStore requires an HTTP(S) baseUrl.');
    if (!token || token.length < 32) throw new Error('HttpQueueStore requires a loader token of at least 32 characters.');
    if (typeof fetchImpl !== 'function') throw new Error('HttpQueueStore requires fetch.');
    this.baseUrl = baseUrl.replace(/\/$/, '');
    this.token = token;
    this.fetchImpl = fetchImpl;
    this.timeoutMilliseconds = timeoutMilliseconds;
  }

  async #request(action, body = {}) {
    let response;
    try {
      response = await this.fetchImpl(`${this.baseUrl}/api/loader/${action}`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${this.token}`
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(this.timeoutMilliseconds)
      });
    } catch (error) {
      throw new LoaderError('queue_service_unavailable', 'Сервис очереди предкаталога недоступен.', { retryable: true, cause: error });
    }
    const value = await response.json().catch(() => null);
    if (!response.ok) {
      throw new LoaderError(
        response.status === 401 || response.status === 403 ? 'queue_access_denied' : 'queue_service_error',
        value?.error || `Сервис очереди вернул HTTP ${response.status}.`,
        { retryable: response.status >= 500 }
      );
    }
    return value;
  }

  async listRows() {
    const value = await this.#request('list');
    if (!Array.isArray(value.rows)) throw new LoaderError('queue_service_error', 'Сервис очереди вернул некорректный список строк.');
    return structuredClone(value.rows);
  }

  async getRow(offerId) {
    const matches = (await this.listRows()).filter((row) => row.offerId === offerId);
    if (matches.length > 1) throw new LoaderError('duplicate_offer_id', `ID ${offerId} встречается в нескольких строках.`);
    return matches[0] ?? null;
  }

  async claim({ offerId, payloadVersion, reloadRequestId, attemptId, startedAt }) {
    const value = await this.#request('claim', {
      offerId,
      payloadVersion,
      reloadRequestId: reloadRequestId ?? null,
      uploadAttemptId: attemptId,
      uploadStartedAt: startedAt
    });
    return value.applied ? structuredClone(value.row) : null;
  }

  async heartbeat({ offerId, payloadVersion, attemptId, heartbeatAt }) {
    const value = await this.#request('heartbeat', {
      offerId,
      payloadVersion,
      uploadAttemptId: attemptId,
      heartbeatAt
    });
    return Boolean(value.applied);
  }

  async retry({ offerId, payloadVersion, reloadRequestId }) {
    const value = await this.#request('retry', {
      offerId,
      payloadVersion,
      reloadRequestId: reloadRequestId ?? null
    });
    return Boolean(value.applied);
  }

  async complete({ offerId, payloadVersion, attemptId, receipt }) {
    const value = await this.#request('complete', {
      offerId,
      payloadVersion,
      uploadAttemptId: attemptId,
      receipt
    });
    return Boolean(value.applied);
  }

  async reconcilePublished({ row, receipt }) {
    const value = await this.#request('reconcile', {
      offerId: row.offerId,
      payloadVersion: row.payloadVersion,
      receipt
    });
    return Boolean(value.applied);
  }

  async fail({ offerId, payloadVersion, attemptId, error }) {
    const value = await this.#request('fail', {
      offerId,
      payloadVersion,
      uploadAttemptId: attemptId,
      uploadError: `${error.code}: ${error.message}`
    });
    return Boolean(value.applied);
  }

  async rejectDuplicate(offerId, message) {
    const value = await this.#request('reject-duplicate', { offerId, message });
    return Boolean(value.applied);
  }

  async recoverStale({ now, leaseMilliseconds }) {
    const value = await this.#request('recover-stale', { now: now.toISOString(), leaseMilliseconds });
    return value.recovered ?? 0;
  }
}
