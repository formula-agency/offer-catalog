import { readFile } from 'node:fs/promises';
import { computePayloadVersion, normalizeOfferPayload } from '../src/catalog-contract.mjs';

const url = new URL('../examples/offer-v2-multiple-options.json', import.meta.url);
const raw = await readFile(url, 'utf8');
const normalized = normalizeOfferPayload(raw);
console.log(JSON.stringify({ id: normalized.id, options: normalized.options.length, payloadVersion: computePayloadVersion(normalized) }, null, 2));
