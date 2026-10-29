import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { CatalogLoader } from '../src/catalog-loader.mjs';
import { createGoogleAuth } from '../src/google-queue-adapter.mjs';
import { GoogleDriveImageStore } from '../src/google-drive-image-store.mjs';
import { HttpQueueStore } from '../src/http-queue-store.mjs';
import { StaticReleasePublisher } from '../src/static-release-publisher.mjs';
import { RetryJournal } from '../src/retry-journal.mjs';

const configPath = process.argv[2];
if (!configPath) throw new Error('Укажите непубличный JSON-конфиг загрузчика.');
const config = JSON.parse(await readFile(configPath, 'utf8'));
if (config.queue?.kind !== 'pre-catalog-http' || !config.queue.baseUrl) throw new Error('Требуется очередь pre-catalog-http.');
if (config.publisher?.kind !== 'static-local-test') throw new Error('Рабочий publisher не настроен: запуск остановлен до отдельного разрешения на публикацию.');
const tokenName = config.queue.tokenEnvironmentVariable || 'CATALOG_LOADER_TOKEN';
const token = process.env[tokenName];
const rootDirectory = path.resolve(path.dirname(configPath), config.siteRepository || '.');
const auth = await createGoogleAuth(['https://www.googleapis.com/auth/drive.readonly']);
const queue = new HttpQueueStore({ baseUrl: config.queue.baseUrl, token, timeoutMilliseconds: (config.requestTimeoutSeconds || 30) * 1000 });
const imageStore = new GoogleDriveImageStore({ auth, stagingDirectory: path.join(rootDirectory, '.catalog-loader', 'staging') });
const publisher = new StaticReleasePublisher({ rootDirectory });
const retryJournal = new RetryJournal({
  filePath: path.join(rootDirectory, '.catalog-loader', 'retry-journal.json'),
  delaysMilliseconds: (config.automaticRetryMinutes || [1, 5, 15]).map((minutes) => minutes * 60_000)
});
await retryJournal.requeueDue(queue, await queue.listRows());
const loader = new CatalogLoader({
  queue,
  imageStore,
  publisher,
  leaseMilliseconds: (config.leaseMinutes || 30) * 60_000,
  heartbeatMilliseconds: (config.heartbeatMinutes || 5) * 60_000,
  catalogBaseUrl: config.catalogBaseUrl
});
const results = await loader.runOnce();
await retryJournal.record(results);
console.log(JSON.stringify(results, null, 2));
