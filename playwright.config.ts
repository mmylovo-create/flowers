// Browser checks on a phone and a desktop against the production build (with the real
// service worker) and the local backend. On a machine where Playwright cannot download
// its own browser, point PW_CHROMIUM_PATH at any Chromium binary.
import { defineConfig, devices } from '@playwright/test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ANON_KEY, BACKEND_URL } from './dev/keys.ts';

const exe = process.env.PW_CHROMIUM_PATH;
const launchOptions = exe
  ? { executablePath: exe, args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] }
  : {};
const BASE = process.env.E2E_BASE_URL ?? 'http://localhost:4173';
const local = !process.env.E2E_BASE_URL;

export default defineConfig({
  testDir: 'tests/e2e',
  workers: 1,
  fullyParallel: false,
  timeout: 90_000,
  expect: { timeout: 10_000 },
  reporter: [['list']],
  use: { baseURL: BASE, launchOptions, trace: 'retain-on-failure', locale: 'ru-RU', timezoneId: 'Europe/Moscow' },
  projects: [
    { name: 'phone', use: { ...devices['iPhone 13'], browserName: 'chromium' } },
    { name: 'desktop', use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 860 } } },
  ],
  webServer: local
    ? [
        {
          command: 'pnpm exec tsx dev/backend.ts',
          url: `${BACKEND_URL}/health`,
          env: { BACKEND_DATA: mkdtempSync(join(tmpdir(), 'flowers-e2e-')) },
          reuseExistingServer: false,
          timeout: 120_000,
        },
        {
          command: 'pnpm build && pnpm exec vite preview --port 4173 --strictPort',
          url: 'http://localhost:4173/s/demo/',
          env: { VITE_SUPABASE_URL: BACKEND_URL, VITE_SUPABASE_ANON_KEY: ANON_KEY, VITE_TELEGRAM_BOT: 'flowers_local_bot' },
          reuseExistingServer: false,
          timeout: 300_000,
        },
      ]
    : undefined,
});
