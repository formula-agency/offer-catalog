/* Direct import contract. All constraints must match the same purchase option. */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.DirectCatalog = api;
})(globalThis, function () {
  'use strict';
  const TYPE_ORDER = ['NEW', 'ПВ 0% (семейка)', 'ЧПВ + семейка', 'ЧПВ + стандарт',
    'Субсидия «Стандарт» (полный ПВ)', 'Акции и скидки', 'Рассрочка',
    'Застройщик платит ипотеку за клиента', 'Траншевая ипотека', 'С ремонтом', 'Другие условия'];
  const money = amount => amount && Number.isFinite(amount.value)
    ? (amount.qualifier === 'from' ? 'от ' : '') + new Intl.NumberFormat('ru-RU').format(amount.value) + ' ₽'
    : 'Не указан';
  const normalize = value => String(value || '').toLocaleLowerCase('ru-RU').replace(/ё/g, 'е').trim();
  const BENEFITS = {partial:'ЧПВ',zero:'Без ПВ',compensated:'Компенсация ПВ',tranche:'Траншевая ипотека',installment:'Рассрочка',discount:'Скидка',subsidy:'Субсидия',anyGift:'Любой подарок',renovation:'Ремонт в подарок',storage:'Кладовая в подарок',parking:'Паркинг в подарок',furniture:'Мебель / кухня в подарок',smartHome:'Умный дом в подарок',mortgagePaid:'Платим ипотеку за вас',rentPaid:'Оплата аренды'};
  const programLabel = value => value === 'Стандартная' ? 'Новостройка' : value;
  function sourceMessageUrl(value) {
    if(typeof value!=='string')return null;
    try {
      const url=new URL(value);
      if(url.protocol!=='https:' || url.hostname!=='t.me' || url.port || url.username || url.password)return null;
      if(!/^\/(?:[A-Za-z0-9_]+\/[1-9]\d*|s\/[A-Za-z0-9_]+\/[1-9]\d*|c\/[1-9]\d*\/[1-9]\d*)\/?$/.test(url.pathname))return null;
      return 'https://t.me'+url.pathname.replace(/^\/s\//,'/').replace(/\/$/,'');
    } catch {return null;}
  }
  function benefitKeys(offer, option) {
    const text=normalize([...(option.conditions || []),...(offer.gifts || [])].join('\n'));
    const positive=text.replace(/(?:без|нет|не применяется)\s+субсиди[^.;\n]*/g,'');
    const keys=[];
    // Structured facts belong to this option; never infer a zero from a missing amount.
    if (['zero','partial','compensated'].includes(option.downPaymentType)) keys.push(option.downPaymentType);
    if (['tranche','installment'].includes(option.financing)) keys.push(option.financing);
    if(/скидк|дисконт|цен[аы]\s+(?:снижена|со скидкой)|зач[её]ркнут/.test(text))keys.push('discount');
    if(/субсиди/.test(positive))keys.push('subsidy');
    const gifts=normalize((offer.gifts || []).join('\n'));
    for(const [key,pattern] of Object.entries({renovation:/(?:ремонт|отделк|сануз)[^\n]*в подарок/,storage:/кладов[^\n]*в подарок/,parking:/паркинг[^\n]*в подарок/,furniture:/(?:мебел|меблиров|кухн)[^\n]*в подарок/,smartHome:/умный дом[^\n]*в подарок/,mortgagePaid:/(?:платим ипотеку|застройщик[^\n]*(?:платит|оплачивает)[^\n]*(?:ипотек|плат[её]ж|еп)|поддержка платежа)/,rentPaid:/оплата аренды/})) {
      if(pattern.test(gifts))keys.push(key);
    }
    if(keys.some(k=>['renovation','storage','parking','furniture','smartHome','mortgagePaid','rentPaid'].includes(k)) || /в подарок/.test(gifts))keys.push('anyGift');
    const result=new Set([...keys,...(option.promotionKeys || []).filter(key=>Object.hasOwn(BENEFITS,key))]);
    if(result.has('compensated'))result.add('partial');
    return [...result].filter(key=>!option.calculation || key!=='subsidy');
  }
  function optionTypes(offer, option) {
    const types = [];
    const family = option.program === 'Семейная';
    const partial = ['partial', 'compensated'].includes(option.downPaymentType);
    if (family && option.downPayment?.value === 0) types.push('ПВ 0% (семейка)');
    if (partial && family) types.push('ЧПВ + семейка');
    if (partial && ['Стандартная', 'Новостройка'].includes(option.program)) types.push('ЧПВ + стандарт');
    const text = normalize([...(option.conditions || []), ...(offer.gifts || [])].join('\n'));
    const positive = text.replace(/(?:без|нет|не применяется)\s+субсиди[^.;\n]*/g, '');
    if (!option.calculation && ['Стандартная', 'Новостройка'].includes(option.program) && option.downPaymentType === 'full' && /субсиди/.test(positive)) types.push('Субсидия «Стандарт» (полный ПВ)');
    if (benefitKeys(offer,option).some(key=>['discount','anyGift'].includes(key))) types.push('Акции и скидки');
    if (option.financing === 'installment') types.push('Рассрочка');
    if (option.financing === 'tranche') types.push('Траншевая ипотека');
    if (/(?:платим ипотеку|застройщик[^\n]*(?:платит|оплачивает)[^\n]*(?:ипотек|плат[её]ж))/.test(text)) types.push('Застройщик платит ипотеку за клиента');
    // A renovation gift does not establish the apartment's finishing.
    if (offer.finishing === 'finished') types.push('С ремонтом');
    return types.length ? types : ['Другие условия'];
  }
  function matchingOptions(offer, filters = {}) {
    if(filters.period && !matchesPeriod(offer,filters.period,filters.asOf))return [];
    if(filters.finishing && offer.finishing!==filters.finishing)return [];
    if(filters.withImage && !offer.image)return [];
    if((filters.areaMin!=null || filters.areaMax!=null) && (!Number.isFinite(offer.areaSqm) || (filters.areaMin!=null && offer.areaSqm<filters.areaMin) || (filters.areaMax!=null && offer.areaSqm>filters.areaMax)))return [];
    for(const field of ['payment','down','area'])if(filters[field+'Min']!=null && filters[field+'Max']!=null && filters[field+'Min']>filters[field+'Max'])return [];
    const selected = [...(filters.types || [])].filter(type => type !== 'NEW');
    return (offer.purchaseOptions || []).filter(option => {
      if(selected.length) {
        const types=optionTypes(offer,option);
        if(!selected.every(type=>types.includes(type)))return false;
      }
      if (filters.program && programLabel(option.program) !== programLabel(filters.program)) return false;
      if (filters.financing && option.financing !== filters.financing) return false;
      if(filters.downPaymentType && !(filters.downPaymentType==='chplv'?['partial','compensated'].includes(option.downPaymentType):option.downPaymentType===filters.downPaymentType))return false;
      if(filters.childrenCount) {
        if (option.program !== 'Семейная') return false;
        const counts=option.childrenCount ? [option.childrenCount] : [...(option.conditions || []).join(' ').matchAll(/\b([1-5])\s*(?:реб[её]н|дет)/gi)].map(m=>Number(m[1]));
        if(!counts.length || !counts.every(n=>n===Number(filters.childrenCount)))return false;
      }
      if(!(filters.benefits || []).every(key=>benefitKeys(offer,option).includes(key)))return false;
      for (const [value, min, max] of [[option.payment?.value, filters.paymentMin, filters.paymentMax],
        [option.downPayment?.value, filters.downMin, filters.downMax]]) {
        if ((min != null || max != null) && (!Number.isFinite(value) || (min != null && value < min) || (max != null && value > max))) return false;
      }
      return true;
    });
  }
  function selectedOption(offer, filters, requestedId) {
    const matches = matchingOptions(offer, filters);
    return matches.find(option => option.id === requestedId) || matches[0] || null;
  }
  function annuity(loan,rate,months) {
    if(!Number.isFinite(loan)||loan<0||!Number.isFinite(rate)||rate<0||!Number.isInteger(months)||months<=0)throw Error('Invalid mortgage inputs');
    const r=rate/12;return r===0?loan/months:loan*r/(-Math.expm1(-months*Math.log1p(r)));
  }
  function baseScenario(price,program,children,terms,requestedTerm,requestedDownPayment) {
    if(!(price?.value>0)||terms?.schemaVersion!==1)return null;
    let row=programLabel(program)==='Новостройка'?terms.newBuild:program==='Семейная'&&Number.isInteger(children)?terms.family.find(r=>r.childrenCount===children):null;
    if(!row)return null;
    const term=requestedTerm || row.termYears || terms.termYears;
    // Loan maturity and the subsidized rate period are distinct.
    if(!Number.isInteger(term)||term<1||term>(row.termYears || terms.termYears))return null;
    const fixedDown=requestedDownPayment!=null;
    if(fixedDown && (!Number.isFinite(requestedDownPayment.value) || requestedDownPayment.value<0 || requestedDownPayment.value>price.value))return null;
    const down=fixedDown?requestedDownPayment.value:Math.ceil(Math.max(price.value*terms.minDownPaymentFraction,children?price.value-row.loanLimit:0)-1e-7),loan=price.value-down;
    const loanLimit=row.loanLimit || null;
    if(row.loanRateTiers) {
      row=row.loanRateTiers.find(t=>(t.maxLoan==null || loan<=t.maxLoan)&&(t.minLoanExclusive==null || loan>t.minLoanExclusive));
      if(!row)return null;
    }
    const qualifier=price.qualifier==='from'?'from':'exact';
    return {program:programLabel(program),childrenCount:children || null,bank:row.bank,financing:'mortgage',price:{...price},
      downPayment:fixedDown?{...requestedDownPayment}:{value:down,qualifier},payment:{value:Math.ceil(annuity(loan,row.client_rate,term*12)),qualifier},
      compensation:null,downPaymentType:'full',rate:row.client_rate*100,termYears:term,ratePeriodYears:row.ratePeriodYears || null,
      paymentPeriod:row.ratePeriodYears && term>row.ratePeriodYears?`Первые ${row.ratePeriodYears} лет`:'На весь срок кредита',
      conditions:[`${row.bank} · базовый банковский сценарий`,`ПВ от ${terms.minDownPaymentFraction*100}%`,...(row.special?.startsWith('не ЗП/клиент')?[`Для незарплатного клиента · ${loan>7000000?'кредит более 7 млн ₽':'кредит до 7 млн ₽'}`]:[]),...(row.ratePeriodYears && term>row.ratePeriodYears?[`Платёж на первые ${row.ratePeriodYears} лет. Срок кредита — ${term} лет.`]:[])],stages:[],
      calculation:{kind:'standard_mortgage',termsGeneratedAt:terms.generatedAt,loan,minDownPaymentFraction:terms.minDownPaymentFraction,loanLimit,
        downPaymentBasis:fixedDown?'selected_option':'minimum',outsideBaseLimits:fixedDown && (down<price.value*terms.minDownPaymentFraction || (loanLimit!=null && loan>loanLimit))}};
  }
  function enrich(offer,terms) {
    if(offer.calculationCoverage || !terms)return offer;
    const source=offer.purchaseOptions;
    const prices=new Map();
    for(const p of source) {
      const price=p.price || offer.price;
      if(Number.isFinite(price?.value) && price.value>0) {
        const key=price.value+'|'+(price.qualifier || 'exact');
        if(!prices.has(key))prices.set(key,{price,options:[]});
        prices.get(key).options.push(p);
      }
    }
    if(!prices.size)return {...offer,sourcePurchaseOptions:source,calculationCoverage:'no_price'};
    const complete=p=>['Семейная','Новостройка'].includes(programLabel(p.program)) && (p.price || offer.price)?.value>0
      && Number.isFinite(p.payment?.value) && p.payment.value>=0 && Number.isFinite(p.downPayment?.value) && p.downPayment.value>=0;
    const kept=source.filter(complete),generated=[];
    for(const original of source) {
      const price=original.price || offer.price,children=childrenFor(original);
      // A published first-period rate can price a separate scenario; source fields remain untouched.
      // Do not infer a rate period from an alternative labelled "15–30 years".
      if(original.program!=='Семейная' || original.financing!=='mortgage' || !children || !(price?.value>0) || !(original.rate>0) || original.rate>=100
        || original.payment!=null || original.downPayment!=null || original.compensation!=null
        || ['partial','compensated','zero'].includes(original.downPaymentType)
        || !/(?:на|первые)\s+15\s+лет/iu.test((original.conditions || []).join('\n')))continue;
      const row=terms.family.find(r=>r.childrenCount===children);if(!row)continue;
      const calculated=baseScenario(price,'Семейная',children,{...terms,family:[{...row,client_rate:original.rate/100,ratePeriodYears:15}]});
      if(!calculated)continue;
      kept.push({...calculated,id:original.id+'-calculated',rate:original.rate,bank:null,referencePrice:original.referencePrice,
        promotionKeys:original.promotionKeys || [],
        conditions:[`Ставка оффера ${original.rate}%. Платёж рассчитан на первые 15 лет.`,`ПВ от ${terms.minDownPaymentFraction*100}% и кредит ${calculated.termYears} лет — расчётные параметры.`,...(original.conditions || [])],
        calculation:{...calculated.calculation,kind:'source_rate_mortgage',sourceOptionId:original.id}});
    }
    let index=0;
    for(const {price,options} of prices.values()) {
      const refs=options.map(p=>p.referencePrice).filter(Boolean);
      const referencePrice=refs.length&&new Set(refs.map(p=>p.value)).size===1?refs[0]:null;
      const promotions=[...new Set(options.flatMap(p=>benefitKeys(offer,p)))].filter(key=>!['subsidy','partial','zero','compensated','tranche','installment'].includes(key));
      for(const [program,children] of [['Новостройка',null],...terms.family.map(r=>['Семейная',r.childrenCount])]) {
        if(kept.some(p=>programLabel(p.program)===program && childrenFor(p)===children && (p.price || offer.price)?.value===price.value))continue;
        const p=baseScenario(price,program,children,terms);
        if(!p)continue;
        generated.push({...p,id:`${offer.id}-base-${index}-${children || 'newbuild'}`,referencePrice,promotionKeys:promotions});
      }
      index++;
    }
    return {...offer,sourcePurchaseOptions:source,purchaseOptions:[...kept,...generated],calculationCoverage:'priced'};
  }
  function childrenFor(option) {
    if(Number.isInteger(option.childrenCount))return option.childrenCount;
    const found=[...new Set([...(option.conditions || []).join(' ').matchAll(/(?<!\d)([1-5])\s*(?:и\s+более\s+)?(?:реб(?:[её]н\p{L}*)?|дет\p{L}*)(?!\p{L})/giu)].map(m=>Number(m[1])))];
    return found.length===1?found[0]:null;
  }
  function comparison(offer,option,terms,children) {
    const currentPrice=option.price || offer.price,reference=option.referencePrice;
    const beforeDiscount=reference?.value>currentPrice?.value;
    const price=beforeDiscount?reference:currentPrice;
    const count=option.program==='Семейная'?(childrenFor(option) || children):null;
    const base=baseScenario(price,option.program,count,terms,option.termYears || undefined,option.downPayment);
    return {base,beforeDiscount:!!beforeDiscount,childrenCount:count,needsChildren:option.program==='Семейная'&&!count};
  }
  function date(value) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value || '')) return null;
    const parsed = new Date(value + 'T00:00:00Z');
    return Number.isFinite(+parsed) && parsed.toISOString().slice(0, 10) === value ? parsed : null;
  }
  function freshness(offer, today) {
    const published = date(offer.publishedAt), now = date(today);
    if (offer.sourceNeedsAttention || !published || !now || published > now) return 'review';
    const lastDay = new Date(Date.UTC(published.getUTCFullYear(), published.getUTCMonth() + 3, 0)).getUTCDate();
    const expiry = new Date(Date.UTC(published.getUTCFullYear(), published.getUTCMonth() + 2, Math.min(published.getUTCDate(), lastDay)));
    if (now >= expiry) return 'removal';
    if ((now - published) / 86400000 >= 30 || (date(offer.validUntil) && offer.validUntil < today)) return 'clarify';
    return 'fresh';
  }
  const PERIODS={twoMonths:'За два месяца',week:'За неделю',month:'За месяц',older:'От 1 до 2 месяцев',review:'Неподтверждённые'};
  const DATE_FILTERS={week:'🔥🔥🔥 За неделю',month:'❗❗ За месяц',older:'❓❓ От 1 до 2 месяцев'};
  function togglePeriod(values,key) {
    const selected=new Set(Array.isArray(values)?values:[]);
    if(key==='month') {
      if(selected.has('month')){selected.delete('month');selected.delete('week');}
      else {selected.add('month');selected.add('week');}
    } else if(key==='week' && selected.has('month')) {selected.delete('month');selected.add('week');}
    else if(Object.hasOwn(DATE_FILTERS,key)){if(selected.has(key))selected.delete(key);else selected.add(key);}
    return Object.keys(DATE_FILTERS).filter(key=>selected.has(key));
  }
  function matchesPeriod(offer,period,today) {
    if(Array.isArray(period))return period.length?period.some(key=>matchesPeriod(offer,key,today)):matchesPeriod(offer,'twoMonths',today);
    const published=date(offer.publishedAt),now=date(today);
    if(!now)return false;
    // Hide expired records even if their source still requires review; keep the archive intact.
    if(published && published<=now) {
      const last=new Date(Date.UTC(published.getUTCFullYear(),published.getUTCMonth()+3,0)).getUTCDate();
      const expiry=new Date(Date.UTC(published.getUTCFullYear(),published.getUTCMonth()+2,Math.min(published.getUTCDate(),last)));
      if(now>=expiry)return false;
    }
    if(period==='review')return !published || published>now || offer.sourceNeedsAttention || !!(date(offer.validUntil)&&offer.validUntil<today);
    if(!published || published>now)return false;
    const days=(now-published)/86400000;
    return period==='twoMonths' || (period==='week'&&days<7) || (period==='month'&&days<30) || (period==='older'&&days>=30);
  }
  const STATUS = {fresh: 'Свежий по дате', clarify: 'Требует уточнения', removal: 'К удалению', review: 'Неполные данные источника'};
  function description(offer, option) {
    return [offer.room, offer.areaSqm == null ? null : `${new Intl.NumberFormat('ru-RU').format(offer.areaSqm)} м²`, option?.program==='Не указана'?null:option?.program==='Стандартная'?'Новостройка':option?.program,
      option?.payment ? `${money(option.payment)}/мес.` : null].filter(Boolean).join(' · ');
  }
  function model(offer, option, today, imageData) {
    const program = option.program === 'Стандартная' ? 'Новостройка' : option.program;
    return {project: offer.complex==='ЖК не определён'?'Квартира в новостройке':offer.complex, apartment: [offer.room, offer.areaSqm == null ? null : `${offer.areaSqm} м²`].filter(Boolean).join(' · '),
      program: !program || program==='Не указана'?'Условия покупки':program, price: money(option.price || offer.price), payment: money(option.payment),
      downPayment: money(option.downPayment), compensation: option.compensation ? money(option.compensation) : null,
      rate: option.rate == null ? null : `${option.rate}%`, paymentPeriod: option.paymentPeriod,
      term: option.termYears == null ? null : `${option.termYears} лет`,
      financing: ({mortgage:'Ипотека',installment:'Рассрочка',tranche:'Траншевая ипотека',cash:'Полная оплата'})[option.financing] || 'Схема не указана',
      finishing: ({finished:'С отделкой',unfinished:'Без отделки','pre-finish':'Предчистовая'})[offer.finishing] || 'Отделка не указана',
      offerLabels: [...optionTypes(offer, option),...(option.calculation?['Расчётный вариант']:[])], conditions: option.conditions || [], stages: option.stages || [],
      offerImage: imageData ? {status:'available',kind:offer.image.kind,dataUri:imageData,width:offer.image.width,height:offer.image.height} : null,
      floorplan: {note:offer.imageNote}, publishedAt:offer.publishedAt || 'Не указана',validUntil:offer.validUntil,
      status:freshness(offer,today),issues:[],optionNumber:offer.purchaseOptions.findIndex(o=>o.id===option.id)+1,
      totalOptions:offer.purchaseOptions.length,asOf:today,sourceUrl:'',sourceImageIndex:null};
  }
  return {TYPE_ORDER, STATUS, BENEFITS, PERIODS, DATE_FILTERS,togglePeriod,matchesPeriod, programLabel,sourceMessageUrl, benefitKeys, money, optionTypes, matchingOptions, selectedOption, freshness, description, model,annuity,baseScenario,enrich,childrenFor,comparison};
});
