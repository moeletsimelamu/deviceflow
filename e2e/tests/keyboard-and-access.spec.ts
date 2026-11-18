import { expect, test } from '@playwright/test';
import { PORTAL_CUSTOMER, USERS, dialog, signIn, unique } from './support';

/*
 * Keyboard use, and what each role can reach in the browser. The API enforces
 * permissions on its own (apps/api/test/integration/authz-matrix.test.ts); these
 * tests check that the screens agree with it.
 */

test.describe('keyboard', () => {
  test('signing in needs only the keyboard', async ({ page }) => {
    await page.goto('/login');
    await page.getByLabel('Email').focus();
    await page.keyboard.type(USERS.admin);
    await page.keyboard.press('Tab');
    await expect(page.getByLabel('Password')).toBeFocused();
    await page.keyboard.type(process.env.E2E_PASSWORD!);
    await page.keyboard.press('Enter');
    await expect(page).not.toHaveURL(/\/login/);
  });

  test('the skip link moves focus past the navigation', async ({ page }) => {
    await signIn(page, USERS.admin);
    await page.goto('/assets');
    await expect(page.getByRole('heading', { name: 'Assets', level: 1 })).toBeVisible();
    await page.keyboard.press('Tab');
    const skip = page.getByRole('link', { name: 'Skip to content' });
    await expect(skip).toBeFocused();
    await expect(skip).toBeVisible();
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/#main$/);
    // The next Tab lands inside the page content, not the sidebar.
    await page.keyboard.press('Tab');
    const inMain = await page.evaluate(
      () => document.getElementById('main')?.contains(document.activeElement) ?? false,
    );
    expect(inMain).toBe(true);
  });

  test('dialogs keep focus inside, close with Escape and return focus', async ({ page }) => {
    await signIn(page, USERS.admin);
    await page.goto('/assets');
    const opener = page.getByRole('button', { name: 'Register asset' });
    await opener.click();
    const form = dialog(page, /Register/);
    await expect(form).toBeVisible();
    // Tab through more controls than the dialog has: focus must never leave it.
    for (let i = 0; i < 25; i++) {
      await page.keyboard.press('Tab');
      const inside = await form.evaluate((el) => el.contains(document.activeElement));
      expect(inside, `focus after ${i + 1} tabs`).toBe(true);
    }
    await page.keyboard.press('Escape');
    await expect(form).toBeHidden();
    await expect(opener).toBeFocused();
  });

  test('form errors are announced and linked to their fields', async ({ page }) => {
    await signIn(page, USERS.admin);
    await page.goto('/assets');
    await page.getByRole('button', { name: 'Register asset' }).click();
    const form = dialog(page, /Register/);
    await form.getByRole('button', { name: 'Register asset' }).click();
    const manufacturer = form.getByLabel('Manufacturer');
    await expect(manufacturer).toHaveAttribute('aria-invalid', 'true');
    // The message is the field's accessible description, so screen readers read it.
    await expect(manufacturer).toHaveAccessibleDescription(/.+/);
  });
});

test.describe('what each role can reach', () => {
  test('a technician sees no administration and cannot open it by address', async ({ page }) => {
    await signIn(page, USERS.technician);
    const nav = page.getByRole('navigation', { name: 'Main' });
    await expect(nav.getByRole('link', { name: 'Repairs' })).toBeVisible();
    for (const hidden of ['Customers', 'Users', 'Activity', 'Reports']) {
      await expect(nav.getByRole('link', { name: hidden })).toHaveCount(0);
    }
    // No empty section headings either ("Insights" holds only Reports).
    await expect(nav.getByText('Insights')).toHaveCount(0);
    await page.goto('/admin/users');
    await expect(page.getByRole('heading', { name: 'Users' })).toHaveCount(0);
    await expect(page.getByText("You don't have access to this page")).toBeVisible();
  });

  test('a customer is kept to the portal', async ({ page }) => {
    await signIn(page, USERS.customer);
    await expect(page).toHaveURL(/\/portal/);
    for (const path of ['/', '/repairs', '/admin/users', '/inventory']) {
      await page.goto(path);
      await expect(page, path).toHaveURL(/\/portal/);
    }
  });

  test('a signed-out visitor is sent to sign in', async ({ page }) => {
    for (const path of ['/', '/repairs', '/portal']) {
      await page.goto(path);
      await expect(page, path).toHaveURL(/\/login/);
    }
  });
});

test('a customer requests a repair in the portal and staff receive it', async ({ browser }) => {
  // The device is registered for the customer first, so the run does not depend
  // on which seeded devices are free.
  const serial = unique('PRT');
  const admin = await browser.newPage();
  await signIn(admin, USERS.admin);
  const customers = await admin.request.get(
    `/api/v1/customers/lookup?search=${encodeURIComponent('Parktown')}`,
  );
  expect(customers.status()).toBe(200);
  const account = (await customers.json()).data.find(
    (c: { name: string }) => c.name === PORTAL_CUSTOMER,
  );
  const created = await admin.request.post('/api/v1/assets', {
    headers: { 'X-Requested-With': 'DeviceFlow' },
    data: {
      category: 'TABLET',
      condition: 'GOOD',
      manufacturer: 'Apple',
      model: 'iPad (10th generation)',
      serialNumber: serial,
      customerAccountId: account.id,
      status: 'ACTIVE',
    },
  });
  expect(created.status()).toBe(201);
  const assetTag: string = (await created.json()).data.assetTag;

  const customer = await browser.newPage();
  await signIn(customer, USERS.customer);
  await customer.goto('/portal/repairs');
  await customer.getByRole('button', { name: 'Request a repair' }).click();
  const form = customer.getByRole('dialog');
  const device = form.getByLabel('Device');
  const option = device.locator('option', { hasText: assetTag });
  await device.selectOption((await option.getAttribute('value'))!);
  await form.getByLabel('What is wrong?').fill(`Cracked screen on ${serial}`);
  await form.getByRole('button', { name: 'Send request' }).click();
  await expect(form).toBeHidden();
  await expect(customer.getByText(`Cracked screen on ${serial}`).first()).toBeVisible();

  // Staff see the new request waiting to be assigned.
  await admin.goto('/repairs');
  await admin.getByRole('searchbox', { name: 'Search repairs' }).fill(assetTag);
  const row = admin.getByRole('row').filter({ hasText: assetTag });
  await expect(row).toHaveCount(1);
  await expect(row).toContainText(PORTAL_CUSTOMER);
  await expect(row).toContainText('Submitted');
  await expect(row).toContainText('Unassigned');
  await admin.context().close();
  await customer.context().close();
});
