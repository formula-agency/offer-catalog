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
    modalScout: document.getElementById('modal-scout'),
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

  const moneyFormatter = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 0 });
  const decimalFormatter = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 2 });

  function formatMoney(value) {
    const number = Number(value);
    return Number.isFinite(number) ? `${moneyFormatter.format(number)} ₽` : '—';
  }

  function formatArea(value) {
    const number = Number(value);
    return Number.isFinite(number) ? `${decimalFormatter.format(number)} м²` : '—';
  }

  function formatDate(value) {
    if (!value) return '—';
    const date = new Date(`${value}T00:00:00`);
    return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat('ru-RU').format(date);
  }

  function formatChange(value, suffix = ' ₽') {
    const number = Number(value);
    if (!Number.isFinite(number)) return '—';
    const sign = number > 0 ? '+' : '';
    const formatter = suffix === '%' ? decimalFormatter : moneyFormatter;
    return `${sign}${formatter.format(number)}${suffix}`;
  }

  function addDefinition(container, label, value, className = '') {
    if (value === undefined || value === null || value === '') return;
    const item = document.createElement('div');
    item.className = `scout-fact${className ? ` ${className}` : ''}`;
    const term = document.createElement('dt');
    term.textContent = label;
    const description = document.createElement('dd');
    description.textContent = value;
    item.append(term, description);
    container.append(item);
  }

  function scoutFloorLabel(scout) {
    if (scout.floor === undefined || scout.floor === null || scout.floor === '') return null;
    return scout.total_floors ? `${scout.floor} из ${scout.total_floors}` : String(scout.floor);
  }

  function safeExternalUrl(value) {
    try {
      const url = new URL(value);
      return ['https:', 'http:'].includes(url.protocol) ? url.href : '';
    } catch (error) {
      return '';
    }
  }

  function parseIsoDate(value) {
    if (typeof value !== 'string') return null;
    const match = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!match) return null;
    const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
    return Number.isNaN(date.getTime()) ? null : date;
  }

  function isoDate(date) {
    return date.toISOString().slice(0, 10);
  }

  function twoYearPriceWindow(history) {
    const end = new Date();
    end.setUTCHours(0, 0, 0, 0);
    const cutoff = new Date(end);
    cutoff.setUTCFullYear(cutoff.getUTCFullYear() - 2);

    const valid = history
      .map((point) => ({ ...point, date: parseIsoDate(point.effective_from), price: Number(point.price_rub) }))
      .filter((point) => point.date && Number.isFinite(point.price) && point.price > 0 && point.date <= end)
      .sort((left, right) => left.date - right.date);

    const beforeCutoff = valid.filter((point) => point.date < cutoff).at(-1);
    const points = valid.filter((point) => point.date >= cutoff);
    if (beforeCutoff) {
      points.unshift({
        ...beforeCutoff,
        effective_from: isoDate(cutoff),
        date: new Date(cutoff),
        isWindowBaseline: true
      });
    }

    const compact = points.filter((point, index) => index === 0 || point.price !== points[index - 1].price);
    return {
      cutoff,
      end,
      points: compact,
      changes: Math.max(0, compact.length - 1)
    };
  }

  function svgElement(name, attributes = {}) {
    const element = document.createElementNS('http://www.w3.org/2000/svg', name);
    Object.entries(attributes).forEach(([key, value]) => element.setAttribute(key, value));
    return element;
  }

  function formatChartMoney(value) {
    return `${decimalFormatter.format(value / 1000000)} млн`;
  }

  function createPriceChart(priceWindow) {
    if (!priceWindow.points.length) return null;

    const figure = document.createElement('figure');
    figure.className = 'scout-price-chart';
    const caption = document.createElement('figcaption');
    const captionTitle = document.createElement('strong');
    captionTitle.textContent = 'Динамика цены за 2 года';
    const captionMeta = document.createElement('span');
    captionMeta.textContent = `${priceWindow.changes} ${priceWindow.changes === 1 ? 'изменение' : priceWindow.changes < 5 ? 'изменения' : 'изменений'}`;
    caption.append(captionTitle, captionMeta);

    const width = 720;
    const height = 250;
    const padding = { top: 24, right: 18, bottom: 34, left: 82 };
    const plotWidth = width - padding.left - padding.right;
    const plotHeight = height - padding.top - padding.bottom;
    const prices = priceWindow.points.map((point) => point.price);
    let minPrice = Math.min(...prices);
    let maxPrice = Math.max(...prices);
    const pricePadding = Math.max((maxPrice - minPrice) * 0.16, maxPrice * 0.025, 100000);
    minPrice = Math.max(0, minPrice - pricePadding);
    maxPrice += pricePadding;
    const timeSpan = Math.max(1, priceWindow.end - priceWindow.cutoff);
    const x = (date) => padding.left + ((date - priceWindow.cutoff) / timeSpan) * plotWidth;
    const y = (price) => padding.top + ((maxPrice - price) / (maxPrice - minPrice)) * plotHeight;

    const chart = svgElement('svg', {
      viewBox: `0 0 ${width} ${height}`,
      role: 'img',
      'aria-label': `График изменения цены с ${formatDate(isoDate(priceWindow.cutoff))} по ${formatDate(isoDate(priceWindow.end))}`
    });

    for (let index = 0; index < 4; index += 1) {
      const ratio = index / 3;
      const gridY = padding.top + plotHeight * ratio;
      const value = maxPrice - (maxPrice - minPrice) * ratio;
      chart.append(svgElement('line', {
        x1: padding.left,
        y1: gridY,
        x2: width - padding.right,
        y2: gridY,
        class: 'price-chart-grid'
      }));
      const label = svgElement('text', {
        x: padding.left - 10,
        y: gridY + 4,
        class: 'price-chart-y-label',
        'text-anchor': 'end'
      });
      label.textContent = formatChartMoney(value);
      chart.append(label);
    }

    let pathData = '';
    priceWindow.points.forEach((point, index) => {
      const pointX = x(point.date);
      const pointY = y(point.price);
      if (index === 0) {
        pathData = `M ${pointX} ${pointY}`;
      } else {
        pathData += ` H ${pointX} V ${pointY}`;
      }
    });
    pathData += ` H ${x(priceWindow.end)}`;
    chart.append(svgElement('path', { d: pathData, class: 'price-chart-line' }));

    priceWindow.points.forEach((point) => {
      const dot = svgElement('circle', {
        cx: x(point.date),
        cy: y(point.price),
        r: point.isWindowBaseline ? 4 : 5,
        class: `price-chart-dot${point.isWindowBaseline ? ' is-baseline' : ''}`
      });
      const tooltip = svgElement('title');
      tooltip.textContent = `${formatDate(point.effective_from)} — ${formatMoney(point.price)}`;
      dot.append(tooltip);
      chart.append(dot);
    });

    const startLabel = svgElement('text', {
      x: padding.left,
      y: height - 9,
      class: 'price-chart-x-label',
      'text-anchor': 'start'
    });
    startLabel.textContent = formatDate(isoDate(priceWindow.cutoff));
    const endLabel = svgElement('text', {
      x: width - padding.right,
      y: height - 9,
      class: 'price-chart-x-label',
      'text-anchor': 'end'
    });
    endLabel.textContent = formatDate(isoDate(priceWindow.end));
    chart.append(startLabel, endLabel);
    figure.append(caption, chart);
    return figure;
  }

  function renderScoutDetails(offer) {
    const container = elements.modalScout;
    container.replaceChildren();

    if (!offer.scout) {
      container.className = 'scout-details is-empty';
      const title = document.createElement('strong');
      title.textContent = 'Данные Scout не найдены';
      const message = document.createElement('p');
      message.textContent = offer.areaSqm
        ? `Площадь ${formatArea(offer.areaSqm)} подтверждена. Проект или квартира с указанной площадью не найдены в Scout ни в официальных источниках, ни в агрегаторах.`
        : 'На макете не удалось уверенно определить общую площадь для автоматического поиска.';
      container.append(title, message);
      return;
    }

    container.className = 'scout-details';
    const scout = offer.scout;
    const head = document.createElement('div');
    head.className = 'scout-head';
    const titleWrap = document.createElement('div');
    const eyebrow = document.createElement('span');
    eyebrow.className = 'scout-eyebrow';
    const sourceType = scout.price_source && scout.price_source.type;
    eyebrow.textContent = `Scout · ${sourceType === 'Агрегатор' ? 'агрегатор' : 'официальный источник'}`;
    const title = document.createElement('h3');
    title.textContent = 'Параметры квартиры';
    titleWrap.append(eyebrow, title);
    const price = document.createElement('strong');
    price.className = 'scout-main-price';
    price.textContent = formatMoney(scout.current_price_rub);
    head.append(titleWrap, price);

    const facts = document.createElement('dl');
    facts.className = 'scout-facts';
    const floor = scoutFloorLabel(scout);
    addDefinition(facts, 'Этаж', floor);
    addDefinition(facts, 'Площадь', formatArea(scout.area_sqm));
    addDefinition(facts, 'Цена за м²', formatMoney(scout.current_price_per_sqm_rub));
    addDefinition(facts, 'Секция', scout.section);
    addDefinition(facts, 'Комнатность Scout', scout.rooms_real);
    addDefinition(facts, 'В экспозиции с', formatDate(scout.first_seen_date));
    addDefinition(facts, 'Данные на', formatDate(String(scout.data_as_of || '').slice(0, 10)));

    const history = Array.isArray(scout.price_history) ? scout.price_history : [];
    const priceWindow = twoYearPriceWindow(history);
    if (priceWindow.points.length) {
      addDefinition(facts, 'Цена в начале периода', formatMoney(priceWindow.points[0].price));
    }

    container.append(head, facts);

    if (scout.house) {
      const house = document.createElement('p');
      house.className = 'scout-house';
      house.textContent = scout.house;
      container.append(house);
    }

    if (priceWindow.points.length) {
      const firstPrice = priceWindow.points[0].price;
      const lastPrice = priceWindow.points.at(-1).price;
      const change = lastPrice - firstPrice;
      const trend = document.createElement('div');
      trend.className = `scout-trend ${change < 0 ? 'is-down' : change > 0 ? 'is-up' : 'is-flat'}`;
      const trendLabel = document.createElement('span');
      trendLabel.textContent = 'Изменение за последние 2 года';
      const trendValue = document.createElement('strong');
      const percent = firstPrice > 0 ? (lastPrice / firstPrice - 1) * 100 : null;
      trendValue.textContent = `${formatChange(change)}${Number.isFinite(percent) ? ` · ${formatChange(percent, '%')}` : ''}`;
      trend.append(trendLabel, trendValue);
      container.append(trend);
    }

    const chart = createPriceChart(priceWindow);
    if (chart) container.append(chart);

    const sourceUrl = safeExternalUrl(scout.price_source && scout.price_source.url);
    if (sourceUrl) {
      const source = document.createElement('a');
      source.className = 'scout-source-link';
      source.href = sourceUrl;
      source.target = '_blank';
      source.rel = 'noopener noreferrer';
      source.textContent = 'Открыть квартиру в источнике';
      source.append(svg('m9 15 6-6|M10 8h6v6|M14 13v5H6V10h5'));
      container.append(source);
    }

    if (priceWindow.points.length) {
      const details = document.createElement('details');
      details.className = 'scout-history';
      const summary = document.createElement('summary');
      const pointCount = priceWindow.points.length;
      summary.textContent = `История за 2 года · ${pointCount} ${pointCount === 1 ? 'точка' : pointCount < 5 ? 'точки' : 'точек'}`;
      const list = document.createElement('ol');
      priceWindow.points.forEach((point, index) => {
        const item = document.createElement('li');
        const date = document.createElement('time');
        date.dateTime = point.effective_from || '';
        date.textContent = formatDate(point.effective_from);
        const pointPrice = document.createElement('strong');
        pointPrice.textContent = formatMoney(point.price_rub);
        const pointChange = document.createElement('span');
        const previous = priceWindow.points[index - 1];
        pointChange.textContent = point.isWindowBaseline
          ? 'Цена на начало двухлетнего периода'
          : previous
            ? `К предыдущей: ${formatChange(point.price - previous.price)}`
            : 'Первая цена в двухлетнем периоде';
        item.append(date, pointPrice, pointChange);
        list.append(item);
      });
      details.append(summary, list);
      container.append(details);
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

    body.append(meta, heading, offerName);
    body.append(actions);
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
    renderScoutDetails(offer);
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
