const ACTIONS = Object.freeze({
  rate_subsidy: 'Субсидированная ставка',
  partial_down_payment: 'ЧПВ',
  zero_down_payment: 'Без первоначального взноса',
  down_payment_compensation: 'Компенсация первоначального взноса',
  tranche: 'Траншевая ипотека',
  installment: 'Рассрочка',
  renovation_gift: 'Ремонт в подарок',
  parking_gift: 'Паркинг в подарок',
  storage_gift: 'Кладовая в подарок',
  furniture_gift: 'Мебель в подарок',
  kitchen_gift: 'Кухня в подарок',
  developer_pays_mortgage: 'Застройщик оплачивает или компенсирует ипотечные платежи',
  discount: 'Скидка'
});

const ACTION_DATE_BY_DERIVED_CODE = Object.freeze({
  partial_down_payment: 'partial_down_payment',
  zero_down_payment: 'zero_down_payment',
  down_payment_compensation: 'down_payment_compensation',
  tranche: 'tranche',
  installment: 'installment'
});

function dayNumber(date) {
  if (!date) return null;
  const [year, month, day] = date.split('-').map(Number);
  return Date.UTC(year, month - 1, day) / 86_400_000;
}

export function yekaterinburgToday(now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Yekaterinburg',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).formatToParts(now);
  const values = Object.fromEntries(parts.map(({ type, value }) => [type, value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function earlierDate(left, right) {
  if (!left) return right ?? null;
  if (!right) return left;
  return dayNumber(left) <= dayNumber(right) ? left : right;
}

function activeOn(date, today) {
  return !date || dayNumber(date) >= dayNumber(today);
}

function normalizedText(value) {
  return String(value ?? '').toLocaleLowerCase('ru-RU').replaceAll('ё', 'е').trim();
}

export function programCategory(program) {
  const value = normalizedText(program);
  if (value.includes('семейн')) return 'family';
  if (value === 'it' || value.includes('it-') || value.includes('it ипот') || value.includes('айти')) return 'it';
  if (value.includes('стандарт') || value.includes('новострой')) return 'standard';
  return `other:${value}`;
}

function derivedActions(option) {
  const actions = [];
  if (option.downPaymentType === 'partial') actions.push('partial_down_payment');
  if (option.downPaymentType === 'zero') actions.push('zero_down_payment');
  if (option.downPaymentType === 'compensated') actions.push('down_payment_compensation');
  if (option.financing === 'tranche') actions.push('tranche');
  if (option.financing === 'installment') actions.push('installment');
  return actions;
}

export function optionActions(offer, option, { today = yekaterinburgToday() } = {}) {
  const result = [];
  for (const code of derivedActions(option)) {
    const individual = option.actionValidUntil?.[ACTION_DATE_BY_DERIVED_CODE[code]] ?? null;
    const validUntil = earlierDate(offer.validUntil, individual);
    if (activeOn(validUntil, today)) {
      result.push({ code, label: ACTIONS[code], validUntil });
    }
  }

  for (const promotion of option.promotions ?? []) {
    if (!promotion.confirmed) continue;
    const validUntil = earlierDate(offer.validUntil, promotion.validUntil);
    if (activeOn(validUntil, today)) {
      result.push({ code: promotion.code, label: promotion.label, validUntil });
    }
  }
  return result;
}

function inSelection(value, selected) {
  return !selected?.length || selected.includes(value);
}

function inRange(value, range) {
  if (!range || (range.min == null && range.max == null)) return true;
  if (value == null || !Number.isFinite(value)) return false;
  if (range.min != null && value < range.min) return false;
  if (range.max != null && value > range.max) return false;
  return true;
}

function moneyValue(money) {
  return money?.value ?? null;
}

export function validateRanges(filters) {
  const errors = {};
  for (const key of ['area', 'price', 'downPayment', 'payment', 'rate']) {
    const range = filters[key];
    if (!range) continue;
    if ((range.min != null && range.min < 0) || (range.max != null && range.max < 0)) {
      errors[key] = 'Значение не может быть отрицательным.';
    } else if (range.min != null && range.max != null && range.min > range.max) {
      errors[key] = 'Значение «от» не может быть больше значения «до».';
    }
  }
  return errors;
}

function expiryMatches(offer, actions, selectedActionCodes, days, today) {
  if (days == null) return true;
  const todayNumber = dayNumber(today);
  let dates;
  if (selectedActionCodes.length) {
    dates = selectedActionCodes.map((code) => actions.find((action) => action.code === code)?.validUntil ?? null);
    if (dates.some((date) => !date)) return false;
  } else if (offer.validUntil) {
    dates = [offer.validUntil];
  } else {
    dates = actions.map((action) => action.validUntil).filter(Boolean);
    if (!dates.length) return false;
  }
  const numbers = dates.map(dayNumber);
  if (numbers.some((number) => number < todayNumber)) return false;
  return Math.min(...numbers) <= todayNumber + days;
}

function offerFieldsMatch(offer, filters) {
  return inSelection(offer.project, filters.projects)
    && inSelection(offer.district, filters.districts)
    && inSelection(offer.rooms, filters.rooms)
    && inSelection(offer.finishing, filters.finishing)
    && inRange(offer.area, filters.area);
}

export function getMatchingOptions(offer, filters = {}, { now = new Date() } = {}) {
  const errors = validateRanges(filters);
  if (Object.keys(errors).length) return { options: [], errors };

  const today = yekaterinburgToday(now);
  if (!activeOn(offer.validUntil, today) || !offerFieldsMatch(offer, filters)) {
    return { options: [], errors };
  }

  const selectedActions = filters.actions ?? [];
  const selectedPrograms = filters.programs ?? [];
  const applyChildren = selectedPrograms.length === 1
    && selectedPrograms[0] === 'family'
    && filters.childrenCount !== undefined
    && filters.childrenCount !== null
    && filters.childrenCount !== 'any';

  const options = (offer.options ?? []).filter((option) => {
    const category = programCategory(option.program);
    if (!inSelection(category, selectedPrograms)) return false;
    if (applyChildren && option.childrenCount !== Number(filters.childrenCount)) return false;

    const actions = optionActions(offer, option, { today });
    const codes = new Set(actions.map((action) => action.code));
    if (!selectedActions.every((code) => codes.has(code))) return false;

    const effectivePrice = option.price ?? offer.price;
    if (!inRange(moneyValue(effectivePrice), filters.price)) return false;
    if (!inRange(moneyValue(option.downPayment), filters.downPayment)) return false;
    if (!inRange(moneyValue(option.payment), filters.payment)) return false;
    if (!inRange(option.rate, filters.rate)) return false;
    if (!expiryMatches(offer, actions, selectedActions, filters.expiringWithinDays, today)) return false;
    return true;
  });

  return { options, errors };
}

export function filterOffers(offers, filters = {}, context = {}) {
  const results = [];
  for (const offer of offers) {
    const match = getMatchingOptions(offer, filters, context);
    if (match.options.length) {
      results.push({ offer, matchingOptions: match.options, selectedOption: match.options[0] });
    }
  }
  return results;
}

export function nearestExpiry(offer, option, { now = new Date() } = {}) {
  const today = yekaterinburgToday(now);
  const dates = optionActions(offer, option, { today })
    .map((action) => action.validUntil)
    .filter(Boolean);
  if (offer.validUntil) dates.push(offer.validUntil);
  return dates.sort()[0] ?? null;
}

export function sortByNearestExpiry(results, context = {}) {
  return [...results].sort((left, right) => {
    const leftDate = nearestExpiry(left.offer, left.selectedOption, context);
    const rightDate = nearestExpiry(right.offer, right.selectedOption, context);
    if (!leftDate && !rightDate) return 0;
    if (!leftDate) return 1;
    if (!rightDate) return -1;
    return leftDate.localeCompare(rightDate);
  });
}

export const filterConstants = Object.freeze({ actions: ACTIONS });
