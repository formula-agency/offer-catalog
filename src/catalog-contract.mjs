import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';

const schemaPath = fileURLToPath(new URL('../schemas/catalog-offer-v2.schema.json', import.meta.url));
const schema = JSON.parse(readFileSync(schemaPath, 'utf8'));

const PROMOTION_CODES = new Set([
  'rate_subsidy',
  'renovation_gift',
  'parking_gift',
  'storage_gift',
  'furniture_gift',
  'kitchen_gift',
  'developer_pays_mortgage',
  'discount'
]);

const ACTION_DATE_KEYS = [
  'partial_down_payment',
  'zero_down_payment',
  'down_payment_compensation',
  'tranche',
  'installment'
];

const ajv = new Ajv2020({ allErrors: true, strict: true });
addFormats(ajv);
const validateSchema = ajv.compile(schema);

export class CatalogContractError extends Error {
  constructor(code, message, details = null) {
    super(message);
    this.name = 'CatalogContractError';
    this.code = code;
    this.details = details;
  }
}

function valueOrNull(value) {
  return value === undefined ? null : value;
}

function arrayOrEmpty(value) {
  return value === undefined || value === null ? [] : value;
}

function normalizeMoney(value) {
  if (value === undefined || value === null) return null;
  return {
    value: value.value,
    qualifier: value.qualifier
  };
}

function normalizePromotion(value = {}) {
  return {
    code: value.code,
    label: value.label,
    confirmed: value.confirmed,
    validUntil: valueOrNull(value.validUntil)
  };
}

function normalizeActionDates(value) {
  const source = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  const result = {};
  for (const key of ACTION_DATE_KEYS) {
    if (Object.hasOwn(source, key)) result[key] = valueOrNull(source[key]);
  }
  return result;
}

function normalizeOption(value = {}) {
  return {
    id: value.id,
    program: value.program,
    childrenCount: valueOrNull(value.childrenCount),
    financing: value.financing ?? 'unknown',
    downPaymentType: value.downPaymentType ?? 'unknown',
    downPayment: normalizeMoney(value.downPayment),
    payment: normalizeMoney(value.payment),
    price: normalizeMoney(value.price),
    rate: valueOrNull(value.rate),
    paymentPeriod: valueOrNull(value.paymentPeriod),
    conditions: arrayOrEmpty(value.conditions),
    ratePeriod: valueOrNull(value.ratePeriod),
    promotions: arrayOrEmpty(value.promotions).map(normalizePromotion),
    actionValidUntil: normalizeActionDates(value.actionValidUntil),
    compensation: normalizeMoney(value.compensation),
    termYears: valueOrNull(value.termYears),
    bank: valueOrNull(value.bank),
    stages: value.stages === undefined ? null : value.stages,
    calculation: valueOrNull(value.calculation)
  };
}

/**
 * Converts both the original payload and schema v2 payload to one complete v2
 * representation. Only fields declared by the contract are retained. Strings
 * are deliberately not trimmed because both sides must hash the same bytes.
 */
export function normalizeOfferPayload(input) {
  let value = input;
  if (typeof input === 'string') {
    try {
      value = JSON.parse(input);
    } catch (error) {
      throw new CatalogContractError('invalid_json', `Некорректный JSON: ${error.message}`);
    }
  }

  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new CatalogContractError('invalid_json', 'Данные сайта JSON должны быть объектом.');
  }

  const sourceVersion = value.schemaVersion ?? 1;
  if (![1, 2].includes(sourceVersion)) {
    throw new CatalogContractError('unsupported_schema_version', `Версия схемы ${sourceVersion} не поддерживается.`);
  }

  const normalized = {
    id: value.id,
    project: valueOrNull(value.project),
    district: valueOrNull(value.district),
    layout: valueOrNull(value.layout),
    rooms: valueOrNull(value.rooms),
    area: valueOrNull(value.area),
    price: normalizeMoney(value.price),
    finishing: value.finishing ?? 'unknown',
    gifts: arrayOrEmpty(value.gifts),
    validUntil: valueOrNull(value.validUntil),
    source: {
      url: valueOrNull(value.source?.url),
      publishedAt: value.source?.publishedAt
    },
    imageUrl: valueOrNull(value.imageUrl),
    options: arrayOrEmpty(value.options).map(normalizeOption),
    schemaVersion: 2,
    imageRevision: valueOrNull(value.imageRevision),
    sourceReview: {
      hasConflict: value.sourceReview?.hasConflict ?? false,
      reasons: arrayOrEmpty(value.sourceReview?.reasons)
    }
  };

  validateNormalizedOffer(normalized);
  return normalized;
}

