import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { toPublicOffer } from '../../src/catalog-contract.mjs';

const source = JSON.parse(await readFile(new URL('../../examples/offer-v2-multiple-options.json', import.meta.url), 'utf8'));
const publicOffer = {
  ...toPublicOffer(source, { imagePath: 'media/queue/fixture.svg' }),
  addedAt: '2026-10-23T10:00:00.000Z'
};
const queueScript = `window.QUEUE_OFFERS_CATALOG = ${JSON.stringify({
  schemaVersion: 1,
  generatedAt: '2026-10-26T08:00:00.000Z',
  offers: [publicOffer]
})};`;
const image = `<svg xmlns="http://www.w3.org/2000/svg" width="900" height="1200" viewBox="0 0 900 1200">
  <rect width="900" height="1200" fill="#f7f3ff"/><rect x="55" y="55" width="790" height="1090" rx="42" fill="white" stroke="#4c2b91" stroke-width="10"/>
  <text x="90" y="160" font-family="Arial" font-size="58" font-weight="700" fill="#21134d">Синтетический оффер</text>
  <text x="90" y="240" font-family="Arial" font-size="36" fill="#6f657f">42,5 м² · несколько вариантов</text>
  <rect x="110" y="340" width="680" height="620" rx="28" fill="#ede7f8" stroke="#8a6ac5" stroke-width="6"/>
  <path d="M110 620h680M450 340v620M110 790h340" stroke="#4c2b91" stroke-width="8"/>
  <text x="90" y="1080" font-family="Arial" font-size="34" fill="#e85d12">Только для локального теста</text>
</svg>`;

test.beforeEach(async ({ page }) => {
  await page.route('**/queue-offers-data.js*', (route) => route.fulfill({ status: 200, contentType: 'text/javascript', body: queueScript }));
  await page.route('**/media/queue/fixture.svg', (route) => route.fulfill({ status: 200, contentType: 'image/svg+xml', body: image }));
  await page.goto('/');
  await expect(page.locator('body')).toHaveClass(/queue-catalog-mode/);
});

test('filters select one matching option and card can switch variants', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name.includes('mobile'), 'Desktop interaction is covered separately from the mobile drawer.');
  await expect(page.getByText('Найдено квартир: 1')).toBeVisible();
  await page.locator('[data-program="family"]').click();
  await expect(page.locator('#family-category-filter')).toBeVisible();
  await expect(page.locator('#children-category')).toHaveValue('any');
  await page.locator('#children-category').selectOption('3');
  await page.locator('[data-action="rate_subsidy"]').click();
  await page.locator('[data-action="partial_down_payment"]').click();
  await page.locator('[data-action="renovation_gift"]').click();
  await expect(page.getByText('Найдено квартир: 1')).toBeVisible();
  await expect(page.locator('.queue-offer-card')).toHaveAttribute('data-option-id', 'family-3');
  await expect(page.locator('.queue-offer-card')).toContainText('30 000 ₽');
  await page.locator('.queue-offer-card [data-offer-variant]').selectOption('family-1');
  await expect(page.locator('.queue-offer-card')).toHaveAttribute('data-option-id', 'family-1');
  await expect(page.locator('.queue-offer-card')).toContainText('от 42 000 ₽');
  if (process.env.CAPTURE_VISUALS) {
    await page.screenshot({ path: 'test-results/queue-catalog-desktop.png', fullPage: true });
  }
  await page.locator('[data-open-offer]').click();
  await expect(page.locator('#modal-purchase-options')).toContainText('Семейная ипотека');
  await expect(page.locator('#modal-purchase-options')).toContainText('Период ставки');
  const downloadPromise = page.waitForEvent('download');
  await page.locator('#modal-download').click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toContain('family-1');
});

test('financial conditions are not combined across variants', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name.includes('mobile'), 'Range acceptance is viewport-independent.');
  await page.locator('[data-range="downPayment"][data-side="max"]').fill('100000');
  await page.locator('[data-range="payment"][data-side="max"]').fill('30000');
  await expect(page.getByText('Найдено квартир: 0')).toBeVisible();
});

test('mobile filter drawer and single-column card fit the viewport', async ({ page }, testInfo) => {
  test.skip(!testInfo.project.name.includes('mobile'), 'Mobile-only layout check.');
  await page.locator('#mobile-filter-open').click();
  await expect(page.locator('#filters-panel')).toHaveClass(/is-mobile-open/);
  await page.locator('[data-program="family"]').click();
  await page.locator('#children-category').selectOption('3');
  await page.locator('#mobile-apply').click();
  await expect(page.locator('#filters-panel')).not.toHaveClass(/is-mobile-open/);
  if (process.env.CAPTURE_VISUALS) await page.waitForTimeout(250);
  const dimensions = await page.evaluate(() => ({ scrollWidth: document.documentElement.scrollWidth, width: innerWidth }));
  expect(dimensions.scrollWidth).toBeLessThanOrEqual(dimensions.width + 1);
  await expect(page.locator('.queue-offer-card')).toBeVisible();
  if (process.env.CAPTURE_VISUALS) {
    await page.screenshot({ path: 'test-results/queue-catalog-mobile.png', fullPage: true });
  }
});
