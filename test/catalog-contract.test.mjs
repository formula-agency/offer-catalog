import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  CatalogContractError,
  canonicalJson,
  computePayloadVersion,
  normalizeOfferPayload,
  toPublicOffer
} from '../src/catalog-contract.mjs';

const fixture = JSON.parse(await readFile(new URL('../examples/offer-v2-multiple-options.json', import.meta.url), 'utf8'));

test('canonical hash is stable for object key order and changes with imageRevision', () => {
  const reversed = Object.fromEntries(Object.entries(fixture).reverse());
  assert.equal(computePayloadVersion(fixture), computePayloadVersion(reversed));
  assert.notEqual(
    computePayloadVersion(fixture),
    computePayloadVersion({ ...fixture, imageRevision: 'drive-version-8' })
  );
  assert.equal(canonicalJson({ b: 1, a: 2 }), '{"a":2,"b":1}');
});

test('legacy input is completed as v2 without guessing new promotions', () => {
  const legacy = structuredClone(fixture);
  delete legacy.schemaVersion;
  delete legacy.imageRevision;
  delete legacy.sourceReview;
  for (const option of legacy.options) {
    delete option.ratePeriod;
    delete option.promotions;
    delete option.actionValidUntil;
  }
  const normalized = normalizeOfferPayload(legacy);
  assert.equal(normalized.schemaVersion, 2);
  assert.equal(normalized.imageRevision, null);
  assert.deepEqual(normalized.options[0].promotions, []);
  assert.deepEqual(normalized.options[0].actionValidUntil, {});
});

test('duplicate option and promotion IDs are rejected', () => {
  const duplicateOption = structuredClone(fixture);
  duplicateOption.options[1].id = duplicateOption.options[0].id;
  assert.throws(() => normalizeOfferPayload(duplicateOption), (error) => error.code === 'duplicate_option_id');

  const duplicatePromotion = structuredClone(fixture);
  duplicatePromotion.options[1].promotions.push(structuredClone(duplicatePromotion.options[1].promotions[0]));
  assert.throws(() => normalizeOfferPayload(duplicatePromotion), (error) => error.code === 'duplicate_promotion');
});

test('public projection excludes service fields and calculation details', () => {
  const version = computePayloadVersion(fixture);
  const output = toPublicOffer(fixture, { imagePath: 'media/a.png', uploadedVersion: version });
  assert.equal(output.source, undefined);
  assert.equal(output.sourceReview, undefined);
  assert.equal(output.uploadedVersion, undefined);
  assert.equal(output.options[0].bank, undefined);
  assert.equal(output.options[2].calculation, undefined);
  assert.deepEqual(output.options[2].origin, { calculated: true, label: 'Расчётные условия' });
  assert.match(output.options[1].conditions.join(' '), /первые 24 месяца/);
});

test('unresolved source conflict blocks the whole offer', () => {
  const conflicted = structuredClone(fixture);
  conflicted.sourceReview = { hasConflict: true, reasons: ['Цена расходится с источником'] };
  assert.throws(
    () => normalizeOfferPayload(conflicted),
    (error) => error instanceof CatalogContractError && error.code === 'source_conflict'
  );
});
