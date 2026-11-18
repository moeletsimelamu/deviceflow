import { randomBytes } from 'node:crypto';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { defineConfig, devices } from '@playwright/test';

/*
 * End-to-end tests (Phase 7). Two ways to run them:
 *
 * 1. Own stack (the default, used locally and in CI's e2e job):
 *      npm run test:e2e
 *    Playwright starts its own API (port 3100) and web app (port 4173) against a
 *    separate database, `<your database>_e2e`, which is dropped, migrated and seeded
 *    with the demo data on every run. Your development database is never touched.
 *    The demo users get a random password made for the run, so no credential is
 *    stored anywhere.
 *
 * 2. A running stack, for example the Docker Compose demo behind nginx:
 *      E2E_BASE_URL=http://localhost:8080 npm run test:e2e
 *    The stack must already hold the demo data (`docker compose --profile demo run
 *    --rm seed`); the tests sign in with SEED_DEFAULT_PASSWORD. Each run adds its
 *    own uniquely named records, so it can be repeated.
 */

const root = path.resolve(import.meta.dirname, '..');
// Values already in the environment win over the file.
if (existsSync(path.join(root, '.env'))) process.loadEnvFile(path.join(root, '.env'));

const external = process.env.E2E_BASE_URL;
const API_PORT = 3100;
const WEB_PORT = 4173;
const baseURL = external ?? `http://localhost:${WEB_PORT}`;

function e2eDatabaseUrl(): string {
  if (process.env.E2E_DATABASE_URL) return process.env.E2E_DATABASE_URL;
  const dev = process.env.DATABASE_URL;
  if (!dev) throw new Error('Set DATABASE_URL (or E2E_DATABASE_URL) before running the e2e tests.');
  const url = new URL(dev);
  url.pathname = `${url.pathname.replace(/^\//, '')}_e2e`;
  return url.toString();
}

if (external) {
  process.env.E2E_PASSWORD ??= process.env.SEED_DEFAULT_PASSWORD;
} else {
  // Made once in the runner; workers inherit it through the environment.
  process.env.E2E_PASSWORD ??= randomBytes(18).toString('base64url');
}

export default defineConfig({
  testDir: './tests',
  // The flows share one database and build on each other's records.
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: 0,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  reporter: process.env.CI
    ? [['list'], ['html', { open: 'never' }], ['github']]
    : [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    locale: 'en-ZA',
    timezoneId: 'Africa/Johannesburg',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: external
    ? undefined
    : [
        {
          name: 'api',
          // Rebuild the e2e database, then start the API from source.
          command:
            'npx tsx ../../e2e/scripts/prepare-db.ts && node --conditions=source --import tsx src/server.ts',
          cwd: path.join(root, 'apps/api'),
          url: `http://localhost:${API_PORT}/health/ready`,
          reuseExistingServer: false,
          timeout: 240_000,
          env: {
            NODE_ENV: 'development',
            PORT: String(API_PORT),
            DATABASE_URL: e2eDatabaseUrl(),
            ALLOWED_ORIGINS: baseURL,
            COOKIE_SECURE: 'false',
            TRUST_PROXY: '0',
            LOG_LEVEL: 'warn',
            // Every test signs in several times from the same address.
            LOGIN_RATE_LIMIT_MAX: '200',
            SEED_DEFAULT_PASSWORD: process.env.E2E_PASSWORD!,
          },
        },
        {
          name: 'web',
          command: `npx vite --port ${WEB_PORT} --strictPort`,
          cwd: path.join(root, 'apps/web'),
          url: baseURL,
          reuseExistingServer: false,
          timeout: 120_000,
          env: { API_PROXY_TARGET: `http://localhost:${API_PORT}` },
        },
      ],
});
