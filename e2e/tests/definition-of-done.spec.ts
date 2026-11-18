import { expect, test } from '@playwright/test';
import {
  PORTAL_CUSTOMER,
  TECHNICIAN_NAME,
  USERS,
  dialog,
  reportFigures,
  sessionFor,
  signIn,
  unique,
} from './support';

/*
 * The definition of done from the project brief, walked through in the browser
 * by the people who would really do each step:
 *
 *   1. Start the application              (Playwright starts it, or E2E_BASE_URL)
 *   2. Log in with documented credentials (the seeded demo users)
 *   3. Register an asset                  (administrator)
 *   4. Create a repair request            (administrator books the device in)
 *   5. Assign a technician                (administrator)
 *   6. Create and approve a quotation     (technician quotes, customer approves in the portal)
 *   7. Complete a repair                  (technician)
 *   8. Record inventory consumption       (technician uses a part on the job)
 *   9. View the resulting activity and reporting (administrator, inventory manager)
 *  10. Run automated tests                (this file, and `npm test`)
 */

test('definition of done: from a new device to a completed, reported repair', async ({
  browser,
  page,
}) => {
  test.setTimeout(240_000);
  const serial = unique('E2E');
  const fault = `Screen stays black after the logo (${serial})`;
  let repairUrl = '';
  let reference = '';
  let before: Awaited<ReturnType<typeof reportFigures>>;

  await test.step('1. the application is running', async () => {
    await page.goto('/login');
    await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible();
  });

  await test.step('2. the administrator signs in with the documented demo account', async () => {
    await signIn(page, USERS.admin);
    await expect(page.getByRole('navigation').first()).toBeVisible();
    // Report figures before this run's repair, to check exactly what it adds.
    before = await reportFigures(page);
  });

  await test.step('3. register an asset for a customer', async () => {
    await page.goto('/assets');
    await page.getByRole('button', { name: 'Register asset' }).click();
    const form = dialog(page, /Register/);
    await form.getByLabel('Category').selectOption({ label: 'Laptop' });
    await form.getByLabel('Manufacturer').fill('Dell');
    await form.getByLabel('Model').fill('Latitude 5440');
    await form.getByLabel('Serial number').fill(serial);
    await form.getByRole('combobox', { name: 'Customer' }).fill('Parktown');
    await page.getByRole('option', { name: new RegExp(PORTAL_CUSTOMER) }).click();
    await form.getByRole('button', { name: 'Register asset' }).click();

    await expect(page).toHaveURL(/\/assets\/[0-9a-f-]{36}$/);
    await expect(page.getByText(serial)).toBeVisible();
    await expect(page.getByText(PORTAL_CUSTOMER).first()).toBeVisible();
  });

  await test.step('4. book the device in for repair', async () => {
    await page.goto('/repairs');
    await page.getByRole('button', { name: 'Book in a repair' }).click();
    const form = dialog(page, 'Book a device in for repair');
    await form.getByRole('combobox', { name: 'Device' }).fill(serial);
    await page.getByRole('option', { name: new RegExp(serial) }).click();
    await form.getByLabel('Fault reported').fill(fault);
    await form.getByRole('button', { name: 'Book in' }).click();

    await expect(page).toHaveURL(/\/repairs\/[0-9a-f-]{36}$/);
    repairUrl = new URL(page.url()).pathname;
    reference = (await page.getByRole('heading', { level: 1 }).textContent())!.trim();
    expect(reference).toMatch(/^RJ-/);
    await expect(page.getByText('Submitted', { exact: true }).first()).toBeVisible();
  });

  await test.step('5. assign a technician', async () => {
    await page.getByRole('button', { name: 'Assign technician' }).click();
    const form = dialog(page, `Assign ${reference}`);
    // Options read "Sipho Dlamini (2 open jobs)", so pick by the name.
    const select = form.getByLabel('Technician');
    await expect(select).toBeEnabled();
    const option = select.locator('option', { hasText: TECHNICIAN_NAME });
    await select.selectOption((await option.getAttribute('value'))!);
    await form.getByRole('button', { name: 'Assign' }).click();
    await expect(form).toBeHidden();
    await expect(page.getByText('Assigned', { exact: true }).first()).toBeVisible();
    await expect(page.getByText(TECHNICIAN_NAME).first()).toBeVisible();
  });

  const technician = await sessionFor(browser, USERS.technician);

  await test.step('6a. the technician diagnoses the fault and quotes', async () => {
    await technician.goto(repairUrl);
    await technician.getByRole('button', { name: 'Start diagnosis' }).click();
    await dialog(technician, /Start diagnosis/)
      .getByRole('button', { name: 'Start diagnosis' })
      .click();
    await expect(technician.getByText('Diagnosing', { exact: true }).first()).toBeVisible();

    await technician.getByRole('button', { name: 'New quotation' }).click();
    const editor = dialog(technician, 'New quotation');
    // A new quotation starts with a labour line and a part line.
    const labour = editor.getByRole('group', { name: 'Line 1', exact: true });
    await labour.getByLabel('Description').fill('Replace display cable');
    await labour.getByLabel('Hours').fill('1');
    await labour.getByLabel('Unit price (R)').fill('850');
    const part = editor.getByRole('group', { name: 'Line 2', exact: true });
    await part.getByLabel('Description').fill('512 GB NVMe SSD');
    await part.getByLabel('Qty').fill('1');
    await part.getByLabel('Unit price (R)').fill('1150');
    // R2 000.00 excl. VAT, R300.00 VAT.
    await expect(editor.getByText('R 2 000,00')).toBeVisible();
    await editor.getByRole('button', { name: 'Save draft' }).click();
    await expect(editor).toBeHidden();

    await technician.getByRole('button', { name: 'Issue to customer' }).click();
    await technician.getByRole('dialog').getByRole('button', { name: 'Issue quotation' }).click();
    await expect(technician.getByText('Awaiting approval', { exact: true }).first()).toBeVisible();
  });

  await test.step('6b. the customer approves the quotation in the portal', async () => {
    const customer = await sessionFor(browser, USERS.customer);
    await expect(customer).toHaveURL(/\/portal/);
    await customer.goto('/portal/repairs');
    await customer.getByRole('link', { name: reference }).click();
    await customer.getByRole('button', { name: /^Approve/ }).click();
    await customer.getByRole('dialog').getByRole('button', { name: 'Approve quotation' }).click();
    await expect(customer.getByText('Approved', { exact: true }).first()).toBeVisible();
    await customer.context().close();
  });

  await test.step('7 and 8. the technician repairs the device, using a part from stock', async () => {
    await technician.reload();
    await technician.getByRole('button', { name: 'Start repair' }).click();
    await dialog(technician, /Start repair/)
      .getByRole('button', { name: 'Start repair' })
      .click();
    await expect(technician.getByText('In repair', { exact: true }).first()).toBeVisible();

    // 8. Inventory consumption: one SSD from stock, recorded against the job.
    await technician.getByRole('button', { name: 'Use part' }).click();
    const use = dialog(technician, `Use a part on ${reference}`);
    await use.getByRole('combobox').fill('SSD-NVME');
    await technician.getByRole('option', { name: /512 GB NVMe SSD/ }).click();
    await use.getByLabel('Units used').fill('1');
    await use.getByRole('button', { name: 'Use part' }).click();
    await expect(use).toBeHidden();
    await expect(technician.getByText('512 GB NVMe SSD (M.2 2280)').first()).toBeVisible();

    // Time spent, needed before quality check.
    await technician.getByRole('button', { name: 'Record time' }).click();
    const time = dialog(technician, `Record time on ${reference}`);
    await time.getByLabel('Hours').fill('1');
    await time.getByLabel('Minutes').fill('30');
    await time.getByLabel('Work done').fill('Replaced the display cable and the SSD');
    await time.getByRole('button', { name: 'Record time' }).click();
    await expect(time).toBeHidden();

    await technician.getByRole('button', { name: 'Send to quality check' }).click();
    await dialog(technician, /Send to quality check/)
      .getByRole('button', { name: 'Send to quality check' })
      .click();
    await expect(technician.getByText('Quality check', { exact: true }).first()).toBeVisible();

    // 7. Completion.
    await technician.getByRole('button', { name: 'Mark completed' }).click();
    const complete = dialog(technician, /Mark completed/);
    await complete
      .getByLabel('Completion summary')
      .fill('Display cable and SSD replaced; tested for 30 minutes.');
    await complete.getByRole('button', { name: 'Mark completed' }).click();
    await expect(technician.getByText('Completed', { exact: true }).first()).toBeVisible();
    await technician.context().close();
  });

  await test.step('9a. the activity log shows what happened, and who did it', async () => {
    await page.goto(repairUrl);
    await expect(page.getByText('Completed', { exact: true }).first()).toBeVisible();
    // Every move, in order, newest first, each with who made it.
    const history = page.getByRole('region', { name: 'Status history' }).getByRole('listitem');
    await expect(history).toHaveCount(8);
    const moves = [
      'Quality check → Completed',
      'In repair → Quality check',
      'Approved → In repair',
      'Awaiting approval → Approved',
      'Diagnosing → Awaiting approval',
      'Assigned → Diagnosing',
      'Submitted → Assigned',
    ];
    for (const [i, move] of moves.entries()) {
      await expect(history.nth(i)).toContainText(move);
    }

    await page.goto('/admin/activity');
    await expect(page.getByText(reference).first()).toBeVisible();
    await expect(page.getByText(TECHNICIAN_NAME).first()).toBeVisible();
  });

  await test.step('9b. reports include the completed job, its revenue and the part used', async () => {
    // Exactly what this repair adds: one completed job, R2 000.00 excl. VAT billed
    // (the approved quotation), and one part used.
    const after = await reportFigures(page);
    expect(after.completedJobs - before.completedJobs).toBe(1);
    expect(after.revenueCents - before.revenueCents).toBe(200_000);
    expect(after.partsUsed - before.partsUsed).toBe(1);

    // And the reports page shows those figures in its headline tiles (the first
    // mention of each label; the charts below repeat them).
    await page.goto('/reports');
    const revenue = page
      .getByRole('region', { name: 'Repairs and revenue' })
      .getByText('Billed revenue (excl. VAT)', { exact: true })
      .first()
      .locator('..');
    await expect(revenue).toContainText(
      new Intl.NumberFormat('en-ZA', { style: 'currency', currency: 'ZAR' }).format(
        after.revenueCents / 100,
      ),
    );
    const completed = page
      .getByRole('region', { name: 'Repairs and revenue' })
      .getByText('Jobs completed', { exact: true })
      .first()
      .locator('..');
    await expect(completed).toContainText(String(after.completedJobs));

    const manager = await sessionFor(browser, USERS.inventoryManager);
    await manager.goto('/reports');
    await expect(manager.getByText('512 GB NVMe SSD (M.2 2280)').first()).toBeVisible();
    await manager.goto('/inventory/movements');
    await expect(manager.getByText(reference).first()).toBeVisible();
    await manager.context().close();
  });
});
