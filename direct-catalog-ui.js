(function () {
  'use strict';
  if (!window.DIRECT_OFFERS_CATALOG) return;
  const D = window.DirectCatalog;
  const filters = {};
  const selected = new Map();
  const comparisonChildren=new Map();
  const scoutSelected=new Map();
  let readTypes = () => new Set();
  const dateFormatter=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Yekaterinburg',year:'numeric',month:'2-digit',day:'2-digit'});
  const today = () => dateFormatter.format(new Date());
  const currentFilters = () => ({...filters,period:filters.period || 'twoMonths',asOf:today(),types:readTypes()});
  function setPeriods(values){if(values.length)filters.period=values;else delete filters.period;}
  const option = offer => D.selectedOption(offer,currentFilters(),selected.get(offer.id));
  const resolvedImages = new Map();
  function imagePath(offer) {
    const path=window.DIRECT_RESTYLED_IMAGES?.images?.[offer.path]?.path || offer.path;
    const embedded=window.DIRECT_EMBEDDED_MEDIA?.[path];
    if (!embedded) return path;
    if (!resolvedImages.has(path)) {
      const content=document.getElementById(embedded.id);
      if (!content) throw Error('Embedded image is missing');
      resolvedImages.set(path,`data:${embedded.mime};base64,${content.textContent.trim()}`);
    }
    return resolvedImages.get(path);
  }
  const el = (tag, text, className) => {
    const node = document.createElement(tag);
    if (text != null) node.textContent = text;
    if (className) node.className = className;
    return node;
  };
  function selectControl(label, entries, key, onChange) {
    const wrapper = el('label',null,'direct-filter');
    wrapper.append(el('span',label));
    const select = el('select');
    select.dataset.directFilter = key;
    select.append(...entries.map(([value,text]) => {
      const node = el('option',text);node.value=value;return node;
    }));
    select.addEventListener('change',()=>{filters[key]=select.value || undefined;if(key==='program'){const child=document.querySelector('[data-direct-filter="childrenCount"]');if(child){child.disabled=!!select.value&&select.value!=='Семейная';if(child.disabled){child.value='';delete filters.childrenCount;}}}onChange();});
    wrapper.append(select);return wrapper;
  }
  function attachControls(onChange, types) {
    readTypes=types;
    const section=el('section',null,'filter-section direct-filters');
    section.setAttribute('aria-label','Условия покупки');
    section.append(el('h3','Условия покупки'));
    const programs=[...new Set(window.DIRECT_OFFERS_CATALOG.offers.flatMap(o=>D.enrich(o,window.DIRECT_OFFERS_CATALOG.mortgageTerms).purchaseOptions.map(p=>D.programLabel(p.program))))].filter(p=>p && !['Не указана','Не указан','unknown'].includes(p)).sort();
    section.append(selectControl('Программа',[['','Любая'],...programs.map(p=>[p,p==='Стандартная'?'Новостройка':p])],'program',onChange));
    section.append(selectControl('Схема покупки',[['','Любая'],['mortgage','Ипотека'],['installment','Рассрочка'],['tranche','Траншевая ипотека'],['cash','Полная оплата']],'financing',onChange));
    section.append(selectControl('Количество детей',[['','Любое'],['1','1 ребёнок'],['2','2 детей'],['3','3 детей'],['4','4 детей'],['5','5 и более детей']],'childrenCount',onChange));
    section.append(selectControl('Первоначальный взнос',[['','Любой'],['zero','Без ПВ'],['chplv','ЧПВ / компенсация ПВ'],['full','Полный ПВ']],'downPaymentType',onChange));
    section.append(selectControl('Отделка',[['','Любая'],['finished','С отделкой'],['unfinished','Без отделки'],['pre-finish','Предчистовая']],'finishing',onChange));
    for(const [label,minKey,maxKey] of [['Платёж в месяц, ₽','paymentMin','paymentMax'],['ПВ клиента, ₽','downMin','downMax'],['Площадь, м²','areaMin','areaMax']]) {
      const group=el('fieldset',null,'direct-range');group.append(el('legend',label));
      for(const [key,caption] of [[minKey,'От'],[maxKey,'До']]) {
        const input=el('input');input.type='number';input.min='0';input.step='any';input.inputMode='decimal';
        input.placeholder=caption;input.setAttribute('aria-label',`${label}: ${caption.toLowerCase()}`);input.dataset.directFilter=key;
        input.addEventListener('input',()=>{filters[key]=input.value===''?undefined:Number(input.value);onChange();});
        group.append(input);
      }
      section.append(group);
    }
    const headingNode=document.querySelector('.filters-heading');
    const complex=document.querySelector('[data-filter="complex"]').closest('.filter-section');
    const district=document.querySelector('[data-filter="district"]').closest('.filter-section');
    const rooms=document.getElementById('room-options').closest('.filter-section');
    const purchaseType=el('section',null,'filter-section direct-purchase-type');
    purchaseType.append(el('h3','Тип покупки'),section.querySelector('[data-direct-filter="financing"]').closest('label'));
    headingNode.after(section,rooms,purchaseType,district,complex);
    const checkLabel=el('label',null,'direct-image-filter'),check=el('input');check.type='checkbox';check.dataset.directFilter='withImage';check.addEventListener('change',()=>{filters.withImage=check.checked || undefined;onChange();});checkLabel.append(check,el('span','Только с изображением'));section.append(checkLabel);
    // Keep budget and PV visible; secondary criteria remain available below them.
    const advanced=el('details',null,'direct-advanced');advanced.append(el('summary','Дополнительные параметры'));
    advanced.append(section.querySelector('[data-direct-filter="finishing"]').closest('label'));
    advanced.append(section.querySelector('[data-direct-filter="areaMin"]').closest('fieldset'),checkLabel);
    const program=section.querySelector('[data-direct-filter="program"]').closest('label');
    const children=section.querySelector('[data-direct-filter="childrenCount"]').closest('label');
    const downType=section.querySelector('[data-direct-filter="downPaymentType"]').closest('label');
    section.append(program,children,downType);
    const extraSection=el('section',null,'filter-section direct-extra-filters');extraSection.append(advanced);complex.after(extraSection);
    const rangeError=el('p',null,'direct-status');rangeError.id='direct-filter-error';rangeError.setAttribute('role','alert');rangeError.hidden=true;section.append(rangeError);
    document.body.classList.add('is-direct-catalog');
    document.querySelector('.status-tabs').hidden=true;
    document.querySelector('.status-storage-note').hidden=true;
    document.getElementById('type-options').closest('fieldset').hidden=true;
    document.querySelector('.hero-description').textContent='Найдите квартиру под ваш бюджет. Сравните условия покупки, выберите подходящий вариант и сохраните предложение.';
    document.querySelector('.eyebrow').textContent='Формула · недвижимость';
    const promotions=el('section',null,'promotions-panel');promotions.setAttribute('aria-label','Акции и подарки');
    const heading=el('div',null,'promotions-heading');heading.append(el('h2','Акции и подарки'));promotions.append(heading);
    const chips=el('div',null,'promotion-chips');
    for(const [key,label] of Object.entries(D.BENEFITS)) {
      if(key==='compensated')continue;
      const button=el('button',label,'promotion-chip');button.type='button';button.dataset.benefit=key;button.setAttribute('aria-pressed','false');
      button.addEventListener('click',()=>{const values=new Set(filters.benefits || []);if(values.has(key))values.delete(key);else values.add(key);filters.benefits=[...values];button.setAttribute('aria-pressed',String(values.has(key)));onChange();});chips.append(button);
    }
    promotions.append(chips);document.querySelector('.results-topline').before(promotions);
    const periods=el('section',null,'filter-section direct-periods');periods.setAttribute('aria-label','Дата публикации оффера');
    periods.append(el('h3','Дата публикации','period-heading'));
    const periodChips=el('div',null,'period-chips');
    for(const [key,label] of Object.entries(D.DATE_FILTERS)) {
      const button=el('button',label,'promotion-chip');button.type='button';button.dataset.period=key;button.setAttribute('aria-pressed','false');
      button.addEventListener('click',()=>{setPeriods(D.togglePeriod(filters.period,key));onChange();});periodChips.append(button);
    }
    periods.append(periodChips);headingNode.after(periods);
    // Fit the scrollable sidebar to its visible viewport even before it becomes sticky.
    const sidebar=headingNode.closest('.filters');
    let sidebarFrame=0;
    const fitSidebar=()=>{
      sidebarFrame=0;
      const top=Math.max(20,sidebar.getBoundingClientRect().top);
      sidebar.style.setProperty('--filter-available-height',`${Math.max(160,window.innerHeight-top-20)}px`);
    };
    const scheduleSidebar=()=>{if(!sidebarFrame)sidebarFrame=requestAnimationFrame(fitSidebar);};
    window.addEventListener('scroll',scheduleSidebar,{passive:true});
    window.addEventListener('resize',scheduleSidebar,{passive:true});
    new ResizeObserver(scheduleSidebar).observe(document.querySelector('.catalog-searchbar'));
    fitSidebar();
    let visibleDate=today();
    setInterval(()=>{const next=today();if(next!==visibleDate){visibleDate=next;onChange();}},60000);
    let revision=document.documentElement.dataset.catalogRevision || window.DIRECT_OFFERS_CATALOG.revision;
    if(!window.DIRECT_EMBEDDED_MEDIA && location.protocol!=='file:')setInterval(async()=>{try{const response=await fetch('catalog-meta.json',{cache:'no-store'});if(!response.ok)return;const next=await response.json();if(revision && next.revision!==revision && document.getElementById('offer-modal').hidden)location.reload();else if(!revision)revision=next.revision;}catch{}},60000);
    const panel=el('section',null,'direct-modal-options');panel.id='direct-modal-options';
    document.getElementById('modal-scout').before(panel);
  }
  function reset() {
    for(const key of Object.keys(filters)) delete filters[key];
    selected.clear();
    document.querySelectorAll('[data-direct-filter]').forEach(input=>{input.disabled=false;if(input.type==='checkbox')input.checked=false;else input.value='';});
    document.querySelectorAll('[data-benefit]').forEach(button=>button.setAttribute('aria-pressed','false'));
  }
  function refreshFilters(countMatches) {
    for(const button of document.querySelectorAll('[data-period]')) {
      const key=button.dataset.period,active=(filters.period || []).includes(key);
      const count=countMatches({...currentFilters(),period:key});
      button.textContent=`${D.DATE_FILTERS[key]} · ${count}`;button.setAttribute('aria-pressed',String(active));button.disabled=!active&&count===0;
    }
    for(const button of document.querySelectorAll('[data-benefit]')) {
      const key=button.dataset.benefit,active=(filters.benefits || []).includes(key);
      const benefits=[...new Set([...(filters.benefits || []),key])];
      const count=countMatches({...currentFilters(),benefits});
      button.textContent=`${D.BENEFITS[key]} · ${count}`;
      button.disabled=!active && count===0;
      button.hidden=count===0;
      button.setAttribute('aria-pressed',String(active));
    }
    const error=document.getElementById('direct-filter-error');
    const invalid=[['payment','Платёж'],['down','ПВ клиента'],['area','Площадь']].filter(([key])=>filters[key+'Min']!=null && filters[key+'Max']!=null && filters[key+'Min']>filters[key+'Max']);
    error.hidden=!invalid.length;error.textContent=invalid.map(([,label])=>`${label}: значение «от» должно быть не больше «до».`).join(' ');
  }
  function renderActiveFilters(container,onChange) {
    for(const [key,value] of Object.entries(filters)) {
      if(value===undefined)continue;
      for(const item of (Array.isArray(value)?value:[value]).filter(item=>key!=='period'||item!=='week'||!value.includes('month'))) {
        const input=document.querySelector(`[data-direct-filter="${key}"]`);
        const caption=key==='period'?D.DATE_FILTERS[item]:key==='benefits'?D.BENEFITS[item]:input?.tagName==='SELECT'?`${input.closest('label').querySelector('span').textContent}: ${input.selectedOptions[0].textContent}`:key==='withImage'?'Только с изображением':`${input?.getAttribute('aria-label')}: ${item}`;
        const chip=el('span',caption,'active-chip'),remove=el('button','×');remove.type='button';remove.setAttribute('aria-label',`Убрать фильтр ${caption}`);
        remove.addEventListener('click',()=>{
          if(key==='period')setPeriods(D.togglePeriod(filters.period,item));
          else if(key==='benefits'){filters.benefits=filters.benefits.filter(k=>k!==item);document.querySelector(`[data-benefit="${item}"]`).setAttribute('aria-pressed','false');}
          else {delete filters[key];if(input){if(input.type==='checkbox')input.checked=false;else input.value='';}if(key==='program')document.querySelector('[data-direct-filter="childrenCount"]').disabled=false;}
          onChange();
        });chip.append(remove);container.append(chip);
      }
    }
  }
  function cardDetails(offer) {
    const box=el('div',null,'direct-card-details');const p=option(offer);
    if(!p)return box;
    if(p.calculation)box.append(el('p',`Расчёт · ${p.rate}% · кредит ${p.termYears} лет${p.ratePeriodYears?` · платёж на первые ${p.ratePeriodYears} лет`:''}`,'direct-age'));
    for(const [label,value] of [['Платёж / мес.',D.money(p.payment)],['ПВ клиента',D.money(p.downPayment)],['Цена',D.money(p.price || offer.price)]]) {
      if(value==='Не указан')continue;
      const row=el('div');row.append(el('span',label),el('strong',value));box.append(row);
    }
    const count=offer.purchaseOptions.length;
    if(offer.calculationCoverage==='no_price')box.append(el('p','Цена не указана: полный расчёт недоступен.','direct-age'));
    const ending=count%100>=11&&count%100<=14?'вариантов':count%10===1?'вариант':count%10>=2&&count%10<=4?'варианта':'вариантов';
    box.append(el('p',`${count} ${ending} покупки`,'direct-age'));
    if(!offer.image)box.append(el('p','Изображение отсутствует','direct-age'));
    return box;
  }
  function choose(offer,panel,onChange) {
    const current=option(offer);if(!current)return;
    if(offer.calculationCoverage==='no_price' && (!current.program || ['Не указана','unknown'].includes(current.program)))return;
    const group=el('section',null,'purchase-scenarios');group.append(el('h3','Как купить'));
    const matches=new Set(D.matchingOptions(offer,currentFilters()).map(p=>p.id));
    const key=p=>D.programLabel(p.program)+'|'+p.financing;
    const groups=new Map();for(const p of offer.purchaseOptions){if(!groups.has(key(p)))groups.set(key(p),[]);groups.get(key(p)).push(p);}
    const programs=el('div',null,'scenario-programs');programs.setAttribute('role','group');programs.setAttribute('aria-label','Программа покупки');
    for(const [name,options] of groups) {
      const p=options.find(p=>matches.has(p.id)),button=el('button',options[0].program==='Не указана'?'Условия без цены':D.programLabel(options[0].program),'scenario-program');
      button.type='button';button.disabled=!p;button.setAttribute('aria-pressed',String(key(current)===name));
      button.addEventListener('click',()=>{selected.set(offer.id,p.id);onChange();});programs.append(button);
    }
    group.append(programs);
    const siblings=groups.get(key(current));
    if(siblings.length>1 || siblings.some(p=>D.childrenFor(p))) {
      const choices=el('div',null,'scenario-choices');choices.setAttribute('role','group');choices.setAttribute('aria-label','Вариант покупки');
      for(const p of siblings) {
        const children=D.childrenFor(p),node=el('button',null,'scenario-choice');node.type='button';node.dataset.optionId=p.id;node.disabled=!matches.has(p.id);node.setAttribute('aria-pressed',String(p.id===current.id));
        node.append(el('strong',children?`${children===5?'5+':children} ${children===1?'ребёнок':'детей'}`:p.rate==null?'Условия оффера':`${p.rate}%`),el('small',p.rate==null?D.money(p.payment):`${String(p.rate).replace('.',',')}%`));
        node.addEventListener('click',()=>{selected.set(offer.id,p.id);onChange();});choices.append(node);
      }
      group.append(choices);
    }
    panel.append(group);
  }
  function visibleConditions(p,offer) {
    return [...(p.conditions || []),...(p.stages || []),...(offer.gifts || [])].map(text=>text.replace(/^\s*изображени[ея]\s*\d+\s*[:.—]\s*/iu,'')).filter(text=>!/^\s*(?:изображени[ея]|планировк|жк\s+явно|текст\s+подтверждает|источник|распозна|зач[её]ркнутая\s+цена)/iu.test(text));
  }
  function renderComparison(offer,p,panel,onChange) {
    const block=el('details',null,'card-disclosure comparison-block');block.append(el('summary','Сравнить с базовыми условиями'));
    const key=offer.id+'/'+p.id;
    const result=D.comparison(offer,p,window.DIRECT_OFFERS_CATALOG.mortgageTerms,comparisonChildren.get(key));
    if(result.needsChildren) {
      const label=el('label','Количество детей для сравнения','direct-filter'),select=el('select');select.setAttribute('aria-label','Количество детей для сравнения');
      for(const [v,t] of [['','Выберите'],['1','1 ребёнок'],['2','2 детей'],['3','3 детей'],['4','4 детей'],['5','5 и более детей']]) {const node=el('option',t);node.value=v;select.append(node);}
      select.addEventListener('change',()=>{comparisonChildren.set(key,Number(select.value));onChange();document.querySelector('.comparison-block').open=true;});label.append(select);block.append(label);
    } else if(result.base) {
      const b=result.base;
      block.append(el('p',result.beforeDiscount?'Та же квартира до скидки, та же программа.':'Та же квартира по текущей цене, без акционных условий.','comparison-caption'));
      if(result.beforeDiscount && p.referencePrice.derivation==='current_plus_discount')block.append(el('p',`Цена до акции рассчитана: ${D.money(p.price || offer.price)} + скидка ${D.money({value:p.referencePrice.discount})} = ${D.money(p.referencePrice)}.`,'comparison-caption'));
      const table=el('table',null,'mortgage-comparison'),head=el('thead'),header=el('tr');
      for(const title of ['','Выбранный вариант',result.beforeDiscount?'До скидки · база':'Базовый вариант'])header.append(el('th',title));head.append(header);table.append(head);
      const body=el('tbody');
      for(const [name,a,v] of [['Цена',D.money(p.price || offer.price),D.money(b.price)],['Платёж / мес.',D.money(p.payment),D.money(b.payment)],['Период платежа',p.paymentPeriod || 'Не указан',b.paymentPeriod],['ПВ клиента',D.money(p.downPayment),D.money(b.downPayment)],['Ставка',p.rate==null?'Не указана':p.rate+'%',b.rate+'%'],['Срок кредита',p.termYears?p.termYears+' лет':'Не указан',b.termYears+' лет']]) {const row=el('tr');row.append(el('th',name),el('td',a),el('td',v));body.append(row);}
      table.append(body);block.append(table);
      block.append(el('p',`${b.program}${b.childrenCount?` · ${b.childrenCount===5?'5+':b.childrenCount} ${b.childrenCount===1?'ребёнок':'детей'}`:''} · ${b.bank}. ПВ такой же, как в выбранном варианте. Без компенсации ПВ и субсидии застройщика. Расчётные условия на ${window.DIRECT_OFFERS_CATALOG.mortgageTerms.generatedAt.slice(0,10).split('-').reverse().join('.')}.`,'comparison-caption'));
      if(b.calculation.outsideBaseLimits)block.append(el('p','При таком ПВ сумма кредита или доля взноса выходит за базовые ограничения банка; платёж показан для сравнения, доступность этих условий требует уточнения.','comparison-caption'));
      if(b.ratePeriodYears && b.termYears>b.ratePeriodYears)block.append(el('p',`Платёж на первые ${b.ratePeriodYears} лет · срок кредита ${b.termYears} лет.`,'payment-period-note'));
      if(!result.beforeDiscount)block.append(el('p','Цена до скидки в источнике не указана.','comparison-caption'));
    } else block.append(el('p',!(p.price || offer.price)?.value?'В исходном оффере нет цены квартиры. Без неё нельзя рассчитать полные базовые условия.':'Для выбранной программы и срока подтверждённого базового расчёта нет.','comparison-caption'));
    panel.append(block);
  }
  function renderScoutComparison(offer,p,panel) {
    const S=window.DirectScout,snapshot=window.DIRECT_SCOUT_INVENTORY;
    const block=el('details',null,'card-disclosure scout-comparison');
    const result=S?.similar(offer,snapshot,today()) || {status:'unavailable',rows:[]};
    block.append(el('summary',`Сравнить с квартирами в этом ЖК${result.rows.length?` · ${result.rows.length}`:''}`));
    panel.append(block);
    if(result.status!=='ready') {
      const message={unavailable:'Данные Scout сейчас недоступны.',unmatched:'Этот ЖК пока не сопоставлен с официальной экспозицией Scout.',no_area:'В оффере не указана площадь для подбора аналогов.',empty:'В официальной экспозиции Scout нет квартир этого ЖК с площадью в пределах ±3 м².'}[result.status];
      block.append(el('p',message,'comparison-caption'));return;
    }
    const date=value=>value?value.slice(0,10).split('-').reverse().join('.'):null;
    block.append(el('p',`${result.project} · площадь ${(offer.areaSqm-3).toLocaleString('ru-RU')}–${(offer.areaSqm+3).toLocaleString('ru-RU')} м². Scout · официальные источники застройщиков · получено ${date(snapshot.fetchedAt)}.`,'comparison-caption'));
    const label=el('label',null,'direct-filter'),select=el('select');
    label.append(el('span','Квартира для сравнения'));select.setAttribute('aria-label','Квартира Scout для сравнения');
    for(const row of result.rows){
      const caption=[`${row.area.toLocaleString('ru-RU')} м²`,row.rooms?`${row.rooms} комн.`:null,D.money({value:row.price}),row.floor?`этаж ${row.floor}`:null,row.number?`№ ${row.number}`:null,row.house].filter(Boolean).join(' · ');
      const node=el('option',caption);node.value=row.id;select.append(node);
    }
    select.value=result.rows.some(r=>r.id===scoutSelected.get(offer.id))?scoutSelected.get(offer.id):result.rows[0].id;
    label.append(select);block.append(label);
    const content=el('div');block.append(content);
    const draw=()=>{
      const row=result.rows.find(r=>r.id===select.value);scoutSelected.set(offer.id,row.id);content.replaceChildren();
      const {base:b,delta}=S.scenario(D,offer,p,row,window.DIRECT_OFFERS_CATALOG.mortgageTerms);
      if(delta!=null)content.append(el('p',delta===0?'Цена совпадает с оффером.':`Квартира Scout ${delta>0?'дороже':'дешевле'} оффера на ${D.money({value:Math.abs(delta)})}.`,'scout-price-delta'));
      const table=el('table',null,'mortgage-comparison'),head=el('thead'),header=el('tr');
      for(const title of ['','Этот оффер','Квартира Scout'])header.append(el('th',title));head.append(header);table.append(head);
      const body=el('tbody');
      for(const [name,a,v] of [['Площадь',`${offer.areaSqm.toLocaleString('ru-RU')} м²`,`${row.area.toLocaleString('ru-RU')} м²`],['Цена',D.money(p.price || offer.price),D.money({value:row.price})],['Платёж / мес.',D.money(p.payment),b?D.money(b.payment):'Нет расчёта'],['ПВ клиента',D.money(p.downPayment),b?D.money(b.downPayment):'Нет расчёта'],['Ставка',p.rate!=null?`${p.rate}%`:'Не указана',b?`${b.rate}%`:'Нет расчёта'],['Срок кредита',p.termYears?`${p.termYears} лет`:'Не указан',b?`${b.termYears} лет`:'Нет расчёта']]){
        const tr=el('tr');tr.append(el('th',name),el('td',a),el('td',v));body.append(tr);
      }
      table.append(body);content.append(table);
      if(b){
        content.append(el('p',`${b.program}${b.childrenCount?` · ${b.childrenCount===5?'5+':b.childrenCount} ${b.childrenCount===1?'ребёнок':'детей'}`:''} · Сбер. Тот же ПВ клиента. ${b.paymentPeriod}. Расчёт на ${date(window.DIRECT_OFFERS_CATALOG.mortgageTerms.generatedAt)}; акционные условия оффера на соседнюю квартиру не переносятся.`,'comparison-caption'));
        if(b.calculation.outsideBaseLimits)content.append(el('p','При выбранном ПВ расчёт выходит за базовые ограничения банка. Доступность этих условий требует уточнения.','comparison-caption'));
      }else content.append(el('p','Для этой квартиры при выбранной программе и ПВ полный расчёт недоступен.','comparison-caption'));
      content.append(el('p',`Цена в Scout обновлена: ${date(row.updatedAt) || 'дата не указана'}.`,'comparison-caption'));
      const url=S.safeUrl(row.url);if(url){const a=el('a','Открыть квартиру у застройщика','scout-source-link');a.href=url;a.target='_blank';a.rel='noopener noreferrer';content.append(a);}
    };
    select.addEventListener('change',draw);draw();
  }
  function renderModal(offer,onChange) {
    const panel=document.getElementById('direct-modal-options');
    const scoutOpen=panel.dataset.offerId===offer.id && panel.querySelector('.scout-comparison')?.open;
    const baseOpen=panel.dataset.offerId===offer.id && panel.querySelector('.comparison-block')?.open;
    panel.replaceChildren();
    const p=option(offer);if(!p)return;
    panel.dataset.offerId=offer.id;panel.dataset.optionId=p.id;
    const model=D.model(offer,p,today());
    const summary=el('section',null,'purchase-summary');summary.setAttribute('aria-label','Основные условия покупки');
    for(const [label,value] of [['Стоимость квартиры',model.price],['Платёж в месяц',model.payment],['ПВ клиента',model.downPayment]]) {const metric=el('div',null,'purchase-metric');metric.append(el('span',label),el('strong',value));summary.append(metric);}panel.append(summary);
    if(offer.calculationCoverage==='no_price')panel.append(el('p','Цена квартиры в исходнике не указана. Показываем известные условия; недостающие суммы без цены не рассчитываем.','calculation-note'));
    if(p.stages?.length) {const stages=el('p',p.stages.join(' · '),'payment-period-note');panel.append(stages);}
    document.getElementById('modal-district').hidden=true;
    choose(offer,panel,onChange);
    renderComparison(offer,p,panel,onChange);
    if(baseOpen)panel.querySelector('.comparison-block').open=true;
    renderScoutComparison(offer,p,panel);
    if(scoutOpen)panel.querySelector('.scout-comparison').open=true;
    const extra=el('details',null,'card-disclosure');extra.append(el('summary','Дополнительная информация'));
    const facts=el('dl',null,'direct-facts');
    const sourceLinks=[...new Set((offer.sourceLinks || []).map(D.sourceMessageUrl).filter(Boolean))];
    if(sourceLinks.length) {
      const row=el('div'),links=el('dd');
      sourceLinks.forEach((url,index)=>{
        if(index)links.append(el('br'));
        const link=el('a',index?`Публикация ${index+1} в Telegram`:'Открыть оффер в Telegram');
        link.href=url;link.target='_blank';link.rel='noopener noreferrer';links.append(link);
      });
      row.append(el('dt','Источник'),links);facts.append(row);
    }
    for(const [label,value] of [['Тип ПВ',({zero:'Без ПВ',partial:'ЧПВ',compensated:'С компенсацией',full:'Полный ПВ'})[p.downPaymentType] || 'Не указан'],
      ['Компенсация ПВ',model.compensation || 'Не указана'],['Ставка',model.rate || 'Не указана'],['Срок кредита',model.term || 'Не указан'],
      ['Период платежа',model.paymentPeriod || 'Не указан'],['Схема покупки',model.financing],['Отделка',model.finishing],
      ['Публикация',model.publishedAt],['Акция до',model.validUntil || 'Не указано']]) {
      if(!value || /^Не указан[ао]?$|^Схема не указана$|^Отделка не указана$/u.test(value))continue;
      const row=el('div');row.append(el('dt',label),el('dd',value));facts.append(row);
    }
    if(offer.validUntil && offer.validUntil<today())panel.append(el('p','Указанный срок акции истёк','direct-status'));
    extra.append(facts);
    const conditions=el('ul',null,'direct-conditions');
    for(const text of visibleConditions(p,offer))conditions.append(el('li',text));
    extra.append(conditions);panel.append(extra);
    const unused=(offer.sourcePurchaseOptions || []).filter(s=>!offer.purchaseOptions.some(p=>p.id===s.id));
    if(unused.length) {
      const saved=el('details',null,'source-offer-terms');saved.append(el('summary','Данные из исходного оффера'));
      for(const original of unused) {
        const text=[original.program && original.program!=='Не указана'?original.program:null,
          original.payment?`Платёж: ${D.money(original.payment)}`:null,original.downPayment?`ПВ клиента: ${D.money(original.downPayment)}`:null,
          original.rate!=null?`Ставка: ${original.rate}%`:null,...visibleConditions(original,{gifts:[]})].filter(Boolean).join(' · ');
        if(text)saved.append(el('p',text));
      }
      extra.append(saved);
    }
    document.getElementById('modal-offer-title').textContent=[offer.room,offer.areaSqm?`${offer.areaSqm.toLocaleString('ru-RU')} м²`:null].filter(Boolean).join(' · ');
    const badge=document.getElementById('modal-type');badge.textContent=D.benefitKeys(offer,p).filter(k=>!['anyGift','compensated'].includes(k)).map(k=>D.BENEFITS[k]).join(' · ');badge.hidden=!badge.textContent;
    document.getElementById('modal-scout').hidden=true;
    const link=document.getElementById('modal-download');link.removeAttribute('href');link.removeAttribute('download');
    link.setAttribute('role','button');link.setAttribute('tabindex','0');
    link.hidden=true;
    const actions=el('div',null,'card-actions');
    for(const [caption,kind] of [['Добавить в сравнение','compare'],['Добавить в подборку','selection']]) {const button=el('button',caption,`card-action ${kind}`);button.type='button';button.dataset.placeholderAction=kind;button.addEventListener('click',()=>{const toast=document.getElementById('catalog-toast');toast.hidden=false;toast.textContent=kind==='compare'?'Сравнение нескольких квартир появится здесь позже.':'Формирование подборки появится здесь позже.';setTimeout(()=>{toast.hidden=true;},4000);});actions.append(button);}panel.append(actions);
    const original=document.getElementById('modal-image');original.src=imagePath(offer);
    original.alt=`${offer.complex} — ${D.description(offer,p)}`;
  }
  async function dataUri(url) {
    if(url.startsWith('data:'))return url;
    const response=await fetch(url);if(!response.ok)throw Error('Изображение недоступно');
    const blob=await response.blob();
    return new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result);reader.onerror=reject;reader.readAsDataURL(blob);});
  }
  async function download(offer,p) {
    const toast=document.getElementById('catalog-toast');toast.hidden=false;toast.textContent='Подготавливаем карточку…';
    let svgUrl;
    try {
      const imageData=offer.image ? await dataUri(imagePath(offer)) : null;
      const model=D.model(offer,p,today(),imageData);
      const svg=window.CatalogCard.svg(model);
      svgUrl=URL.createObjectURL(new Blob([svg],{type:'image/svg+xml;charset=utf-8'}));
      const image=new Image();await new Promise((resolve,reject)=>{image.onload=resolve;image.onerror=reject;image.src=svgUrl;});
      const scale=Math.min(2,16384/image.naturalHeight,16384/image.naturalWidth);
      const canvas=document.createElement('canvas');canvas.width=Math.round(image.naturalWidth*scale);canvas.height=Math.round(image.naturalHeight*scale);
      const ctx=canvas.getContext('2d');if(!ctx)throw Error('Canvas unavailable');ctx.scale(scale,scale);ctx.drawImage(image,0,0);
      const png=canvas.toDataURL('image/png');if(!png.startsWith('data:image/png;'))throw Error('PNG unavailable');
      const link=el('a','Открыть подготовленный PNG','direct-export-result');
      link.href=png;link.download=`formula-${offer.id}-variant-${model.optionNumber}.png`;link.id='direct-export-result';
      const panel=document.getElementById('direct-modal-options');
      if(panel.dataset.offerId===offer.id && panel.dataset.optionId===p.id) {
        document.getElementById('direct-export-result')?.remove();panel.append(link);link.click();
      } else {document.body.append(link);link.click();link.remove();}
      toast.textContent=`PNG подготовлен · вариант ${model.optionNumber}`;
    } catch(error) {toast.textContent='Не удалось подготовить PNG. Откройте каталог через локальный сервер или автономный HTML.';}
    finally {if(svgUrl)URL.revokeObjectURL(svgUrl);setTimeout(()=>{toast.hidden=true;},5000);}
  }
  window.DirectCatalogUI={filters,currentFilters,option,imagePath,attachControls,reset,refreshFilters,renderActiveFilters,cardDetails,renderModal,download,
    activeCount:()=>Object.entries(filters).reduce((n,[key,value])=>n+(Array.isArray(value)?value.filter(item=>key!=='period'||item!=='week'||!value.includes('month')).length:value!==undefined?1:0),0)};
})();