export function validateNormalizedOffer(value) {
  if (!validateSchema(value)) {
    const message = validateSchema.errors
      .map((error) => `${error.instancePath || '/'} ${error.message}`)
      .join('; ');
    throw new CatalogContractError('invalid_payload', message, structuredClone(validateSchema.errors));
  }

  const optionIds = new Set();
  for (const option of value.options) {
    if (optionIds.has(option.id)) {
      throw new CatalogContractError('duplicate_option_id', `Повторяется ID варианта: ${option.id}`);
    }
    optionIds.add(option.id);

    const promotionCodes = new Set();
    for (const promotion of option.promotions) {
      if (!PROMOTION_CODES.has(promotion.code)) {
        throw new CatalogContractError('unknown_promotion', `Неизвестный код акции: ${promotion.code}`);
      }
      if (promotionCodes.has(promotion.code)) {
        throw new CatalogContractError('duplicate_promotion', `Акция ${promotion.code} повторяется в варианте ${option.id}.`);
      }
      promotionCodes.add(promotion.code);
    }
  }

  if (value.sourceReview.hasConflict) {
    const reasons = value.sourceReview.reasons.length
      ? value.sourceReview.reasons.join('; ')
      : 'причина не указана';
    throw new CatalogContractError('source_conflict', `В источнике есть неразрешённое противоречие: ${reasons}`);
  }
  return value;
}

export function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, canonicalize(value[key])])
    );
  }
  return value;
}

export function canonicalJson(value) {
  return JSON.stringify(canonicalize(value));
}

export function computePayloadVersion(input) {
  const normalized = normalizeOfferPayload(input);
  return createHash('sha256').update(canonicalJson(normalized), 'utf8').digest('hex');
}

function uniqueStrings(values) {
  return [...new Set(values.filter((value) => typeof value === 'string' && value.length > 0))];
}

export function toPublicOffer(input, { imagePath }) {
  const offer = normalizeOfferPayload(input);
  if (!imagePath) {
    throw new CatalogContractError('missing_image', 'Для публичной записи требуется сохранённое изображение оффера.');
  }

  return {
    id: offer.id,
    project: offer.project,
    district: offer.district,
    layout: offer.layout,
    rooms: offer.rooms,
    area: offer.area,
    price: offer.price,
    finishing: offer.finishing,
    gifts: offer.gifts,
    validUntil: offer.validUntil,
    publishedAt: offer.source.publishedAt,
    imagePath,
    imageLabel: 'Изображение оффера',
    options: offer.options.map((option) => ({
      id: option.id,
      program: option.program,
      childrenCount: option.childrenCount,
      financing: option.financing,
      downPaymentType: option.downPaymentType,
      downPayment: option.downPayment,
      payment: option.payment,
      price: option.price,
      rate: option.rate,
      paymentPeriod: option.paymentPeriod,
      ratePeriod: option.ratePeriod,
      promotions: option.promotions,
      actionValidUntil: option.actionValidUntil,
      conditions: uniqueStrings([
        ...option.conditions,
        ...(option.stages ?? [])
      ]),
      origin: option.calculation?.kind === 'standard_mortgage'
        ? { calculated: true, label: 'Расчётные условия' }
        : { calculated: false, label: null }
    }))
  };
}

export const contractConstants = Object.freeze({
  promotionCodes: [...PROMOTION_CODES],
  actionDateKeys: [...ACTION_DATE_KEYS]
});
