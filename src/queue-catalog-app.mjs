import {
  filterConstants,
  filterOffers,
  nearestExpiry,
  optionActions,
  programCategory,
  sortByNearestExpiry,
  validateRanges,
  yekaterinburgToday
} from './catalog-filter-core.mjs';

const PAGE_SIZE = 24;
const NEW_DURATION_MS = 7 * 24 * 60 * 60 * 1000;
const INACTIVE_STORAGE_KEY = 'formula-offer-catalog-inactive-v2';
const PROGRAM_LABELS = Object.freeze({ family: 'Семейная', standard: 'Стандартная / новостройка', it: 'IT' });
const FINISHING_LABELS = Object.freeze({ finished: 'Готовая отделка', 'pre-finish': 'Предчистовая', unfinished: 'Без отделки' });
const moneyFormatter = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 0 });
const numberFormatter = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 2 });

function normalize(value) {
  return String(value ?? '').toLocaleLowerCase('ru-RU').replaceAll('ё', 'е').replace(/\s+/g, ' ').trim();
}

function money(value) {
  if (!value || !Number.isFinite(value.value)) return 'Не указано';
  return `${value.qualifier === 'from' ? 'от ' : ''}${moneyFormatter.format(value.value)} ₽`;
}

function percentage(value) {
  return Number.isFinite(value) ? `${numberFormatter.format(value)}%` : 'Не указана';
}

function area(value) {
  return Number.isFinite(value) ? `${numberFormatter.format(value)} м²` : 'Не указана';
}

function roomLabel(value) {
  if (value === 0) return 'Студия';
  if (Number.isInteger(value)) return `${value}-комнатная`;
  return 'Комнатность не указана';
}

function formatDate(value, today = yekaterinburgToday()) {
  if (!value) return null;
  if (value === today) return 'Последний день';
  const [year, month, day] = value.split('-');
  return `До ${day}.${month}.${year}`;
}

function isNew(offer, now = Date.now()) {
  const timestamp = Date.parse(offer.addedAt ?? '');
  return Number.isFinite(timestamp) && now >= timestamp && now - timestamp < NEW_DURATION_MS;
}

function plural(number, forms) {
  const abs = Math.abs(number) % 100;
  const last = abs % 10;
  if (abs > 10 && abs < 20) return forms[2];
  if (last === 1) return forms[0];
  if (last > 1 && last < 5) return forms[1];
  return forms[2];
}

function safeArray(value) { return Array.isArray(value) ? value : []; }

function normalizePublicOffer(offer) {
  return {
    ...offer,
    project: offer.project ?? 'ЖК не указан',
    district: offer.district ?? 'Район не указан',
    options: safeArray(offer.options),
    searchText: normalize([
      offer.project,
      offer.district,
      offer.layout,
      roomLabel(offer.rooms),
      ...safeArray(offer.options).flatMap((option) => [option.program, ...safeArray(option.conditions)])
    ].join(' '))
  };
}

function loadInactiveIds() {
  try {
    const value = JSON.parse(localStorage.getItem(INACTIVE_STORAGE_KEY) ?? '[]');
    return new Set(Array.isArray(value) ? value : []);
  } catch {
    return new Set();
  }
}

function createElement(name, className, text) {
  const element = document.createElement(name);
  if (className) element.className = className;
  if (text !== undefined) element.textContent = text;
  return element;
}

