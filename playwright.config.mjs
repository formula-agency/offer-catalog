import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './test/e2e',
  timeout: 30_000,
  use: {
    baseURL: 'http://127.0.0.1:4173',
    locale: 'ru-RU',
    timezoneId: 'Asia/Yekaterinburg',
    screenshot: 'only-on-failure'
  },
  webServer: {
    command: 'node test/e2e-server.mjs',
    url: 'http://127.0.0.1:4173',
    reuseExistingServer: false
  },
  projects: [
    { name: 'desktop-chromium', use: { browserName: 'chromium', viewport: { width: 1440, height: 1000 } } },
    { name: 'mobile-chromium', use: { browserName: 'chromium', viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true } }
  ]
});
