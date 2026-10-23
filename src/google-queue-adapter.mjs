import { google } from 'googleapis';
import { AsyncMutex, LoaderError } from './catalog-loader.mjs';

export const MANAGED_HEADERS = Object.freeze([
  'ID оффера',
  'Статус очереди',
  'Замечания',
  'ЖК',
  'Район',
  'Тип квартиры',
  'Площадь, м²',
  'Цена, ₽',
  'Дата публикации',
  'Окончание акции',
  'Источник',
  'Картинка (Drive)',
  'Добавлен в очередь',
  'Обновлён',
  'Данные сайта JSON',
  'Версия данных',
  'Загруженная версия',
  'Загружено в каталог',
  'Ссылка в каталоге',
  'Ошибка загрузки',
  'Попытка загрузки',
  'Начало загрузки',
  'Запрос повтора',
  'Выполненный повтор'
]);

const COLUMN_TO_KEY = Object.freeze({
  'ID оффера': 'offerId',
  'Статус очереди': 'status',
  'Замечания': 'notes',
  'ЖК': 'project',
  'Район': 'district',
  'Тип квартиры': 'layout',
  'Площадь, м²': 'area',
  'Цена, ₽': 'price',
  'Дата публикации': 'sourcePublishedAt',
  'Окончание акции': 'validUntil',
  'Источник': 'sourceUrl',
  'Картинка (Drive)': 'imageUrl',
  'Добавлен в очередь': 'queuedAt',
  'Обновлён': 'updatedAt',
  'Данные сайта JSON': 'payloadJson',
  'Версия данных': 'payloadVersion',
  'Загруженная версия': 'uploadedVersion',
  'Загружено в каталог': 'uploadedAt',
  'Ссылка в каталоге': 'catalogUrl',
  'Ошибка загрузки': 'uploadError',
  'Попытка загрузки': 'uploadAttemptId',
  'Начало загрузки': 'uploadStartedAt',
  'Запрос повтора': 'reloadRequestId',
  'Выполненный повтор': 'completedReloadRequestId'
});

const STATUS_TO_CODE = new Map([
  ['ready', 'ready'], ['Готово к загрузке', 'ready'],
  ['uploading', 'uploading'], ['Загружается', 'uploading'],
  ['uploaded', 'uploaded'], ['Загружено', 'uploaded'],
  ['error', 'error'], ['Ошибка загрузки', 'error']
]);

const CODE_TO_STATUS = Object.freeze({
  ready: 'Готово к загрузке',
  uploading: 'Загружается',
  uploaded: 'Загружено',
  error: 'Ошибка загрузки'
});

function columnLetter(index) {
  let value = index + 1;
  let output = '';
  while (value) {
    value -= 1;
    output = String.fromCharCode(65 + (value % 26)) + output;
    value = Math.floor(value / 26);
  }
  return output;
}

export async function createGoogleAuth(scopes = [
  'https://www.googleapis.com/auth/spreadsheets',
  'https://www.googleapis.com/auth/drive.readonly'
]) {
  return new google.auth.GoogleAuth({ scopes }).getClient();
}

/**
 * Low-level Sheets representation. It is safe only when every writer, including
 * the pre-catalog sender, calls the same single-owner service. Sheets itself is
 * not treated as a transactional queue.
 */
export class GoogleSheetsQueueStore {
  constructor({ auth, spreadsheetId, sheetName = 'Очередь сайта', mutex = new AsyncMutex() }) {
    this.sheets = google.sheets({ version: 'v4', auth });
    this.spreadsheetId = spreadsheetId;
    this.sheetName = sheetName;
    this.mutex = mutex;
    this.headers = null;
  }

  async inspectHeaders() {
    const response = await this.sheets.spreadsheets.values.get({
      spreadsheetId: this.spreadsheetId,
      range: `'${this.sheetName.replaceAll("'", "''")}'!1:1`
    });
    const headers = response.data.values?.[0] ?? [];
    const duplicates = headers.filter((value, index) => value && headers.indexOf(value) !== index);
    if (duplicates.length) {
      throw new LoaderError('duplicate_headers', `Повторяются заголовки: ${[...new Set(duplicates)].join(', ')}`);
    }
    this.headers = headers;
    return {
      headers: [...headers],
      missingManagedHeaders: MANAGED_HEADERS.filter((header) => !headers.includes(header)),
      managedCount: MANAGED_HEADERS.filter((header) => headers.includes(header)).length
    };
  }

  async assertReadySchema() {
    const inspection = await this.inspectHeaders();
    if (inspection.missingManagedHeaders.length) {
      throw new LoaderError(
        'queue_schema_mismatch',
        `В очереди отсутствуют столбцы: ${inspection.missingManagedHeaders.join(', ')}`
      );
    }
    return inspection;
  }

