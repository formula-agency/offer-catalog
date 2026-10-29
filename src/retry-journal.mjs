import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';

function entryKey({ offerId, payloadVersion, reloadRequestId = null }) {
  return JSON.stringify([offerId, payloadVersion, reloadRequestId]);
}

export class RetryJournal {
  constructor({
    filePath,
    delaysMilliseconds = [60_000, 300_000, 900_000],
    now = () => new Date()
  }) {
    if (!filePath) throw new Error('RetryJournal requires filePath.');
    if (!Array.isArray(delaysMilliseconds) || delaysMilliseconds.some((value) => !Number.isFinite(value) || value < 0)) {
      throw new Error('RetryJournal requires non-negative retry delays.');
    }
    this.filePath = filePath;
    this.delaysMilliseconds = [...delaysMilliseconds];
    this.now = now;
  }

  async #read() {
    try {
      const value = JSON.parse(await readFile(this.filePath, 'utf8'));
      if (value?.schemaVersion !== 1 || typeof value.entries !== 'object' || Array.isArray(value.entries)) {
        throw new Error('Некорректная схема журнала повторов.');
      }
      return value;
    } catch (error) {
      if (error?.code === 'ENOENT') return { schemaVersion: 1, entries: {} };
      throw error;
    }
  }

  async #write(value) {
    await mkdir(path.dirname(this.filePath), { recursive: true });
    const temporary = `${this.filePath}.${process.pid}.tmp`;
    await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
    await rename(temporary, this.filePath);
  }

  async requeueDue(queue, rows) {
    const journal = await this.#read();
    const rowsByKey = new Map(rows.map((row) => [entryKey(row), row]));
    const now = this.now();
    let changed = false;
    let requeued = 0;

    for (const [key, entry] of Object.entries(journal.entries)) {
      const row = rowsByKey.get(key);
      if (!row || row.status === 'uploaded') {
        delete journal.entries[key];
        changed = true;
        continue;
      }
      if (row.status !== 'error' || !entry.nextAttemptAt || Date.parse(entry.nextAttemptAt) > now.getTime()) continue;
      const applied = await queue.retry({
        offerId: row.offerId,
        payloadVersion: row.payloadVersion,
        reloadRequestId: row.reloadRequestId ?? null
      });
      if (applied) {
        entry.nextAttemptAt = null;
        entry.lastRetriedAt = now.toISOString();
        requeued += 1;
        changed = true;
      }
    }
    if (changed) await this.#write(journal);
    return requeued;
  }

  async record(results) {
    const journal = await this.#read();
    const now = this.now();
    let changed = false;
    for (const result of results) {
      if (!result.offerId || !result.payloadVersion) continue;
      const key = entryKey(result);
      if (result.outcome === 'published' || result.outcome === 'reconciled' || (result.outcome === 'error' && !result.retryable)) {
        if (journal.entries[key]) {
          delete journal.entries[key];
          changed = true;
        }
        continue;
      }
      if (result.outcome !== 'error' || !result.retryable) continue;
      const previous = journal.entries[key] ?? { retryCount: 0 };
      if (previous.retryCount >= this.delaysMilliseconds.length) continue;
      const delay = this.delaysMilliseconds[previous.retryCount];
      journal.entries[key] = {
        offerId: result.offerId,
        payloadVersion: result.payloadVersion,
        reloadRequestId: result.reloadRequestId ?? null,
        retryCount: previous.retryCount + 1,
        nextAttemptAt: new Date(now.getTime() + delay).toISOString(),
        lastErrorCode: result.code,
        updatedAt: now.toISOString()
      };
      changed = true;
    }
    if (changed) await this.#write(journal);
  }
}
