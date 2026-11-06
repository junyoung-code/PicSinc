import { defineConfig } from '@playwright/test';
export default defineConfig({ testDir: 'tests/e2e', testMatch: ['merge-ui.spec.ts', 'home.spec.ts'], workers: 1, timeout: 90_000, outputDir: 'private/merge-ui-20261106/traces', reporter: 'list', use: { baseURL: process.env.MERGE_BASE_URL ?? 'http://127.0.0.1:3126', channel: 'chrome', screenshot: 'only-on-failure', trace: 'retain-on-failure' } });