  async listRows() {
    await this.assertReadySchema();
    const lastColumn = columnLetter(this.headers.length - 1);
    const response = await this.sheets.spreadsheets.values.get({
      spreadsheetId: this.spreadsheetId,
      range: `'${this.sheetName.replaceAll("'", "''")}'!A2:${lastColumn}`,
      valueRenderOption: 'UNFORMATTED_VALUE'
    });
    return (response.data.values ?? [])
      .map((values, index) => this.#toRow(values, index + 2))
      .filter((row) => row.offerId || row.payloadJson);
  }

  async getRow(offerId) {
    const matches = (await this.listRows()).filter((row) => row.offerId === offerId);
    if (matches.length > 1) throw new LoaderError('duplicate_offer_id', `ID ${offerId} встречается в нескольких строках.`);
    return matches[0] ?? null;
  }

  async claim(expected) {
    return this.mutex.runExclusive(async () => {
      const row = await this.getRow(expected.offerId);
      if (!row
        || row.status !== 'ready'
        || row.payloadVersion !== expected.payloadVersion
        || (row.reloadRequestId ?? null) !== expected.reloadRequestId) return null;
      await this.#updateRow(row.rowNumber, {
        status: 'uploading',
        uploadAttemptId: expected.attemptId,
        uploadStartedAt: expected.startedAt,
        uploadError: null
      });
      return { ...row, status: 'uploading', uploadAttemptId: expected.attemptId, uploadStartedAt: expected.startedAt };
    });
  }

  async complete({ offerId, payloadVersion, attemptId, receipt }) {
    return this.mutex.runExclusive(async () => {
      const row = await this.getRow(offerId);
      if (!row || row.payloadVersion !== payloadVersion || row.uploadAttemptId !== attemptId) return false;
      await this.#updateRow(row.rowNumber, {
        status: 'uploaded',
        uploadedVersion: receipt.uploadedVersion,
        uploadedAt: receipt.publishedAt,
        catalogUrl: receipt.catalogUrl,
        uploadError: null,
        uploadAttemptId: null,
        uploadStartedAt: null,
        completedReloadRequestId: receipt.completedReloadRequestId
      });
      return true;
    });
  }

  async reconcilePublished({ row: snapshot, receipt }) {
    return this.mutex.runExclusive(async () => {
      const row = await this.getRow(snapshot.offerId);
      if (!row || row.payloadVersion !== snapshot.payloadVersion) return false;
      await this.#updateRow(row.rowNumber, {
        status: 'uploaded',
        uploadedVersion: receipt.uploadedVersion,
        uploadedAt: receipt.publishedAt,
        catalogUrl: receipt.catalogUrl,
        uploadError: null,
        uploadAttemptId: null,
        uploadStartedAt: null,
        completedReloadRequestId: receipt.completedReloadRequestId
      });
      return true;
    });
  }

  async fail({ offerId, payloadVersion, attemptId, error }) {
    return this.mutex.runExclusive(async () => {
      const row = await this.getRow(offerId);
      if (!row || row.payloadVersion !== payloadVersion || row.uploadAttemptId !== attemptId) return false;
      await this.#updateRow(row.rowNumber, {
        status: 'error',
        uploadError: `${error.code}: ${error.message}`,
        uploadAttemptId: null,
        uploadStartedAt: null
      });
      return true;
    });
  }

  #toRow(values, rowNumber) {
    const row = { rowNumber };
    this.headers.forEach((header, index) => {
      const key = COLUMN_TO_KEY[header];
      if (!key) return;
      row[key] = values[index] === '' || values[index] === undefined ? null : String(values[index]);
    });
    row.status = STATUS_TO_CODE.get(row.status) ?? row.status;
    return row;
  }

  async #updateRow(rowNumber, changes) {
    const data = [];
    for (const [key, rawValue] of Object.entries(changes)) {
      const header = Object.entries(COLUMN_TO_KEY).find(([, mapped]) => mapped === key)?.[0];
      const index = this.headers.indexOf(header);
      if (index < 0) throw new LoaderError('queue_schema_mismatch', `Не найден столбец ${header}.`);
      const value = key === 'status' ? CODE_TO_STATUS[rawValue] : rawValue;
      data.push({
        range: `'${this.sheetName.replaceAll("'", "''")}'!${columnLetter(index)}${rowNumber}`,
        values: [[value ?? '']]
      });
    }
    await this.sheets.spreadsheets.values.batchUpdate({
      spreadsheetId: this.spreadsheetId,
      requestBody: { valueInputOption: 'RAW', data }
    });
  }
}
