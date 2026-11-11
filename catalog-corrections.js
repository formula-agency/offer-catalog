(function () {
  'use strict';

  const catalog = window.DIRECT_OFFERS_CATALOG;
  if (!Array.isArray(catalog?.offers)) return;

  const corrections = {
    // https://t.me/partners4D/17123 — кадр 00:06, планировка 1+ 36,5 м².
    cf158c67359ce010faabc24844472b4c: {
      image: {
        path: 'assets/offer-images/3a95dac16c8d5afc2b13b03a23c99e4d6c55218b7ec3e081493b5124d994a748.jpg',
        width: 720,
        height: 1280,
        kind: 'original_offer'
      },
      imageNote: 'Кадр из видеопубликации 4D & ПАРТНЕРЫ от 10.11.2026.'
    },
    // https://t.me/inko_partner/2292 — кадр 00:15, планировка 3К 78,7 м².
    '088ba82d1d848e58dffe24c2815345fa': {
      image: {
        path: 'assets/offer-images/6e0b10a56e06554facbbfa1b9f5434097a4b7344c9085d677033df2e7c7050c9.jpg',
        width: 720,
        height: 1280,
        kind: 'original_offer'
      },
      imageNote: 'Кадр из видеопубликации ГК Инко и ПАРТНЕРЫ от 25.10.2026.'
    },
    // https://xn--80afahr7ap7a8g.xn--p1ai/apartments/15725055/
    // Квартира № 41 на 7-м этаже: ЖК «Дивный квартал у озера».
    a34329c02751724b26d8d56e3499ee57: {
      complex: 'Дивный квартал у озера',
      sourceCondition: 'Планировка квартиры № 41, 76,7 м², 7-й этаж — ЖК «Дивный квартал у озера» (официальная карточка застройщика).'
    }
  };

  for (const offer of catalog.offers) {
    const correction = corrections[offer.id];
    if (!correction) continue;

    if (correction.image && !offer.image) {
      offer.image = correction.image;
      offer.path = correction.image.path;
      offer.imageNote = correction.imageNote;
    }

    if (correction.complex) {
      offer.complex = correction.complex;
      for (const option of offer.purchaseOptions || []) {
        option.conditions = (option.conditions || []).map((condition) =>
          condition.includes('ЖК «Зарека» прямо упомянут')
            ? correction.sourceCondition
            : condition
        );
      }
    }
  }
})();
