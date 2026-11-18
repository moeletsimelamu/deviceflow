import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { USERS, signIn } from './support';

/*
 * Accessibility pass (Phase 7): every screen, as the role that uses it, scanned
 * with axe-core against WCAG 2.2 A and AA. Detail pages are reached by opening
 * the first record in their list, so the scans see real, seeded data.
 *
 * axe finds many, not all, accessibility problems (contrast, names, roles,
 * structure). Keyboard use (sign-in, skip link, dialog focus, error announcements)
 * is tested in keyboard-and-access.spec.ts.
 */

const WCAG = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22a', 'wcag22aa'];

async function expectNoViolations(page: Page, screen: string) {
  // Let loading skeletons settle so the scan sees the real content.
  await expect(page.getByRole('status', { name: /^Loading/ })).toHaveCount(0);
  const results = await new AxeBuilder({ page }).withTags(WCAG).analyze();
  const summary = results.violations.map((v) => ({
    rule: v.id,
    impact: v.impact,
    help: v.help,
    nodes: v.nodes.slice(0, 5).map((n) => ({
      target: n.target.join(' '),
      why: n.any[0]?.message ?? n.failureSummary,
    })),
  }));
  // Soft, so one run reports every screen's problems.
  expect.soft(summary, `${screen}: ${JSON.stringify(summary, null, 2)}`).toEqual([]);
}

/** Opens the first link in the page's main table, whose href matches. */
async function openFirst(page: Page, href: RegExp) {
  const link = page.getByRole('main').getByRole('link').filter({ hasText: /\S/ });
  const hrefs = await link.evaluateAll((els) => els.map((e) => e.getAttribute('href') ?? ''));
  const target = hrefs.find((h) => href.test(h));
  expect(target, `a link matching ${href}`).toBeTruthy();
  await page.goto(target!);
}

test('sign-in page', async ({ page }) => {
  await page.goto('/login');
  await expectNoViolations(page, 'sign-in');
});

test('administrator screens', async ({ page }) => {
  test.setTimeout(180_000);
  await signIn(page, USERS.admin);
  const screens: Array<[string, string, RegExp?]> = [
    ['dashboard', '/'],
    ['repairs', '/repairs', /^\/repairs\/[0-9a-f-]{36}$/],
    ['assets', '/assets', /^\/assets\/[0-9a-f-]{36}$/],
    ['customers', '/customers', /^\/customers\/[0-9a-f-]{36}$/],
    ['inventory', '/inventory', /^\/inventory\/parts\/[0-9a-f-]{36}$/],
    ['stock movements', '/inventory/movements'],
    ['reports', '/reports'],
    ['activity', '/admin/activity'],
    ['users', '/admin/users'],
    ['settings', '/admin/settings'],
    ['page not found', '/no-such-page'],
  ];
  for (const [name, path, detail] of screens) {
    await page.goto(path);
    await expectNoViolations(page, name);
    if (detail) {
      await openFirst(page, detail);
      await expectNoViolations(page, `${name}: detail`);
    }
  }
});

test('technician screens', async ({ page }) => {
  await signIn(page, USERS.technician);
  await page.goto('/');
  await expectNoViolations(page, 'technician dashboard');
  await page.goto('/repairs');
  await expectNoViolations(page, 'technician repairs');
  await openFirst(page, /^\/repairs\/[0-9a-f-]{36}$/);
  await expectNoViolations(page, 'technician repair detail');
});

test('inventory manager screens', async ({ page }) => {
  await signIn(page, USERS.inventoryManager);
  for (const path of ['/', '/inventory', '/reports']) {
    await page.goto(path);
    await expectNoViolations(page, `inventory manager ${path}`);
  }
});

test('customer portal screens', async ({ page }) => {
  await signIn(page, USERS.customer);
  await page.goto('/portal');
  await expectNoViolations(page, 'portal devices');
  await openFirst(page, /^\/portal\/devices\/[0-9a-f-]{36}$/);
  await expectNoViolations(page, 'portal device');
  await page.goto('/portal/repairs');
  await expectNoViolations(page, 'portal repairs');
  await openFirst(page, /^\/portal\/repairs\/[0-9a-f-]{36}$/);
  await expectNoViolations(page, 'portal repair');
});

test('dialogs', async ({ page }) => {
  await signIn(page, USERS.admin);
  await page.goto('/assets');
  await page.getByRole('button', { name: 'Register asset' }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await expectNoViolations(page, 'register asset dialog');
  await page.keyboard.press('Escape');
  await page.goto('/repairs');
  await page.getByRole('button', { name: 'Book in a repair' }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await expectNoViolations(page, 'book in dialog');
});
