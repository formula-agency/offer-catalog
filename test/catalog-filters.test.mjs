import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { filterConstants, filterOffers, getMatchingOptions, optionActions } from '../src/catalog-filter-core.mjs';

const offer = JSON.parse(await readFile(new URL('../examples/offer-v2-multiple-options.json', import.meta.url), 'utf8'));
const now = new Date('2026-10-23T07:00:00Z');

test('family category defaults to any and a concrete category selects its option immediately', () => {
  assert.deepEqual(
    getMatchingOptions(offer, { programs: ['family'], childrenCount: 'any' }, { now }).options.map((item) => item.id),
    ['family-1', 'family-3']
  );
  const result = filterOffers([offer], {
    programs: ['family'],
    childrenCount: 3,
    actions: ['rate_subsidy', 'partial_down_payment', 'renovation_gift']
  }, { now });
  assert.equal(result.length, 1);
  assert.equal(result[0].selectedOption.id, 'family-3');
});

test('financial ranges and actions must match inside one option', () => {
  const split = structuredClone(offer);
  split.options = [
    { ...split.options[0], id: 'a', downPayment: { value: 0, qualifier: 'exact' }, payment: { value: 50000, qualifier: 'exact' } },
    { ...split.options[0], id: 'b', downPayment: { value: 500000, qualifier: 'exact' }, payment: { value: 20000, qualifier: 'exact' } }
  ];
  const match = getMatchingOptions(split, {
    downPayment: { max: 100000 },
    payment: { max: 30000 }
  }, { now });
  assert.equal(match.options.length, 0);
});

test('renovation gift does not imply finished renovation and unknown down payment is not zero', () => {
  assert.equal(filterOffers([offer], { finishing: ['finished'] }, { now }).length, 0);
  assert.equal(
    getMatchingOptions(offer, { programs: ['standard'], downPayment: { min: 0, max: 0 } }, { now }).options.length,
    0
  );
});

test('children category is ignored after family is no longer the only selected program', () => {
  const match = getMatchingOptions(offer, { programs: ['standard'], childrenCount: 3 }, { now });
  assert.deepEqual(match.options.map((item) => item.id), ['standard']);
});

test('today is included, yesterday and unknown dates are excluded from expiring filter', () => {
  const todayOffer = structuredClone(offer);
  todayOffer.validUntil = null;
  todayOffer.options[0].promotions[0].validUntil = '2026-10-23';
  const yesterdayOffer = structuredClone(todayOffer);
  yesterdayOffer.id = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
  yesterdayOffer.options[0].promotions[0].validUntil = '2026-10-22';
  const unknownOffer = structuredClone(todayOffer);
  unknownOffer.id = 'cccccccccccccccccccccccccccccccc';
  unknownOffer.options[0].promotions[0].validUntil = null;
  const results = filterOffers([todayOffer, yesterdayOffer, unknownOffer], {
    programs: ['family'],
    childrenCount: 1,
    actions: ['rate_subsidy'],
    expiringWithinDays: 0
  }, { now });
  assert.deepEqual(results.map((item) => item.offer.id), [todayOffer.id]);
});

test('no cashback category is exposed and only confirmed promotions are active', () => {
  assert.equal(Object.hasOwn(filterConstants.actions, 'cashback'), false);
  const copy = structuredClone(offer);
  copy.options[1].promotions[0].confirmed = false;
  const codes = optionActions(copy, copy.options[1], { today: '2026-10-23' }).map((item) => item.code);
  assert.equal(codes.includes('rate_subsidy'), false);
});

test('invalid ranges return an actionable validation message', () => {
  const result = getMatchingOptions(offer, { price: { min: 10, max: 5 } }, { now });
  assert.equal(result.options.length, 0);
  assert.match(result.errors.price, /«от»/);
});
