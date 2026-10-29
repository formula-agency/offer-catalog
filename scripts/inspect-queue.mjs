import { readFile } from 'node:fs/promises';
import { HttpQueueStore } from '../src/http-queue-store.mjs';

const configPath = process.argv[2];
if (!configPath) {
  throw new Error('Укажите путь к непубличному JSON-конфигу: npm run inspect:queue -- C:\\path\\catalog-loader.json');
}
const config = JSON.parse(await readFile(configPath, 'utf8'));
if (config.queue?.kind !== 'pre-catalog-http' || !config.queue.baseUrl) throw new Error('Настройте queue.kind=pre-catalog-http и queue.baseUrl.');
const tokenName = config.queue.tokenEnvironmentVariable || 'CATALOG_LOADER_TOKEN';
const queue = new HttpQueueStore({ baseUrl: config.queue.baseUrl, token: process.env[tokenName] });
const rows = await queue.listRows();
const summary = {
  queue: config.queue.baseUrl,
  rowCount: rows.length,
  statuses: Object.fromEntries([...new Set(rows.map((row) => row.status ?? '(пусто)'))].sort().map((status) => [status, rows.filter((row) => (row.status ?? '(пусто)') === status).length])),
  duplicateOfferIds: [...new Set(rows.map((row) => row.offerId).filter((id, index, all) => id && all.indexOf(id) !== index))]
};

console.log(JSON.stringify(summary, null, 2));