export function initializeQueueCatalog(catalog) {
  const offers = catalog.offers.map(normalizePublicOffer);
  const inactiveIds = loadInactiveIds();
  const selectedOptions = new Map();
  const state = {
    search: '',
    programs: new Set(),
    childrenCount: 'any',
    actions: new Set(),
    room: new Set(),
    district: new Set(),
    complex: new Set(),
    finishing: new Set(),
    ranges: {
      area: { min: null, max: null },
      price: { min: null, max: null },
      downPayment: { min: null, max: null },
      payment: { min: null, max: null },
      rate: { min: null, max: null }
    },
    expiringWithinDays: null,
    newOnly: false,
    sort: 'complex',
    statusView: 'active'
  };
  let visibleCount = PAGE_SIZE;
  let results = [];
  let modalOfferId = null;
  let lastFocused = null;

  const elements = {
    grid: document.getElementById('offers-grid'),
    search: document.getElementById('catalog-search'),
    resultCount: document.getElementById('results-count'),
    activeCount: document.getElementById('active-offers-count'),
    inactiveCount: document.getElementById('inactive-offers-count'),
    activeFilters: document.getElementById('active-filters'),
    empty: document.getElementById('empty-state'),
    emptyDescription: document.getElementById('empty-description'),
    reset: document.getElementById('reset-filters'),
    emptyReset: document.getElementById('empty-reset'),
    sort: document.getElementById('sort-select'),
    loadMoreWrap: document.getElementById('load-more-wrap'),
    loadMore: document.getElementById('load-more'),
    loadMoreCaption: document.getElementById('load-more-caption'),
    queueFilters: document.getElementById('queue-filter-sections'),
    legacyType: document.getElementById('legacy-type-filter'),
    programs: document.getElementById('program-options'),
    familyCategory: document.getElementById('family-category-filter'),
    children: document.getElementById('children-category'),
    actions: document.getElementById('promotion-options'),
    finishing: document.getElementById('finishing-options'),
    expiring: document.getElementById('expiring-filter'),
    newOnly: document.getElementById('new-only-filter'),
    rangeErrors: document.getElementById('range-errors'),
    roomOptions: document.getElementById('room-options'),
    filtersPanel: document.getElementById('filters-panel'),
    backdrop: document.getElementById('filter-backdrop'),
    mobileOpen: document.getElementById('mobile-filter-open'),
    mobileClose: document.getElementById('mobile-filter-close'),
    mobileApply: document.getElementById('mobile-apply'),
    mobileCount: document.getElementById('mobile-filter-count'),
    modal: document.getElementById('offer-modal'),
    modalImage: document.getElementById('modal-image'),
    modalType: document.getElementById('modal-type'),
    modalNew: document.getElementById('modal-new'),
    modalRoom: document.getElementById('modal-room'),
    modalTitle: document.getElementById('modal-title'),
    modalOfferTitle: document.getElementById('modal-offer-title'),
    modalDistrict: document.getElementById('modal-district'),
    modalScout: document.getElementById('modal-scout'),
    modalPurchase: document.getElementById('modal-purchase-options'),
    modalStatus: document.getElementById('modal-status-toggle'),
    modalDownload: document.getElementById('modal-download'),
    modalPrev: document.getElementById('modal-prev'),
    modalNext: document.getElementById('modal-next')
  };

  elements.queueFilters.hidden = false;
  elements.legacyType.hidden = true;
  elements.modalScout.hidden = true;
  elements.modalPurchase.hidden = false;
  document.body.classList.add('queue-catalog-mode');

  const availablePrograms = [...new Set(offers.flatMap((offer) => offer.options.map((option) => programCategory(option.program))))];
  const availableActions = [...new Set(offers.flatMap((offer) => offer.options.flatMap((option) => optionActions(offer, option).map((action) => action.code))))];
  const availableRooms = [...new Set(offers.map((offer) => offer.rooms))].sort((a, b) => (a ?? 99) - (b ?? 99));
  const filterValues = {
    district: [...new Set(offers.map((offer) => offer.district))].sort((a, b) => a.localeCompare(b, 'ru')),
    complex: [...new Set(offers.map((offer) => offer.project))].sort((a, b) => a.localeCompare(b, 'ru'))
  };

  function filterInput() {
    return {
      projects: [...state.complex],
      districts: [...state.district],
      rooms: [...state.room],
      programs: [...state.programs],
      childrenCount: state.childrenCount,
      actions: [...state.actions],
      finishing: [...state.finishing],
      ...state.ranges,
      expiringWithinDays: state.expiringWithinDays
    };
  }

  function optionForEntry(entry) {
    const stored = selectedOptions.get(entry.offer.id);
    const storedOption = entry.offer.options.find((option) => option.id === stored);
    if (storedOption) return storedOption;
    const selected = entry.selectedOption;
    selectedOptions.set(entry.offer.id, selected.id);
    return selected;
  }

  function activeOption(entry) {
    const matchingIds = new Set(entry.matchingOptions.map((option) => option.id));
    const stored = selectedOptions.get(entry.offer.id);
    if (!matchingIds.has(stored)) selectedOptions.set(entry.offer.id, entry.selectedOption.id);
    return optionForEntry(entry);
  }

  function matchesOuter(entry) {
    const offer = entry.offer;
    const inactive = inactiveIds.has(offer.id);
    if ((state.statusView === 'inactive') !== inactive) return false;
    if (state.search && !offer.searchText.includes(normalize(state.search))) return false;
    if (state.newOnly && !isNew(offer)) return false;
    return true;
  }

  function sorted(items) {
    if (state.sort === 'expiry') return sortByNearestExpiry(items);
    return [...items].sort((left, right) => {
      const a = left.offer;
      const b = right.offer;
      if (state.sort === 'district') return a.district.localeCompare(b.district, 'ru');
      if (state.sort === 'room') return (a.rooms ?? 99) - (b.rooms ?? 99);
      if (state.sort === 'price') {
        const aPrice = (activeOption(left).price ?? a.price)?.value ?? Number.MAX_SAFE_INTEGER;
        const bPrice = (activeOption(right).price ?? b.price)?.value ?? Number.MAX_SAFE_INTEGER;
        return aPrice - bPrice;
      }
      if (state.sort === 'type') return activeOption(left).program.localeCompare(activeOption(right).program, 'ru');
      return a.project.localeCompare(b.project, 'ru');
    });
  }

  function choiceButton(value, label, selected, count, kind) {
    const button = createElement('button', 'queue-choice');
    button.type = 'button';
    button.dataset[kind] = value;
    button.setAttribute('aria-pressed', String(selected));
    button.append(createElement('span', 'queue-choice-mark'), createElement('span', '', label));
    if (count !== undefined) button.append(createElement('span', 'option-count', String(count)));
    return button;
  }

  function renderPrograms() {
    elements.programs.replaceChildren(...availablePrograms.map((value) => choiceButton(
      value,
      PROGRAM_LABELS[value] ?? value.replace(/^other:/, ''),
      state.programs.has(value),
      offers.filter((offer) => offer.options.some((option) => programCategory(option.program) === value)).length,
      'program'
    )));
    const familyOnly = state.programs.size === 1 && state.programs.has('family');
    elements.familyCategory.hidden = !familyOnly;
    if (!familyOnly && state.childrenCount !== 'any') {
      state.childrenCount = 'any';
      elements.children.value = 'any';
    }
  }

  function renderActions() {
    elements.actions.replaceChildren(...availableActions.map((code) => choiceButton(
      code,
      filterConstants.actions[code] ?? code,
      state.actions.has(code),
      undefined,
      'action'
    )));
  }

  function renderFinishing() {
    const values = [...new Set(offers.map((offer) => offer.finishing).filter((value) => FINISHING_LABELS[value]))];
    elements.finishing.replaceChildren(...values.map((value) => choiceButton(
      value,
      FINISHING_LABELS[value],
      state.finishing.has(value),
      undefined,
      'finishing'
    )));
  }

  function renderRooms() {
    elements.roomOptions.replaceChildren(...availableRooms.map((value) => {
      const button = createElement('button', 'room-option', value === 0 ? 'Ст' : String(value ?? '—'));
      button.type = 'button';
      button.dataset.room = String(value);
      button.title = roomLabel(value);
      button.setAttribute('aria-pressed', String(state.room.has(value)));
      return button;
    }));
  }

  function renderDropdown(filter) {
    const dropdown = document.querySelector(`.filter-dropdown[data-filter="${filter}"]`);
    const options = dropdown.querySelector('.dropdown-options');
    const search = normalize(dropdown.querySelector('input').value);
    const selected = state[filter];
    dropdown.querySelector('.dropdown-value').textContent = selected.size
      ? selected.size === 1 ? [...selected][0] : `Выбрано: ${selected.size}`
      : filter === 'district' ? 'Все районы' : 'Все ЖК';
    const visible = filterValues[filter].filter((value) => normalize(value).includes(search));
    options.replaceChildren(...visible.map((value) => {
      const button = createElement('button', 'dropdown-option');
      button.type = 'button';
      button.dataset.value = value;
      button.setAttribute('aria-pressed', String(selected.has(value)));
      button.innerHTML = '<span class="option-check"><svg viewBox="0 0 24 24"><path d="m6 12 4 4 8-8"/></svg></span>';
      button.append(createElement('span', 'dropdown-option-name', value));
      return button;
    }));
  }

  function detail(label, value, className = '') {
    const wrapper = createElement('div', `purchase-detail ${className}`.trim());
    wrapper.append(createElement('span', '', label), createElement('strong', '', value));
    return wrapper;
  }

  function variantSummary(offer, option) {
    const wrapper = createElement('div', 'variant-summary');
    const effectivePrice = option.price ?? offer.price;
    wrapper.append(
      detail('Цена', money(effectivePrice), effectivePrice?.qualifier === 'from' ? 'is-from' : ''),
      detail('Свои средства на ПВ', money(option.downPayment), option.downPayment?.qualifier === 'from' ? 'is-from' : ''),
      detail('Платёж', `${money(option.payment)}${option.paymentPeriod ? ` · ${option.paymentPeriod}` : ''}`, option.payment?.qualifier === 'from' ? 'is-from' : ''),
      detail('Ставка', `${percentage(option.rate)}${option.ratePeriod ? ` · ${option.ratePeriod}` : ' · период не указан'}`)
    );
    if ([effectivePrice, option.downPayment, option.payment].some((item) => item?.qualifier === 'from')) {
      wrapper.append(createElement('p', 'from-note', 'Сумма указана «от»: окончательные условия требуют уточнения.'));
    }
    return wrapper;
  }

  function actionBadges(offer, option) {
    const wrapper = createElement('div', 'promotion-badges');
    const today = yekaterinburgToday();
    for (const action of optionActions(offer, option, { today })) {
      const badge = createElement('span', 'promotion-badge');
      badge.append(createElement('strong', '', action.label));
      const date = formatDate(action.validUntil, today);
      if (date) badge.append(createElement('small', '', date));
      wrapper.append(badge);
    }
    return wrapper;
  }

  function variantSelect(offer, option, className = '') {
    const label = createElement('label', `variant-select ${className}`.trim());
    label.append(createElement('span', '', 'Вариант покупки'));
    const select = document.createElement('select');
    select.dataset.offerVariant = offer.id;
    for (const candidate of offer.options) {
      const item = document.createElement('option');
      item.value = candidate.id;
      item.textContent = `${candidate.program}${candidate.childrenCount ? ` · ${candidate.childrenCount === 5 ? '5+' : candidate.childrenCount} ${plural(candidate.childrenCount, ['ребёнок', 'ребёнка', 'детей'])}` : ''}`;
      item.selected = candidate.id === option.id;
      select.append(item);
    }
    label.append(select);
    return label;
  }

  function updateCardVariant(card, offer, option) {
    card.querySelector('.variant-slot').replaceChildren(variantSummary(offer, option), actionBadges(offer, option));
    card.querySelector('.program-badge').textContent = option.program;
    const select = card.querySelector('[data-offer-variant]');
    if (select) select.value = option.id;
    card.dataset.optionId = option.id;
  }

  function card(entry, index) {
    const offer = entry.offer;
    const option = activeOption(entry);
    const article = createElement('article', `offer-card queue-offer-card${isNew(offer) ? ' is-new' : ''}${inactiveIds.has(offer.id) ? ' is-inactive' : ''}`);
    article.style.setProperty('--card-index', index);
    article.dataset.offerId = offer.id;
    article.dataset.optionId = option.id;
    const preview = createElement('button', 'offer-preview');
    preview.type = 'button';
    preview.dataset.openOffer = offer.id;
    const image = document.createElement('img');
    image.src = offer.imagePath;
    image.alt = `${offer.project} — ${roomLabel(offer.rooms)}, ${area(offer.area)}`;
    image.loading = index < 8 ? 'eager' : 'lazy';
    const badge = createElement('span', 'type-badge program-badge', option.program);
    const newBadge = createElement('span', 'new-badge', 'NEW');
    newBadge.hidden = !isNew(offer);
    preview.append(image, badge, newBadge, createElement('span', 'preview-overlay', 'Открыть предложение'));
    const body = createElement('div', 'offer-card-body');
    const meta = createElement('div', 'card-meta');
    meta.append(createElement('span', 'card-room', roomLabel(offer.rooms)), createElement('span', 'card-district', offer.district));
    body.append(meta, createElement('h2', '', offer.project), createElement('p', 'offer-name', `${offer.layout ?? roomLabel(offer.rooms)} · ${area(offer.area)}`));
    if (offer.options.length > 1) body.append(variantSelect(offer, option));
    const slot = createElement('div', 'variant-slot');
    body.append(slot);
    const actions = createElement('div', 'card-actions');
    const download = createElement('button', 'download-button compact-download', 'Скачать');
    download.type = 'button';
    download.dataset.downloadVariant = offer.id;
    const status = createElement('button', 'modal-status-button');
    status.type = 'button';
    status.dataset.toggleOfferStatus = offer.id;
    status.textContent = inactiveIds.has(offer.id) ? 'Вернуть' : 'Не актуально';
    actions.append(download, status);
    body.append(actions);
    article.append(preview, body);
    updateCardVariant(article, offer, option);
    return article;
  }

  function renderCards() {
    const visible = results.slice(0, visibleCount);
    elements.grid.replaceChildren(...visible.map(card));
    elements.empty.hidden = results.length > 0;
    elements.emptyDescription.textContent = 'Попробуйте изменить диапазон, программу или убрать часть акций.';
    elements.loadMoreWrap.hidden = visible.length >= results.length;
    if (!elements.loadMoreWrap.hidden) elements.loadMoreCaption.textContent = `Показано ${visible.length} из ${results.length}`;
  }

  function rangeValue(key, side) {
    const input = document.querySelector(`[data-range="${key}"][data-side="${side}"]`);
    const value = input.value === '' ? null : Number(input.value);
    return Number.isFinite(value) ? value : null;
  }

  function collectRanges() {
    for (const key of Object.keys(state.ranges)) {
      state.ranges[key] = { min: rangeValue(key, 'min'), max: rangeValue(key, 'max') };
    }
  }

  function renderRangeErrors() {
    const errors = validateRanges(state.ranges);
    elements.rangeErrors.hidden = !Object.keys(errors).length;
    elements.rangeErrors.textContent = Object.values(errors).join(' ');
    return errors;
  }

  function selectedCount() {
    const rangeCount = Object.values(state.ranges).filter((range) => range.min != null || range.max != null).length;
    return state.programs.size + state.actions.size + state.room.size + state.district.size + state.complex.size
      + state.finishing.size + rangeCount + (state.childrenCount === 'any' ? 0 : 1)
      + (state.expiringWithinDays == null ? 0 : 1) + (state.newOnly ? 1 : 0) + (state.search ? 1 : 0);
  }

  function chip(label, group, value = '') {
    const item = createElement('span', 'active-chip', label);
    const button = createElement('button', '', '×');
    button.type = 'button';
    button.dataset.removeGroup = group;
    button.dataset.removeValue = value;
    button.setAttribute('aria-label', `Убрать фильтр ${label}`);
    item.append(button);
    return item;
  }

  function renderActiveFilters() {
    const chips = [];
    state.programs.forEach((value) => chips.push(chip(PROGRAM_LABELS[value] ?? value, 'programs', value)));
    state.actions.forEach((value) => chips.push(chip(filterConstants.actions[value] ?? value, 'actions', value)));
    state.room.forEach((value) => chips.push(chip(roomLabel(value), 'room', String(value))));
    state.district.forEach((value) => chips.push(chip(value, 'district', value)));
    state.complex.forEach((value) => chips.push(chip(value, 'complex', value)));
    state.finishing.forEach((value) => chips.push(chip(FINISHING_LABELS[value], 'finishing', value)));
    if (state.childrenCount !== 'any') chips.push(chip(`Категория семьи: ${state.childrenCount === 5 ? '5+' : state.childrenCount}`, 'childrenCount'));
    if (state.expiringWithinDays != null) chips.push(chip(state.expiringWithinDays === 0 ? 'Заканчиваются сегодня' : `Заканчиваются за ${state.expiringWithinDays} дней`, 'expiring'));
    if (state.newOnly) chips.push(chip('NEW', 'newOnly'));
    elements.activeFilters.replaceChildren(...chips);
  }

  function renderSummary() {
    const inactiveCount = offers.filter((offer) => inactiveIds.has(offer.id)).length;
    elements.resultCount.textContent = `${state.statusView === 'inactive' ? 'Не актуально' : 'Найдено квартир'}: ${results.length}`;
    elements.activeCount.textContent = offers.length - inactiveCount;
    elements.inactiveCount.textContent = inactiveCount;
    document.querySelectorAll('[data-status-view]').forEach((button) => {
      const active = button.dataset.statusView === state.statusView;
      button.classList.toggle('is-active', active);
      button.setAttribute('aria-selected', String(active));
    });
    const count = selectedCount();
    elements.reset.disabled = count === 0;
    elements.mobileCount.hidden = count === 0;
    elements.mobileCount.textContent = String(count);
    document.getElementById('offers-total').textContent = offers.filter((offer) => !inactiveIds.has(offer.id)).length;
    document.getElementById('complexes-total').textContent = new Set(offers.map((offer) => offer.project)).size;
    document.getElementById('catalog-updated').textContent = catalog.generatedAt
      ? `Каталог обновлён ${new Intl.DateTimeFormat('ru-RU', { dateStyle: 'long', timeStyle: 'short', timeZone: 'Asia/Yekaterinburg' }).format(new Date(catalog.generatedAt))}`
      : '';
  }

  function renderAll() {
    collectRanges();
    renderPrograms();
    renderActions();
    renderFinishing();
    renderRooms();
    renderDropdown('district');
    renderDropdown('complex');
    const errors = renderRangeErrors();
    results = Object.keys(errors).length ? [] : sorted(filterOffers(offers, filterInput()).filter(matchesOuter));
    for (const entry of results) activeOption(entry);
    visibleCount = PAGE_SIZE;
    renderActiveFilters();
    renderSummary();
    renderCards();
    if (modalOfferId) updateModal();
  }

  function currentEntry(id) { return results.find((entry) => entry.offer.id === id) ?? null; }

  function conditionsBlock(option) {
    const wrapper = createElement('div', 'variant-conditions');
    wrapper.append(createElement('h3', '', 'Условия варианта'));
    const facts = createElement('dl', 'variant-facts');
    const factsList = [
      ['Программа', option.program],
      ['Категория семьи', option.childrenCount ? `${option.childrenCount === 5 ? '5+' : option.childrenCount} ${plural(option.childrenCount, ['ребёнок', 'ребёнка', 'детей'])}` : 'Не указана'],
      ['Ставка', percentage(option.rate)],
      ['Период ставки', option.ratePeriod ?? 'Период не указан'],
      ['Период платежа', option.paymentPeriod ?? 'Период не указан']
    ];
    for (const [label, value] of factsList) {
      const item = createElement('div');
      item.append(createElement('dt', '', label), createElement('dd', '', value));
      facts.append(item);
    }
    wrapper.append(facts);
    if (option.conditions?.length) {
      const list = createElement('ul');
      option.conditions.forEach((condition) => list.append(createElement('li', '', condition)));
      wrapper.append(list);
    }
    return wrapper;
  }

  function updateModal() {
    const entry = currentEntry(modalOfferId);
    if (!entry) return closeModal();
    const offer = entry.offer;
    const option = optionForEntry(entry);
    elements.modalImage.src = offer.imagePath;
    elements.modalImage.alt = `${offer.project} — ${roomLabel(offer.rooms)}, ${area(offer.area)}`;
    elements.modalType.textContent = option.program;
    elements.modalNew.hidden = !isNew(offer);
    elements.modalRoom.textContent = roomLabel(offer.rooms);
    elements.modalTitle.textContent = offer.project;
    elements.modalOfferTitle.textContent = `${offer.layout ?? roomLabel(offer.rooms)} · ${area(offer.area)}`;
    elements.modalDistrict.textContent = `Район: ${offer.district}`;
    elements.modalPurchase.replaceChildren(
      offer.options.length > 1 ? variantSelect(offer, option, 'is-modal') : createElement('div'),
      variantSummary(offer, option),
      actionBadges(offer, option),
      conditionsBlock(option)
    );
    elements.modalStatus.textContent = inactiveIds.has(offer.id) ? 'Вернуть в актуальные' : 'Пометить «Не актуально»';
    elements.modalStatus.dataset.toggleOfferStatus = offer.id;
    elements.modalDownload.removeAttribute('href');
    elements.modalDownload.dataset.downloadVariant = offer.id;
    elements.modalPrev.hidden = results.length < 2;
    elements.modalNext.hidden = results.length < 2;
  }

  function openModal(id, trigger) {
    modalOfferId = id;
    lastFocused = trigger;
    updateModal();
    elements.modal.hidden = false;
    elements.modal.setAttribute('aria-hidden', 'false');
    document.body.classList.add('modal-open');
    elements.modal.querySelector('.modal-close').focus();
  }

  function closeModal() {
    elements.modal.hidden = true;
    elements.modal.setAttribute('aria-hidden', 'true');
    elements.modalImage.removeAttribute('src');
    document.body.classList.remove('modal-open');
    modalOfferId = null;
    lastFocused?.focus?.();
  }

  function navigateModal(direction) {
    const index = results.findIndex((entry) => entry.offer.id === modalOfferId);
    if (index < 0 || results.length < 2) return;
    modalOfferId = results[(index + direction + results.length) % results.length].offer.id;
    updateModal();
  }

  function persistInactive() {
    localStorage.setItem(INACTIVE_STORAGE_KEY, JSON.stringify([...inactiveIds]));
  }

  function toggleInactive(id) {
    if (inactiveIds.has(id)) inactiveIds.delete(id); else inactiveIds.add(id);
    persistInactive();
    if (modalOfferId === id) closeModal();
    renderAll();
  }

  function closeMobile() {
    elements.filtersPanel.classList.remove('is-mobile-open');
    elements.backdrop.hidden = true;
    elements.mobileOpen.setAttribute('aria-expanded', 'false');
    document.body.classList.remove('filters-open');
  }

  function reset() {
    state.search = '';
    elements.search.value = '';
    ['programs', 'actions', 'room', 'district', 'complex', 'finishing'].forEach((key) => state[key].clear());
    state.childrenCount = 'any';
    elements.children.value = 'any';
    state.expiringWithinDays = null;
    elements.expiring.value = '';
    state.newOnly = false;
    elements.newOnly.checked = false;
    document.querySelectorAll('[data-range]').forEach((input) => { input.value = ''; });
    document.querySelectorAll('.dropdown-search input').forEach((input) => { input.value = ''; });
    renderAll();
  }

  async function downloadVariant(offer, option) {
    const image = new Image();
    image.crossOrigin = 'anonymous';
    image.src = offer.imagePath;
    await image.decode();
    const scale = Math.min(1, 1400 / image.naturalWidth);
    const width = Math.round(image.naturalWidth * scale);
    const imageHeight = Math.round(image.naturalHeight * scale);
    const footerHeight = 310;
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = imageHeight + footerHeight;
    const context = canvas.getContext('2d');
    context.fillStyle = '#ffffff';
    context.fillRect(0, 0, width, canvas.height);
    context.drawImage(image, 0, 0, width, imageHeight);
    const pad = Math.max(28, Math.round(width * 0.04));
    context.fillStyle = '#21134d';
    context.font = `700 ${Math.max(26, Math.round(width * 0.035))}px Arial`;
    context.fillText(option.program, pad, imageHeight + 58);
    context.font = `600 ${Math.max(20, Math.round(width * 0.026))}px Arial`;
    context.fillText(`Цена: ${money(option.price ?? offer.price)}`, pad, imageHeight + 108);
    context.fillText(`Свои средства на ПВ: ${money(option.downPayment)}`, pad, imageHeight + 150);
    context.fillText(`Платёж: ${money(option.payment)}${option.paymentPeriod ? ` · ${option.paymentPeriod}` : ''}`, pad, imageHeight + 192);
    context.fillText(`Ставка: ${percentage(option.rate)}${option.ratePeriod ? ` · ${option.ratePeriod}` : ''}`, pad, imageHeight + 234);
    context.fillStyle = '#6b6577';
    context.font = `400 ${Math.max(16, Math.round(width * 0.019))}px Arial`;
    context.fillText('Изображение оффера. Условия соответствуют выбранному варианту покупки.', pad, imageHeight + 280);
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `${offer.project}-${option.id}.png`.replace(/[\\/:*?"<>|]/g, '-');
    link.click();
    setTimeout(() => URL.revokeObjectURL(link.href), 1000);
  }

  elements.programs.addEventListener('click', (event) => {
    const button = event.target.closest('[data-program]');
    if (!button) return;
    const value = button.dataset.program;
    if (state.programs.has(value)) state.programs.delete(value); else state.programs.add(value);
    renderAll();
  });
  elements.actions.addEventListener('click', (event) => {
    const button = event.target.closest('[data-action]');
    if (!button) return;
    const value = button.dataset.action;
    if (state.actions.has(value)) state.actions.delete(value); else state.actions.add(value);
    renderAll();
  });
  elements.finishing.addEventListener('click', (event) => {
    const button = event.target.closest('[data-finishing]');
    if (!button) return;
    const value = button.dataset.finishing;
    if (state.finishing.has(value)) state.finishing.delete(value); else state.finishing.add(value);
    renderAll();
  });
  elements.roomOptions.addEventListener('click', (event) => {
    const button = event.target.closest('[data-room]');
    if (!button) return;
    const value = Number(button.dataset.room);
    if (state.room.has(value)) state.room.delete(value); else state.room.add(value);
    renderAll();
  });
  elements.children.addEventListener('change', () => { state.childrenCount = elements.children.value === 'any' ? 'any' : Number(elements.children.value); renderAll(); });
  elements.expiring.addEventListener('change', () => { state.expiringWithinDays = elements.expiring.value === '' ? null : Number(elements.expiring.value); renderAll(); });
  elements.newOnly.addEventListener('change', () => { state.newOnly = elements.newOnly.checked; renderAll(); });
  document.querySelectorAll('[data-range]').forEach((input) => input.addEventListener('input', renderAll));
  elements.search.addEventListener('input', () => { state.search = elements.search.value; renderAll(); });
  elements.sort.addEventListener('change', () => { state.sort = elements.sort.value; renderAll(); });
  elements.reset.addEventListener('click', reset);
  elements.emptyReset.addEventListener('click', reset);
  elements.loadMore.addEventListener('click', () => { visibleCount += PAGE_SIZE; renderCards(); });

  document.querySelectorAll('.filter-dropdown').forEach((dropdown) => {
    const filter = dropdown.dataset.filter;
    const trigger = dropdown.querySelector('.dropdown-trigger');
    const panel = dropdown.querySelector('.dropdown-panel');
    const search = dropdown.querySelector('input');
    trigger.addEventListener('click', (event) => {
      event.stopPropagation();
      const open = !dropdown.classList.contains('is-open');
      document.querySelectorAll('.filter-dropdown').forEach((item) => { item.classList.remove('is-open'); item.querySelector('.dropdown-panel').hidden = true; });
      dropdown.classList.toggle('is-open', open);
      panel.hidden = !open;
      trigger.setAttribute('aria-expanded', String(open));
    });
    panel.addEventListener('click', (event) => {
      event.stopPropagation();
      const button = event.target.closest('[data-value]');
      if (!button) return;
      const value = button.dataset.value;
      if (state[filter].has(value)) state[filter].delete(value); else state[filter].add(value);
      renderAll();
    });
    search.addEventListener('input', () => renderDropdown(filter));
  });

  document.addEventListener('click', () => document.querySelectorAll('.filter-dropdown').forEach((item) => { item.classList.remove('is-open'); item.querySelector('.dropdown-panel').hidden = true; }));
  document.querySelector('.status-tabs').addEventListener('click', (event) => {
    const button = event.target.closest('[data-status-view]');
    if (!button) return;
    state.statusView = button.dataset.statusView;
    renderAll();
  });
  elements.activeFilters.addEventListener('click', (event) => {
    const button = event.target.closest('[data-remove-group]');
    if (!button) return;
    const group = button.dataset.removeGroup;
    const value = button.dataset.removeValue;
    if (state[group] instanceof Set) state[group].delete(group === 'room' ? Number(value) : value);
    else if (group === 'childrenCount') { state.childrenCount = 'any'; elements.children.value = 'any'; }
    else if (group === 'expiring') { state.expiringWithinDays = null; elements.expiring.value = ''; }
    else if (group === 'newOnly') { state.newOnly = false; elements.newOnly.checked = false; }
    renderAll();
  });

  elements.grid.addEventListener('change', (event) => {
    const select = event.target.closest('[data-offer-variant]');
    if (!select) return;
    selectedOptions.set(select.dataset.offerVariant, select.value);
    const entry = currentEntry(select.dataset.offerVariant);
    const cardNode = select.closest('.offer-card');
    const option = entry.offer.options.find((item) => item.id === select.value);
    updateCardVariant(cardNode, entry.offer, option);
  });
  elements.grid.addEventListener('click', async (event) => {
    const status = event.target.closest('[data-toggle-offer-status]');
    if (status) return toggleInactive(status.dataset.toggleOfferStatus);
    const download = event.target.closest('[data-download-variant]');
    if (download) {
      const entry = currentEntry(download.dataset.downloadVariant);
      await downloadVariant(entry.offer, optionForEntry(entry));
      return;
    }
    const preview = event.target.closest('[data-open-offer]');
    if (preview) openModal(preview.dataset.openOffer, preview);
  });

  elements.modalPurchase.addEventListener('change', (event) => {
    const select = event.target.closest('[data-offer-variant]');
    if (!select) return;
    selectedOptions.set(select.dataset.offerVariant, select.value);
    updateModal();
  });
  elements.modalDownload.addEventListener('click', async (event) => {
    if (!event.currentTarget.dataset.downloadVariant) return;
    event.preventDefault();
    const entry = currentEntry(event.currentTarget.dataset.downloadVariant);
    await downloadVariant(entry.offer, optionForEntry(entry));
  });
  elements.modalStatus.addEventListener('click', () => toggleInactive(elements.modalStatus.dataset.toggleOfferStatus));
  elements.modalPrev.addEventListener('click', () => navigateModal(-1));
  elements.modalNext.addEventListener('click', () => navigateModal(1));
  elements.modal.querySelectorAll('[data-close-modal]').forEach((item) => item.addEventListener('click', closeModal));
  elements.mobileOpen.addEventListener('click', () => {
    elements.filtersPanel.classList.add('is-mobile-open');
    elements.backdrop.hidden = false;
    elements.mobileOpen.setAttribute('aria-expanded', 'true');
    document.body.classList.add('filters-open');
  });
  elements.mobileClose.addEventListener('click', closeMobile);
  elements.mobileApply.addEventListener('click', closeMobile);
  elements.backdrop.addEventListener('click', closeMobile);
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && !elements.modal.hidden) closeModal();
    if (event.key === 'ArrowLeft' && !elements.modal.hidden) navigateModal(-1);
    if (event.key === 'ArrowRight' && !elements.modal.hidden) navigateModal(1);
  });

  renderAll();
}
