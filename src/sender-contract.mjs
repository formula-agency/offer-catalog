import { randomUUID } from 'node:crypto';
import { computePayloadVersion, normalizeOfferPayload } from './catalog-contract.mjs';

/**
 * Pure queue mutation plan for the absent pre-catalog sender. The sender must
 * execute this plan through the same queue service/lock used by the loader.
 */
export function planQueueUpsert(existing, payloadInput, { now = new Date() } = {}) {
  const payload = normalizeOfferPayload(payloadInput);
  const payloadJson = JSON.stringify(payload);
  const payloadVersion = computePayloadVersion(payload);
  const timestamp = now.toISOString();

  if (!existing) {
    return {
      changed: true,
      reason: 'new_offer',
      row: {
        offerId: payload.id,
        status: 'ready',
        payloadJson,
        payloadVersion,
        queuedAt: timestamp,
        updatedAt: timestamp,
        uploadedVersion: null,
        uploadedAt: null,
        catalogUrl: null,
        uploadError: null,
        uploadAttemptId: null,
        uploadStartedAt: null,
        reloadRequestId: null,
        completedReloadRequestId: null
      }
    };
  }

  if (existing.offerId !== payload.id) {
    throw new Error(`ID строки ${existing.offerId} не совпадает с id ${payload.id} в JSON.`);
  }
  if (existing.payloadVersion === payloadVersion) {
    return { changed: false, reason: 'unchanged_version', row: structuredClone(existing) };
  }

  return {
    changed: true,
    reason: 'new_version',
    row: {
      ...structuredClone(existing),
      status: 'ready',
      payloadJson,
      payloadVersion,
      updatedAt: timestamp,
      uploadError: null,
      uploadAttemptId: null,
      uploadStartedAt: null,
      reloadRequestId: null
    }
  };
}

export function planExplicitReload(existing, { requestId = randomUUID() } = {}) {
  if (!existing) throw new Error('Оффер не найден в очереди.');
  if (existing.status === 'uploading') {
    return { changed: false, reason: 'already_uploading', row: structuredClone(existing) };
  }
  return {
    changed: true,
    reason: 'explicit_reload',
    row: {
      ...structuredClone(existing),
      status: 'ready',
      reloadRequestId: requestId,
      uploadError: null,
      uploadAttemptId: null,
      uploadStartedAt: null
    }
  };
}
