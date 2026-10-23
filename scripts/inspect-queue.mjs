import { readFile } from 'node:fs/promises';
import { createGoogleAuth, GoogleSheetsQueueStore } from '../src/google-queue-adapter.mjs';

const configPath = process.argv[2];
if (!configPath) {
  throw new Error('Укажите путь к непубличному JSON-конфигу: npm run inspect:queue -- C:\\path\\catalog-loader.json');
}
const config = JSON.parse(await readFile(configPath, 'utf8'));
if (!config.spreadsheetId || !config.sheetName) {
  throw new Error('В конфигурации обязательны spreadsheetId и sheetName.');
}

const auth = await createGoogleAuth();
const queue = new GoogleSheetsQueueStore({
  auth,
  spreadsheetId: config.spreadsheetId,
  sheetName: config.sheetName
});
const inspection = await queue.inspectHeaders();
const summary = {
  spreadsheetId: config.spreadsheetId,
  sheetName: config.sheetName,
  headerCount: inspection.headers.length,
  managedCount: inspection.managedCount,
  missingManagedHeaders: inspection.missingManagedHeaders
};

if (!inspection.missingManagedHeaders.length) {
  const rows = await queue.listRows();
  summary.rowCount = rows.length;
  summary.statuses = Object.fromEntries(
    [...new Set(rows.map((row) => row.status ?? '(пусто)'))]
      .sort()
      .map((status) => [status, rows.filter((row) => (row.status ?? '(пусто)') === status).length])
  );
  summary.duplicateOfferIds = [...new Set(
    rows.map((row) => row.offerId).filter((id, index, all) => id && all.indexOf(id) !== index)
  )];
}

console.log(JSON.stringify(summary, null, 2));
