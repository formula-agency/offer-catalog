(function () {
  'use strict';

  const catalog = window.OFFERS_CATALOG;
  const grid = document.getElementById('offers-grid');

  if (!catalog || !Array.isArray(catalog.offers)) {
    grid.innerHTML = '<p class="data-error">Не удалось загрузить данные каталога. Запустите файл «Обновить каталог.cmd» и обновите страницу.</p>';
    document.getElementById('results-count').textContent = 'Каталог недоступен';
    return;
  }

  const PAGE_SIZE = 24;
  const INACTIVE_STORAGE_KEY = 'formula-offer-catalog-inactive-v1';
  const TYPE_COLORS = {
    'Акции и скидки': '#e85d12',
    'Без ПВ и ЧПВ': '#7b3fc4',
    'Рассрочка': '#c97819',
    'С ремонтом': '#a45b2a',
    'Субсидия «Семейка»': '#19866e',
    'Субсидия «Стандарт»': '#405cc9'
  };
  const TYPE_ORDER = [
    'Акции и скидки',
    'Без ПВ и ЧПВ',
    'Рассрочка',
    'С ремонтом',
    'Субсидия «Семейка»',
    'Субсидия «Стандарт»'
  ];
  const ROOM_ORDER = ['studio', '1', '2', '3', '4', 'other'];
  const ROOM_SHORT = {
    studio: 'Ст',
    '1': '1',
    '2': '2',
    '3': '3',
    '4': '4',
    other: '—'
  };

  const state = {
    search: '',
    type: new Set(),
    room: new Set(),
    district: new Set(),
    complex: new Set(),
    sort: 'complex',
    statusView: 'active'
  };

  let visibleCount = PAGE_SIZE;
  let filteredOffers = [];
  let modalOfferId = null;
  let lastFocusedElement = null;
  let toastTimer = null;

  const elements = {
    search: document.getElementById('catalog-search'),
    typeOptions: document.getElementById('type-options'),
    roomOptions: document.getElementById('room-options'),
    resultsCount: document.getElementById('results-count'),
    activeOffersCount: document.getElementById('active-offers-count'),
    inactiveOffersCount: document.getElementById('inactive-offers-count'),
    activeFilters: document.getElementById('active-filters'),
    reset: document.getElementById('reset-filters'),
    emptyReset: document.getElementById('empty-reset'),
    empty: document.getElementById('empty-state'),
    emptyTitle: document.getElementById('empty-title'),
    emptyDescription: document.getElementById('empty-description'),
    sort: document.getElementById('sort-select'),
    loadMoreWrap: document.getElementById('load-more-wrap'),
    loadMore: document.getElementById('load-more'),
    loadMoreCaption: document.getElementById('load-more-caption'),
    filtersPanel: document.getElementById('filters-panel'),
    filterBackdrop: document.getElementById('filter-backdrop'),
    mobileFilterOpen: document.getElementById('mobile-filter-open'),
    mobileFilterClose: document.getElementById('mobile-filter-close'),
    mobileFilterCount: document.getElementById('mobile-filter-count'),
    mobileApply: document.getElementById('mobile-apply'),
    modal: document.getElementById('offer-modal'),
    modalImage: document.getElementById('modal-image'),
    modalType: document.getElementById('modal-type'),
    modalRoom: document.getElementById('modal-room'),
    modalTitle: document.getElementById('modal-title'),
    modalOfferTitle: document.getElementById('modal-offer-title'),
    modalDistrict: document.getElementById('modal-district'),
    modalStatusToggle: document.getElementById('modal-status-toggle'),
    modalDownload: document.getElementById('modal-download'),
    modalPrev: document.getElementById('modal-prev'),
    modalNext: document.getElementById('modal-next'),
    toast: document.getElementById('catalog-toast')
  };

  const normalize = (value) => String(value || '')
    .toLocaleLowerCase('ru-RU')
    .replace(/ё/g, 'е')
    .replace(/\s+/g, ' ')
    .trim();

  const offers = catalog.offers.map((offer) => {
    const types = Array.isArray(offer.types) && offer.types.length
      ? [...new Set(offer.types)]
      : [offer.type];

    return {
      ...offer,
      types,
      searchText: normalize([
        ...types,
        offer.typeRaw,
        offer.district,
        offer.districtRaw,
        offer.complex,
        offer.complexRaw,
        offer.room,
        offer.title
      ].join(' '))
    };
  });

  function loadInactiveOfferIds() {
    try {
      const stored = JSON.parse(localStorage.getItem(INACTIVE_STORAGE_KEY) || '[]');
      const ids = Array.isArray(stored) ? stored : stored.offerIds;
      return new Set(Array.isArray(ids) ? ids.filter((id) => typeof id === 'string') : []);
    } catch (error) {
      return new Set();
    }
  }

  const inactiveOfferIds = loadInactiveOfferIds();
  const currentOfferIds = new Set(offers.map((offer) => offer.id));
  const hadRemovedOffers = [...inactiveOfferIds].some((id) => !currentOfferIds.has(id));
  [...inactiveOfferIds].forEach((id) => {
    if (!currentOfferIds.has(id)) inactiveOfferIds.delete(id);
  });

  function persistInactiveOfferIds() {
    try {
      localStorage.setItem(INACTIVE_STORAGE_KEY, JSON.stringify({
        version: 1,
        savedAt: new Date().toISOString(),
        offerIds: [...inactiveOfferIds]
      }));
      return true;
    } catch (error) {
      return false;
    }
  }

  if (hadRemovedOffers) persistInactiveOfferIds();

  function showToast(message, isError) {
    clearTimeout(toastTimer);
    elements.toast.textContent = message;
    elements.toast.classList.toggle('is-error', Boolean(isError));
    elements.toast.hidden = false;
    toastTimer = setTimeout(() => {
      elements.toast.hidden = true;
    }, 3600);
  }

  function isInactive(offer) {
    return inactiveOfferIds.has(offer.id);
  }

  function isInCurrentStatusView(offer) {
    return state.statusView === 'inactive' ? isInactive(offer) : !isInactive(offer);
  }

  const uniqueSorted = (key) => [...new Set(offers.map((offer) => offer[key]))]
    .sort((a, b) => a.localeCompare(b, 'ru'));

  const filterValues = {
    type: [...new Set(offers.flatMap((offer) => offer.types))]
      .sort((a, b) => TYPE_ORDER.indexOf(a) - TYPE_ORDER.indexOf(b)),
    room: [...new Set(offers.map((offer) => offer.roomCode))]
      .sort((a, b) => ROOM_ORDER.indexOf(a) - ROOM_ORDER.indexOf(b)),
    district: uniqueSorted('district'),
    complex: uniqueSorted('complex')
  };

  function plural(number, forms) {
    const abs = Math.abs(number) % 100;
    const last = abs % 10;
    if (abs > 10 && abs < 20) return forms[2];
    if (last === 1) return forms[0];
    if (last > 1 && last < 5) return forms[1];
    return forms[2];
  }

  function complexTitle(name) {
    return /^ЖК\s/i.test(name) ? name : `ЖК ${name}`;
  }

  function matchesFilters(offer, except) {
    if (state.search && !offer.searchText.includes(normalize(state.search))) return false;
    if (except !== 'type' && state.type.size && !offer.types.some((type) => state.type.has(type))) return false;
    if (except !== 'room' && state.room.size && !state.room.has(offer.roomCode)) return false;
    if (except !== 'district' && state.district.size && !state.district.has(offer.district)) return false;
    if (except !== 'complex' && state.complex.size && !state.complex.has(offer.complex)) return false;
    return true;
  }

  function getOptionCount(filter, value) {
    const offerKey = filter === 'room' ? 'roomCode' : filter;
    return offers.reduce((count, offer) => {
      const hasValue = filter === 'type' ? offer.types.includes(value) : offer[offerKey] === value;
      return count + (isInCurrentStatusView(offer) && matchesFilters(offer, filter) && hasValue ? 1 : 0);
    }, 0);
  }

  function sortOffers(items) {
    const roomRank = (offer) => ROOM_ORDER.indexOf(offer.roomCode);
    return [...items].sort((a, b) => {
      let result = 0;
      if (state.sort === 'district') result = a.district.localeCompare(b.district, 'ru');
      if (state.sort === 'room') result = roomRank(a) - roomRank(b);
      if (state.sort === 'type') result = TYPE_ORDER.indexOf(a.type) - TYPE_ORDER.indexOf(b.type);
      if (state.sort === 'complex') result = a.complex.localeCompare(b.complex, 'ru');
      return result || a.complex.localeCompare(b.complex, 'ru') || a.title.localeCompare(b.title, 'ru');
    });
  }

  function svg(path, className) {
    const namespace = 'http://www.w3.org/2000/svg';
    const icon = document.createElementNS(namespace, 'svg');
    icon.setAttribute('viewBox', '0 0 24 24');
    icon.setAttribute('aria-hidden', 'true');
    if (className) icon.setAttribute('class', className);
    path.split('|').forEach((pathData) => {
      const node = document.createElementNS(namespace, 'path');
      node.setAttribute('d', pathData);
      icon.append(node);
    });
    return icon;
  }

  function renderTypeOptions() {
    elements.typeOptions.replaceChildren();
    filterValues.type.forEach((value) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'type-option';
      button.dataset.value = value;
      button.setAttribute('aria-pressed', String(state.type.has(value)));
      button.style.setProperty('--type-color', TYPE_COLORS[value] || '#4c2b91');

      const dot = document.createElement('span');
      dot.className = 'type-option-dot';
      dot.setAttribute('aria-hidden', 'true');
      const label = document.createElement('span');
      label.className = 'type-option-label';
      label.textContent = value;
      const count = document.createElement('span');
      count.className = 'option-count';
      count.textContent = getOptionCount('type', value);

      const optionCount = Number(count.textContent);
      button.disabled = optionCount === 0 && !state.type.has(value);
      button.append(dot, label, count);
      elements.typeOptions.append(button);
    });
  }

  function renderRoomOptions() {
    elements.roomOptions.replaceChildren();
    filterValues.room.forEach((value) => {
      const matchingOffer = offers.find((offer) => offer.roomCode === value);
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'room-option';
      button.dataset.value = value;
      button.textContent = ROOM_SHORT[value] || value;
      button.title = matchingOffer ? matchingOffer.room : value;
      button.setAttribute('aria-label', matchingOffer ? matchingOffer.room : value);
      button.setAttribute('aria-pressed', String(state.room.has(value)));
      const count = getOptionCount('room', value);
      button.disabled = count === 0 && !state.room.has(value);
      elements.roomOptions.append(button);
    });
  }

  function renderDropdown(filter) {
    const dropdown = document.querySelector(`.filter-dropdown[data-filter="${filter}"]`);
    const optionsContainer = dropdown.querySelector('.dropdown-options');
    const searchInput = dropdown.querySelector('.dropdown-search input');
    const searchTerm = normalize(searchInput.value);
    const selected = state[filter];
    const labels = filter === 'district'
      ? { all: 'Все районы', selected: 'района', selectedMany: 'районов' }
      : { all: 'Все ЖК', selected: 'ЖК', selectedMany: 'ЖК' };

    const valueElement = dropdown.querySelector('.dropdown-value');
    if (selected.size === 0) valueElement.textContent = labels.all;
    else if (selected.size === 1) valueElement.textContent = [...selected][0];
    else valueElement.textContent = `${selected.size} ${selected.size < 5 ? labels.selected : labels.selectedMany}`;

    optionsContainer.replaceChildren();
    const values = filterValues[filter].filter((value) => normalize(value).includes(searchTerm));

    values.forEach((value) => {
      const count = getOptionCount(filter, value);
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'dropdown-option';
      button.dataset.value = value;
      button.setAttribute('aria-pressed', String(selected.has(value)));
      button.disabled = count === 0 && !selected.has(value);

      const check = document.createElement('span');
      check.className = 'option-check';
      check.append(svg('m5 12 4 4L19 7'));
      const name = document.createElement('span');
      name.className = 'dropdown-option-name';
      name.textContent = value;
      const countElement = document.createElement('span');
      countElement.className = 'option-count';
      countElement.textContent = count;
      button.append(check, name, countElement);
      optionsContainer.append(button);
    });

    if (!values.length) {
      const empty = document.createElement('p');
      empty.className = 'dropdown-empty';
      empty.textContent = 'Ничего не найдено';
      optionsContainer.append(empty);
    }
  }

  function createOfferCard(offer, index) {
    const card = document.createElement('article');
    card.className = 'offer-card';
    card.dataset.offerId = offer.id;
    card.classList.toggle('is-inactive', isInactive(offer));

    const preview = document.createElement('button');
    preview.type = 'button';
    preview.className = 'offer-preview';
    preview.dataset.openOffer = offer.id;
    preview.setAttribute('aria-label', `Открыть оффер: ${complexTitle(offer.complex)}, ${offer.title}`);

    const image = document.createElement('img');
    image.src = offer.path;
    image.alt = `${complexTitle(offer.complex)} — ${offer.room}, ${offer.title}`;
    image.loading = index < 8 ? 'eager' : 'lazy';
    if (index < 4) image.fetchPriority = 'high';
    image.decoding = 'async';
    image.addEventListener('error', () => preview.classList.add('has-image-error'), { once: true });

    const error = document.createElement('span');
    error.className = 'image-error';
    error.textContent = 'Предпросмотр недоступен. Файл можно скачать.';

    const badge = document.createElement('span');
    badge.className = 'type-badge';
    const visibleType = TYPE_ORDER.find((type) => state.type.has(type) && offer.types.includes(type)) || offer.type;
    badge.textContent = visibleType;
    badge.style.setProperty('--type-color', TYPE_COLORS[visibleType] || '#4c2b91');

    const overlay = document.createElement('span');
    overlay.className = 'preview-overlay';
    const action = document.createElement('span');
    action.className = 'preview-action';
    action.append(svg('M2.8 12s3.2-5.2 9.2-5.2 9.2 5.2 9.2 5.2-3.2 5.2-9.2 5.2S2.8 12 2.8 12Z|M14.4 12a2.4 2.4 0 1 1-4.8 0 2.4 2.4 0 0 1 4.8 0Z'));
    action.append(document.createTextNode('Открыть'));
    overlay.append(action);
    preview.append(image, error, badge, overlay);

    const body = document.createElement('div');
    body.className = 'offer-card-body';
    const meta = document.createElement('div');
    meta.className = 'card-meta';
    const room = document.createElement('span');
    room.className = 'card-room';
    room.textContent = offer.room;
    const district = document.createElement('span');
    district.className = 'card-district';
    district.title = offer.district;
    district.textContent = offer.district;
    meta.append(room, district);

    const heading = document.createElement('h2');
    heading.textContent = complexTitle(offer.complex);
    heading.title = complexTitle(offer.complex);
    const offerName = document.createElement('p');
    offerName.className = 'offer-name';
    offerName.textContent = offer.title;

    const download = document.createElement('a');
    download.className = 'download-button';
    download.href = offer.path;
    download.download = offer.fileName;
    download.append(svg('M12 3v12m0 0 4-4m-4 4-4-4M5 20h14'));
    download.append(document.createTextNode('Скачать оффер'));
    download.setAttribute('aria-label', `Скачать оффер ${complexTitle(offer.complex)}: ${offer.title}`);

    const statusToggle = document.createElement('button');
    statusToggle.type = 'button';
    statusToggle.className = 'status-toggle-button';
    statusToggle.dataset.toggleOfferStatus = offer.id;
    statusToggle.classList.toggle('is-restore', isInactive(offer));
    statusToggle.textContent = isInactive(offer) ? 'Вернуть в актуальные' : 'Не актуально';
    statusToggle.setAttribute('aria-label', isInactive(offer)
      ? `Вернуть оффер ${complexTitle(offer.complex)} в актуальные`
      : `Пометить оффер ${complexTitle(offer.complex)} как неактуальный`);

    const actions = document.createElement('div');
    actions.className = 'card-actions';
    actions.append(download, statusToggle);

    body.append(meta, heading, offerName, actions);
    card.append(preview, body);
    return card;
  }

  function renderCards() {
    const visibleOffers = filteredOffers.slice(0, visibleCount);
    grid.replaceChildren(...visibleOffers.map(createOfferCard));
    elements.empty.hidden = filteredOffers.length !== 0;

    const hasMore = visibleOffers.length < filteredOffers.length;
    elements.loadMoreWrap.hidden = !hasMore;
    if (hasMore) {
      const remaining = filteredOffers.length - visibleOffers.length;
      elements.loadMore.textContent = `Показать ещё ${Math.min(PAGE_SIZE, remaining)}`;
      elements.loadMoreCaption.textContent = `Показано ${visibleOffers.length} из ${filteredOffers.length}`;
    }
  }

  function renderActiveFilters() {
    elements.activeFilters.replaceChildren();
    const groups = [
      ['type', state.type, (value) => value],
      ['room', state.room, (value) => offers.find((offer) => offer.roomCode === value)?.room || value],
      ['district', state.district, (value) => value],
      ['complex', state.complex, (value) => complexTitle(value)]
    ];

    groups.forEach(([group, values, getLabel]) => {
      values.forEach((value) => {
        const chip = document.createElement('span');
        chip.className = 'active-chip';
        chip.append(document.createTextNode(getLabel(value)));
        const remove = document.createElement('button');
        remove.type = 'button';
        remove.dataset.removeGroup = group;
        remove.dataset.removeValue = value;
        remove.setAttribute('aria-label', `Убрать фильтр ${getLabel(value)}`);
        remove.append(svg('m7 7 10 10M17 7 7 17'));
        chip.append(remove);
        elements.activeFilters.append(chip);
      });
    });
  }

  function selectedFilterCount() {
    return state.type.size + state.room.size + state.district.size + state.complex.size;
  }

  function hasAnyFilters() {
    return Boolean(state.search.trim()) || selectedFilterCount() > 0;
  }

  function renderSummary() {
    const count = filteredOffers.length;
    const inactiveCount = inactiveOfferIds.size;
    const activeCount = offers.length - inactiveCount;
    const sectionLabel = state.statusView === 'inactive' ? 'Не актуально:' : 'Найдено';
    elements.resultsCount.textContent = `${sectionLabel} ${count} ${plural(count, ['оффер', 'оффера', 'офферов'])}`;
    elements.activeOffersCount.textContent = activeCount;
    elements.inactiveOffersCount.textContent = inactiveCount;
    elements.reset.disabled = !hasAnyFilters();

    document.querySelectorAll('[data-status-view]').forEach((button) => {
      const selected = button.dataset.statusView === state.statusView;
      button.classList.toggle('is-active', selected);
      button.setAttribute('aria-selected', String(selected));
    });

    if (!count && state.statusView === 'inactive' && !hasAnyFilters()) {
      elements.emptyTitle.textContent = 'Нет неактуальных офферов';
      elements.emptyDescription.textContent = 'Помеченные менеджерами офферы появятся в этом разделе.';
      elements.emptyReset.hidden = true;
    } else if (!count && state.statusView === 'active' && !hasAnyFilters()) {
      elements.emptyTitle.textContent = 'Все офферы помечены как неактуальные';
      elements.emptyDescription.textContent = 'Откройте раздел «Не актуально», чтобы вернуть нужные материалы.';
      elements.emptyReset.hidden = true;
    } else {
      elements.emptyTitle.textContent = 'Ничего не нашлось';
      elements.emptyDescription.textContent = 'Попробуйте изменить запрос или убрать часть фильтров.';
      elements.emptyReset.hidden = false;
    }

    const selected = selectedFilterCount();
    elements.mobileFilterCount.hidden = selected === 0;
    elements.mobileFilterCount.textContent = selected;
    elements.mobileApply.textContent = `Показать ${count} ${plural(count, ['оффер', 'оффера', 'офферов'])}`;
  }

  function renderAll() {
    filteredOffers = sortOffers(offers.filter((offer) => isInCurrentStatusView(offer) && matchesFilters(offer)));
    renderTypeOptions();
    renderRoomOptions();
    renderDropdown('district');
    renderDropdown('complex');
    renderActiveFilters();
    renderSummary();
    renderCards();
    renderCatalogMeta();
  }

  function toggleOfferStatus(id) {
    const offer = offers.find((item) => item.id === id);
    if (!offer) return;

    const markInactive = !isInactive(offer);
    if (markInactive) inactiveOfferIds.add(id);
    else inactiveOfferIds.delete(id);

    const saved = persistInactiveOfferIds();
    if (modalOfferId === id) closeModal();
    visibleCount = PAGE_SIZE;
    renderAll();

    const successMessage = markInactive
      ? 'Оффер перенесён в раздел «Не актуально».'
      : 'Оффер возвращён в актуальные.';
    showToast(saved ? successMessage : `${successMessage} Не удалось сохранить метку в браузере.`, !saved);
  }

  function toggleSetValue(set, value) {
    if (set.has(value)) set.delete(value);
    else set.add(value);
    visibleCount = PAGE_SIZE;
    renderAll();
  }

  function resetFilters() {
    state.search = '';
    state.type.clear();
    state.room.clear();
    state.district.clear();
    state.complex.clear();
    visibleCount = PAGE_SIZE;
    elements.search.value = '';
    document.querySelectorAll('.dropdown-search input').forEach((input) => { input.value = ''; });
    renderAll();
  }

  function closeDropdowns(except) {
    document.querySelectorAll('.filter-dropdown.is-open').forEach((dropdown) => {
      if (dropdown === except) return;
      dropdown.classList.remove('is-open');
      dropdown.querySelector('.dropdown-trigger').setAttribute('aria-expanded', 'false');
      dropdown.querySelector('.dropdown-panel').hidden = true;
    });
  }

  function openMobileFilters() {
    closeDropdowns();
    elements.filtersPanel.classList.add('is-mobile-open');
    elements.filterBackdrop.hidden = false;
    elements.mobileFilterOpen.setAttribute('aria-expanded', 'true');
    document.body.classList.add('filters-open');
    elements.mobileFilterClose.focus();
  }

  function closeMobileFilters() {
    closeDropdowns();
    elements.filtersPanel.classList.remove('is-mobile-open');
    elements.filterBackdrop.hidden = true;
    elements.mobileFilterOpen.setAttribute('aria-expanded', 'false');
    document.body.classList.remove('filters-open');
    elements.mobileFilterOpen.focus();
  }

  function updateModal() {
    const offer = filteredOffers.find((item) => item.id === modalOfferId);
    if (!offer) return;

    elements.modalImage.src = offer.path;
    elements.modalImage.alt = `${complexTitle(offer.complex)} — ${offer.room}, ${offer.title}`;
    const visibleType = TYPE_ORDER.find((type) => state.type.has(type) && offer.types.includes(type)) || offer.type;
    elements.modalType.textContent = visibleType;
    elements.modalType.style.setProperty('--type-color', TYPE_COLORS[visibleType] || '#4c2b91');
    elements.modalRoom.textContent = offer.room;
    elements.modalTitle.textContent = complexTitle(offer.complex);
    elements.modalOfferTitle.textContent = offer.title;
    elements.modalDistrict.textContent = `Район: ${offer.district}`;
    elements.modalStatusToggle.textContent = isInactive(offer) ? 'Вернуть в актуальные' : 'Пометить «Не актуально»';
    elements.modalStatusToggle.classList.toggle('is-restore', isInactive(offer));
    elements.modalStatusToggle.dataset.toggleOfferStatus = offer.id;
    elements.modalDownload.href = offer.path;
    elements.modalDownload.download = offer.fileName;

    const disableNavigation = filteredOffers.length < 2;
    elements.modalPrev.hidden = disableNavigation;
    elements.modalNext.hidden = disableNavigation;
  }

  function openModal(id, trigger) {
    modalOfferId = id;
    lastFocusedElement = trigger || document.activeElement;
    updateModal();
    elements.modal.hidden = false;
    elements.modal.setAttribute('aria-hidden', 'false');
    document.body.classList.add('modal-open');
    elements.modal.querySelector('.modal-close').focus();
  }

  function closeModal() {
    elements.modal.hidden = true;
    elements.modal.setAttribute('aria-hidden', 'true');
    document.body.classList.remove('modal-open');
    elements.modalImage.removeAttribute('src');
    modalOfferId = null;
    if (lastFocusedElement && document.contains(lastFocusedElement)) lastFocusedElement.focus();
  }

  function navigateModal(direction) {
    if (!modalOfferId || filteredOffers.length < 2) return;
    const currentIndex = filteredOffers.findIndex((offer) => offer.id === modalOfferId);
    const nextIndex = (currentIndex + direction + filteredOffers.length) % filteredOffers.length;
    modalOfferId = filteredOffers[nextIndex].id;
    updateModal();
  }

  elements.typeOptions.addEventListener('click', (event) => {
    const option = event.target.closest('.type-option');
    if (option && !option.disabled) toggleSetValue(state.type, option.dataset.value);
  });

  elements.roomOptions.addEventListener('click', (event) => {
    const option = event.target.closest('.room-option');
    if (option && !option.disabled) toggleSetValue(state.room, option.dataset.value);
  });

  document.querySelectorAll('.filter-dropdown').forEach((dropdown) => {
    const filter = dropdown.dataset.filter;
    const trigger = dropdown.querySelector('.dropdown-trigger');
    const panel = dropdown.querySelector('.dropdown-panel');
    const searchInput = dropdown.querySelector('.dropdown-search input');

    trigger.addEventListener('click', (event) => {
      event.stopPropagation();
      const willOpen = !dropdown.classList.contains('is-open');
      closeDropdowns(dropdown);
      dropdown.classList.toggle('is-open', willOpen);
      trigger.setAttribute('aria-expanded', String(willOpen));
      panel.hidden = !willOpen;
      if (willOpen) setTimeout(() => searchInput.focus(), 0);
    });

    panel.addEventListener('click', (event) => {
      event.stopPropagation();
      const option = event.target.closest('.dropdown-option');
      if (option && !option.disabled) toggleSetValue(state[filter], option.dataset.value);
    });

    searchInput.addEventListener('input', () => renderDropdown(filter));
  });

  elements.search.addEventListener('input', () => {
    state.search = elements.search.value;
    visibleCount = PAGE_SIZE;
    renderAll();
  });

  elements.sort.addEventListener('change', () => {
    state.sort = elements.sort.value;
    visibleCount = PAGE_SIZE;
    renderAll();
  });

  document.querySelector('.status-tabs').addEventListener('click', (event) => {
    const button = event.target.closest('[data-status-view]');
    if (!button || button.dataset.statusView === state.statusView) return;
    state.statusView = button.dataset.statusView;
    visibleCount = PAGE_SIZE;
    renderAll();
  });

  elements.activeFilters.addEventListener('click', (event) => {
    const button = event.target.closest('[data-remove-group]');
    if (!button) return;
    state[button.dataset.removeGroup].delete(button.dataset.removeValue);
    visibleCount = PAGE_SIZE;
    renderAll();
  });

  elements.reset.addEventListener('click', resetFilters);
  elements.emptyReset.addEventListener('click', resetFilters);
  elements.loadMore.addEventListener('click', () => {
    visibleCount += PAGE_SIZE;
    renderCards();
  });

  grid.addEventListener('click', (event) => {
    const statusToggle = event.target.closest('[data-toggle-offer-status]');
    if (statusToggle) {
      toggleOfferStatus(statusToggle.dataset.toggleOfferStatus);
      return;
    }
    const preview = event.target.closest('[data-open-offer]');
    if (preview) openModal(preview.dataset.openOffer, preview);
  });

  elements.mobileFilterOpen.addEventListener('click', openMobileFilters);
  elements.mobileFilterClose.addEventListener('click', closeMobileFilters);
  elements.filterBackdrop.addEventListener('click', closeMobileFilters);
  elements.mobileApply.addEventListener('click', closeMobileFilters);

  elements.modal.querySelectorAll('[data-close-modal]').forEach((element) => {
    element.addEventListener('click', closeModal);
  });
  elements.modalPrev.addEventListener('click', () => navigateModal(-1));
  elements.modalNext.addEventListener('click', () => navigateModal(1));
  elements.modalStatusToggle.addEventListener('click', () => {
    if (elements.modalStatusToggle.dataset.toggleOfferStatus) {
      toggleOfferStatus(elements.modalStatusToggle.dataset.toggleOfferStatus);
    }
  });

  document.addEventListener('click', () => closeDropdowns());
  document.addEventListener('keydown', (event) => {
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
      event.preventDefault();
      elements.search.focus();
      elements.search.select();
      return;
    }

    if (event.key === 'Escape') {
      if (!elements.modal.hidden) closeModal();
      else if (elements.filtersPanel.classList.contains('is-mobile-open')) closeMobileFilters();
      else closeDropdowns();
    }

    if (!elements.modal.hidden && event.key === 'ArrowLeft') navigateModal(-1);
    if (!elements.modal.hidden && event.key === 'ArrowRight') navigateModal(1);
  });

  function renderCatalogMeta() {
    const activeOffers = offers.filter((offer) => !isInactive(offer));
    const total = activeOffers.length;
    const complexes = new Set(activeOffers.map((offer) => offer.complex)).size;
    document.getElementById('offers-total').textContent = total;
    document.getElementById('complexes-total').textContent = complexes;
    if (catalog.updatedAt) {
      const updated = new Date(`${catalog.updatedAt}T12:00:00`);
      const formatted = new Intl.DateTimeFormat('ru-RU', {
        day: 'numeric', month: 'long', year: 'numeric'
      }).format(updated);
      document.getElementById('catalog-updated').textContent = `Материалы обновлены ${formatted}`;
    }
  }

  renderAll();
}());
