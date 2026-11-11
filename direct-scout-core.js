(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.DirectScout=api;})(typeof window==='object'?window:globalThis,function(){
  'use strict';
  const normalize=value=>String(value || '').toLocaleLowerCase('ru-RU').replace(/ё/g,'е').replace(/^жк\s+/u,'').replace(/[^\p{L}\p{N}]/gu,'');
  function safeUrl(value){try{const u=new URL(value);return u.protocol==='https:'&&!u.username&&!u.password?u.href:null;}catch{return null;}}
  function active(row,day){return row.price_source_type==='official' && row.deleted_flg==='N'
    && (!row.effective_from || String(row.effective_from).slice(0,10)<=day)
    && (!row.effective_to || String(row.effective_to).slice(0,10)>day);}
  function similar(offer,snapshot,day){
    if(!snapshot?.fetchedAt)return {status:'unavailable',rows:[]};
    const project=snapshot.projects?.[normalize(offer.complex)];
    if(!project)return {status:'unmatched',rows:[]};
    if(!(offer.areaSqm>0))return {status:'no_area',rows:[],project};
    const rows=(snapshot.apartments || []).filter(r=>r.project===project && Math.abs(r.area-offer.areaSqm)<=3+1e-8
      && (!r.validFrom || r.validFrom<=day) && (!r.validTo || r.validTo>day));
    rows.sort((a,b)=>Math.abs(a.area-offer.areaSqm)-Math.abs(b.area-offer.areaSqm)||a.price-b.price||a.id.localeCompare(b.id));
    return {status:rows.length?'ready':'empty',rows,project};
  }
  function scenario(D,offer,option,apartment,terms){
    const children=option.program==='Семейная'?D.childrenFor(option):null;
    const base=D.baseScenario({value:apartment.price,qualifier:'exact'},option.program,children,terms,option.termYears || undefined,option.downPayment);
    const price=(option.price || offer.price)?.value;
    return {base,delta:Number.isFinite(price)?apartment.price-price:null,children};
  }
  return {normalize,safeUrl,active,similar,scenario};
});
