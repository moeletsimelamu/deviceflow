import { expect, type Browser, type Page } from '@playwright/test';

/** Demo users created by apps/api/prisma/seed.ts (documented in the README). */
export const USERS = {
  admin: 'admin@deviceflow.test',
  technician: 'tech@deviceflow.test',
  inventoryManager: 'inventory@deviceflow.test',
  customer: 'portal@deviceflow.test',
} as const;

/** The seeded organisation the demo portal user belongs to. */
export const PORTAL_CUSTOMER = 'Parktown Primary School';
/** The seeded technician behind tech@deviceflow.test. */
export const TECHNICIAN_NAME = 'Sipho Dlamini';

function password(): string {
  const value = process.env.E2E_PASSWORD;
  if (!value) throw new Error('E2E_PASSWORD is not set (see e2e/playwright.config.ts).');
  return value;
}

/** Signs in on the sign-in page and waits until the app has left it. */
export async function signIn(page: Page, email: string) {
  await page.goto('/login');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(password());
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).not.toHaveURL(/\/login/);
}

/** A separate browser session (its own cookies) signed in as the user. */
export async function sessionFor(browser: Browser, email: string): Promise<Page> {
  const context = await browser.newContext();
  const page = await context.newPage();
  await signIn(page, email);
  return page;
}

/** A value unique to this run, so tests can be repeated against the same database. */
export function unique(prefix: string): string {
  return `${prefix}${Date.now().toString(36).toUpperCase()}${Math.floor(Math.random() * 1296)
    .toString(36)
    .toUpperCase()}`;
}

/**
 * The report figures the definition-of-done flow changes, read through the API
 * with the page's session (an administrator's), for the default range (last 30 days).
 */
export async function reportFigures(page: Page) {
  const [operations, inventory] = await Promise.all([
    page.request.get('/api/v1/reports/operations'),
    page.request.get('/api/v1/reports/inventory'),
  ]);
  expect(operations.status()).toBe(200);
  expect(inventory.status()).toBe(200);
  const ops = (await operations.json()).data;
  const inv = (await inventory.json()).data;
  return {
    completedJobs: ops.jobs.completed as number,
    revenueCents: ops.revenue.subtotalCents as number,
    partsUsed: inv.consumption.units as number,
  };
}

/** The open dialog with this title. */
export function dialog(page: Page, title: string | RegExp) {
  return page.getByRole('dialog', { name: title });
}
