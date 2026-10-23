import { createHash } from 'node:crypto';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { google } from 'googleapis';
import { LoaderError } from './catalog-loader.mjs';

const EXTENSIONS = Object.freeze({
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp'
});

export function extractDriveFileId(value) {
  if (!value) return null;
  const match = String(value).match(/(?:\/d\/|[?&]id=)([-\w]{10,})/);
  return match?.[1] ?? (/^[-\w]{10,}$/.test(String(value)) ? String(value) : null);
}

export class GoogleDriveImageStore {
  constructor({ auth, stagingDirectory, maxBytes = 20 * 1024 * 1024 }) {
    this.drive = google.drive({ version: 'v3', auth });
    this.stagingDirectory = stagingDirectory;
    this.maxBytes = maxBytes;
  }

  async stage({ offerId, imageUrl, imageRevision, attemptId }) {
    const fileId = extractDriveFileId(imageUrl);
    if (!fileId) throw new LoaderError('invalid_image_url', 'Картинка (Drive) не содержит допустимый ID файла.');
    let metadata;
    let response;
    try {
      metadata = await this.drive.files.get({ fileId, fields: 'id,name,mimeType,size,md5Checksum,version' });
      response = await this.drive.files.get({ fileId, alt: 'media' }, { responseType: 'arraybuffer', timeout: 30_000 });
    } catch (error) {
      const status = error?.response?.status;
      const code = status === 401 || status === 403 ? 'image_access_denied' : 'image_download_failed';
      throw new LoaderError(code, 'Не удалось получить изображение из Google Drive.', { retryable: status >= 500, cause: error });
    }

    const contentType = metadata.data.mimeType ?? response.headers['content-type'];
    const extension = EXTENSIONS[contentType];
    if (!extension) throw new LoaderError('invalid_image_type', `Недопустимый тип изображения: ${contentType ?? 'неизвестен'}.`);
    const bytes = Buffer.from(response.data);
    if (!bytes.length || bytes.length > this.maxBytes) {
      throw new LoaderError('invalid_image_size', `Размер изображения должен быть от 1 до ${this.maxBytes} байт.`);
    }
    if (bytes.subarray(0, 32).toString('utf8').toLocaleLowerCase().includes('<html')) {
      throw new LoaderError('invalid_image_response', 'Вместо изображения Google Drive вернул HTML-страницу.');
    }

    await mkdir(this.stagingDirectory, { recursive: true });
    const stagedPath = path.join(this.stagingDirectory, `${offerId}-${attemptId}.${extension}`);
    await writeFile(stagedPath, bytes, { flag: 'wx' });
    return {
      offerId,
      sourceFileId: fileId,
      sourceRevision: imageRevision ?? metadata.data.version ?? metadata.data.md5Checksum ?? null,
      contentType,
      extension,
      checksum: createHash('sha256').update(bytes).digest('hex'),
      stagedPath,
      publicPath: `media/queue/${offerId}/${createHash('sha256').update(bytes).digest('hex')}.${extension}`
    };
  }

  async commit(image) {
    await this.discard(image);
  }

  async discard(image) {
    if (image?.stagedPath) await rm(image.stagedPath, { force: true });
  }
}
