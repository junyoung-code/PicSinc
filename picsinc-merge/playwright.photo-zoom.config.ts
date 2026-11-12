import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: 'tests/e2e', testMatch: 'retouch-photo-zoom.spec.ts', workers: 1, timeout: 60_000,
  outputDir: 'private/photo-zoom-mobile', reporter: 'list',
  use: { baseURL: process.env.RETOUCH_BASE_URL ?? 'http://127.0.0.1:3162', screenshot: 'only-on-failure', trace: 'retain-on-failure' },
  projects: [
    { name: 'iPhone 13 WebKit', use: { ...devices['iPhone 13'], browserName: 'webkit' } },
    { name: 'iPhone SE WebKit', use: { ...devices['iPhone SE'], browserName: 'webkit' } },
    { name: 'Pixel 7 Chrome', use: { ...devices['Pixel 7'], browserName: 'chromium', channel: 'chrome' } },
    { name: 'Galaxy S9 Chrome', use: { ...devices['Galaxy S9+'], browserName: 'chromium', channel: 'chrome' } },
  ],
});
