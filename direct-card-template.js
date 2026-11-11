/* One SVG master for screen and PNG export. Edit branding here, not in domain rules. */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.CatalogCard = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, ch => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&apos;' }[ch]));
  function wrap(value, max = 43) {
    const lines = []; let line = '';
    for (const word of String(value || '').split(/\s+/)) {
      if (line && (line + ' ' + word).length > max) { lines.push(line); line = ''; }
      // Long source tokens (URLs etc.) must not overflow the master.
      for (let i = 0; i < word.length; i += max) {
        const part = word.slice(i, i + max);
        if (i || (line && line.length + part.length + 1 > max)) { if (line) lines.push(line); line = ''; }
        line += (line ? ' ' : '') + part;
      }
    }
    if (line) lines.push(line);
    return lines;
  }
  function svg(model) {
    const t = [];
    function text(x, y, value, size = 22, color = '#261346', weight = 400) {
      t.push(`<text x="${x}" y="${y}" fill="${color}" font-size="${size}" font-weight="${weight}">${esc(value)}</text>`);
    }
    function lines(x, y, value, size, max, color, weight) {
      for (const line of wrap(value, max)) { text(x, y, line, size, color, weight); y += size * 1.38; }
      return y;
    }
    t.push('<rect width="720" height="100%" fill="#fcfaf7"/><path d="M470 0H720V280C620 230 590 65 470 0" fill="#f2e9ff"/><circle cx="711" cy="58" r="135" fill="none" stroke="#ff8b4c" stroke-width="2"/>');
    text(38, 48, 'КАТАЛОГ ОФФЕРОВ', 22, '#261346', 800);
    text(38, 124, model.program.toLocaleUpperCase('ru-RU'), 16, '#774c9e', 700);
    let y = lines(38, 176, model.project, 37, 29, '#261346', 800);
    y = lines(38, y + 3, model.apartment, 24, 43, '#65576e', 500) + 23;
    const plan = model.offerImage || model.floorplan;
    if (plan?.status === 'available') {
      const original=plan.kind==='original_offer';
      text(38, y - 4, original?'ИЗОБРАЖЕНИЕ ОФФЕРА':'ПЛАНИРОВКА ИЗ ИСТОЧНИКА', 11, '#786986', 600);
      const top = y + 12;
      const imageHeight=original?Math.min(1400,Math.max(368,Math.round(628*plan.height/plan.width))):368;
      t.push(`<rect x="30" y="${top}" width="660" height="${imageHeight+24}" rx="16" fill="#ffffff" stroke="#e8e0ed"/>`);
      // The PNG is an exact source crop. Contain preserves its proportions and every wall/dimension.
      t.push(`<image x="46" y="${top + 12}" width="628" height="${imageHeight}" preserveAspectRatio="xMidYMid meet" href="${esc(plan.dataUri)}"/>`);
      y = top + imageHeight + 24 + 35;
    } else {
      const note = plan?.note || 'Исходное изображение недоступно';
      const placeholderHeight = Math.max(120, 65 + wrap(note, 60).length * 23);
      t.push(`<rect x="30" y="${y}" width="660" height="${placeholderHeight}" rx="16" fill="#f4eff8" stroke="#e2d7eb" stroke-dasharray="5 5"/>`);
      text(52, y + 34, 'ИЗОБРАЖЕНИЕ НЕ ДОБАВЛЕНО', 14, '#8a6a9e', 700);
      lines(52, y + 62, note, 16, 60, '#8a7895', 400);
      y += placeholderHeight + 34;
    }
    t.push(`<rect x="30" y="${y - 16}" width="660" height="116" rx="18" fill="#2f1750"/>`);
    const hasPayment=model.payment!=='Не указан';
    text(52, y + 14, hasPayment?'ЕЖЕМЕСЯЧНЫЙ ПЛАТЁЖ':'СТОИМОСТЬ КВАРТИРЫ', 12, '#d7c5ed', 600);
    text(52, y + 60, hasPayment?model.payment:model.price, 37, '#ffffff', 800);
    y += 138;
    if (model.paymentPeriod) y = lines(38, y - 9, 'Период платежа: ' + model.paymentPeriod, 18, 58, '#a74d21', 600) + 8;
    if(model.downPayment!=='Не указан') {
      text(38, y, 'СВОИ СРЕДСТВА / ПВ КЛИЕНТА', 12, '#786986', 600);
      text(38, y + 37, model.downPayment, 29, '#261346', 700);y += 86;
    }
    if(hasPayment && model.price!=='Не указан') {
      text(38, y, 'СТОИМОСТЬ КВАРТИРЫ', 12, '#786986', 600);
      text(38, y + 36, model.price, 29, '#261346', 700);y += 74;
    }
    const details = [...(model.offerLabels||[]), model.financing, model.rate ? 'Ставка: ' + model.rate : null, model.term ? 'Полный срок: ' + model.term : null, model.finishing,
      model.compensation ? 'Компенсация ПВ: ' + model.compensation : null,
      ...model.stages.map(g => 'Этап: ' + g), ...model.conditions];
    for (const d of details.filter(Boolean)) y = lines(38, y, d, 17, 61, '#65576e', 400) + 6;
    y += 15;
    t.push(`<path d="M38 ${y}H682" stroke="#e4dce8"/>`); y += 30;
    y = lines(38, y, `Публикация: ${model.publishedAt}${model.validUntil ? ' · До: ' + model.validUntil : ''}`, 13, 79, '#786986', 400);
    y = lines(38, y + 4, `Вариант ${model.optionNumber} из ${model.totalOptions}`, 13, 79, '#786986', 400);
    y = lines(38, y + 6, 'Наличие квартиры и условия необходимо подтвердить. Суммы «от» — рекламный порог.', 13, 79, '#786986', 400);
    return `<svg xmlns="http://www.w3.org/2000/svg" width="720" height="${Math.ceil(y + 42)}" viewBox="0 0 720 ${Math.ceil(y + 42)}" font-family="Arial, sans-serif" role="img" aria-label="${esc(model.project + ', ' + model.apartment)}">${t.join('')}</svg>`;
  }
  return { svg, wrap };
});
