import { beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '../../src/lib/prisma.js';
import { createAsset, createCustomerAccount, loginAs, resetDatabase } from '../helpers/db.js';

beforeEach(resetDatabase);

const laptop = {
  category: 'LAPTOP',
  manufacturer: 'Dell',
  model: 'Latitude 5440',
  serialNumber: ' 7xk2 9p3 ',
  condition: 'GOOD',
  purchaseDate: '2025-02-10',
  warrantyExpiresOn: '2028-02-10',
};

describe('asset register: access', () => {
  it.each(['TECHNICIAN', 'INVENTORY_MANAGER'] as const)(
    '%s can read assets but not register, change or export them',
    async (role) => {
      const admin = await loginAs('ADMIN');
      const asset = await createAsset(admin.user.id);
      const c = await loginAs(role);

      expect((await c.get('/api/v1/assets')).status).toBe(200);
      expect((await c.get(`/api/v1/assets/${asset.id}`)).status).toBe(200);
      expect((await c.post('/api/v1/assets').send(laptop)).status).toBe(403);
      expect(
        (await c.patch(`/api/v1/assets/${asset.id}`).send({ model: 'X', version: 0 })).status,
      ).toBe(403);
      expect(
        (
          await c
            .post(`/api/v1/assets/${asset.id}/status`)
            .send({ status: 'REFURBISHING', version: 0 })
        ).status,
      ).toBe(403);
      expect((await c.get('/api/v1/assets/export.csv')).status).toBe(403);
    },
  );

  it('customers cannot use the staff asset endpoints', async () => {
    const account = await createCustomerAccount();
    const c = await loginAs('CUSTOMER', { customerAccountId: account.id });
    expect((await c.get('/api/v1/assets')).status).toBe(403);
  });

  it('requires sign-in', async () => {
    const { client } = await import('../helpers/db.js');
    expect((await client().get('/api/v1/assets')).status).toBe(401);
  });
});

describe('registering assets', () => {
  it('generates a DF-YYYY-NNNNNN tag, normalises the serial, records history and audit', async () => {
    const admin = await loginAs('ADMIN');
    const res = await admin.post('/api/v1/assets').send(laptop);

    expect(res.status).toBe(201);
    const year = new Date().getUTCFullYear();
    expect(res.body.data.assetTag).toMatch(new RegExp(`^DF-${year}-\\d{6,}$`));
    expect(res.body.data).toMatchObject({
      serialNumber: '7XK29P3',
      status: 'IN_STOCK',
      customer: null,
      purchaseDate: '2025-02-10',
      warrantyExpiresOn: '2028-02-10',
      createdBy: { id: admin.user.id },
    });

    const events = await prisma.assetEvent.findMany({ where: { assetId: res.body.data.id } });
    expect(events.map((e) => e.type)).toEqual(['REGISTERED']);
    const audit = await prisma.auditLog.findFirstOrThrow({ where: { action: 'asset.created' } });
    expect(audit.assetId).toBe(res.body.data.id);
  });

  it('registers an asset as active for a customer', async () => {
    const admin = await loginAs('ADMIN');
    const account = await createCustomerAccount({ name: 'Parktown Primary' });
    const res = await admin
      .post('/api/v1/assets')
      .send({ ...laptop, status: 'ACTIVE', customerAccountId: account.id });
    expect(res.status).toBe(201);
    expect(res.body.data.customer).toMatchObject({ id: account.id, name: 'Parktown Primary' });
    expect(res.body.data.status).toBe('ACTIVE');
  });

  it('rejects an active asset without a customer, and bad dates', async () => {
    const admin = await loginAs('ADMIN');
    const noCustomer = await admin.post('/api/v1/assets').send({ ...laptop, status: 'ACTIVE' });
    expect(noCustomer.status).toBe(400);
    expect(noCustomer.body.error.details[0].path).toBe('customerAccountId');

    const badDates = await admin
      .post('/api/v1/assets')
      .send({ ...laptop, purchaseDate: '2025-02-10', warrantyExpiresOn: '2024-01-01' });
    expect(badDates.status).toBe(400);
    expect(badDates.body.error.details[0].path).toBe('warrantyExpiresOn');

    const future = await admin
      .post('/api/v1/assets')
      .send({ ...laptop, purchaseDate: '2999-01-01', warrantyExpiresOn: null });
    expect(future.status).toBe(400);
  });

  it('refuses archived or unknown customers', async () => {
    const admin = await loginAs('ADMIN');
    const archived = await createCustomerAccount({ isActive: false });
    const res = await admin
      .post('/api/v1/assets')
      .send({ ...laptop, customerAccountId: archived.id });
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('CUSTOMER_ARCHIVED');

    const unknown = await admin
      .post('/api/v1/assets')
      .send({ ...laptop, customerAccountId: crypto.randomUUID() });
    expect(unknown.status).toBe(422);
    expect(await prisma.asset.count()).toBe(0);
  });
});

describe('duplicate serial numbers', () => {
  it('rejects the same serial for the same manufacturer, however it is typed', async () => {
    const admin = await loginAs('ADMIN');
    const first = await admin.post('/api/v1/assets').send(laptop);
    const dup = await admin
      .post('/api/v1/assets')
      .send({ ...laptop, manufacturer: ' DELL ', serialNumber: '7XK29P3' });

    expect(dup.status).toBe(409);
    expect(dup.body.error.code).toBe('SERIAL_TAKEN');
    expect(dup.body.error.message).toContain(first.body.data.assetTag);
    expect(dup.body.error.details[0].path).toBe('serialNumber');
    expect(await prisma.asset.count()).toBe(1);
    // Nothing from the failed attempt was kept.
    expect(await prisma.assetEvent.count()).toBe(1);
  });

  it('allows the same serial from a different manufacturer, and many assets without serials', async () => {
    const admin = await loginAs('ADMIN');
    expect((await admin.post('/api/v1/assets').send(laptop)).status).toBe(201);
    expect(
      (await admin.post('/api/v1/assets').send({ ...laptop, manufacturer: 'Lenovo' })).status,
    ).toBe(201);
    for (let i = 0; i < 2; i++) {
      const res = await admin.post('/api/v1/assets').send({ ...laptop, serialNumber: '' });
      expect(res.status).toBe(201);
      expect(res.body.data.serialNumber).toBeNull();
    }
  });

  it('only one of two simultaneous registrations of the same device succeeds', async () => {
    const admin = await loginAs('ADMIN');
    const results = await Promise.all(
      Array.from({ length: 5 }, () => admin.post('/api/v1/assets').send(laptop)),
    );
    const statuses = results.map((r) => r.status).sort();
    expect(statuses).toEqual([201, 409, 409, 409, 409]);
    expect(await prisma.asset.count()).toBe(1);
  });

  it('rejects an edit that would duplicate another asset’s serial', async () => {
    const admin = await loginAs('ADMIN');
    await admin.post('/api/v1/assets').send(laptop);
    const other = await admin.post('/api/v1/assets').send({ ...laptop, serialNumber: 'OTHER1' });
    const res = await admin
      .patch(`/api/v1/assets/${other.body.data.id}`)
      .send({ serialNumber: '7xk29p3', version: 0 });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('SERIAL_TAKEN');
  });
});

describe('editing and reassigning assets', () => {
  it('reassigns to another customer, recording a history event and audit', async () => {
    const admin = await loginAs('ADMIN');
    const a = await createCustomerAccount({ name: 'A School' });
    const b = await createCustomerAccount({ name: 'B School' });
    const asset = await createAsset(admin.user.id, { customerAccountId: a.id });

    const res = await admin
      .patch(`/api/v1/assets/${asset.id}`)
      .send({ customerAccountId: b.id, version: 0 });
    expect(res.status).toBe(200);
    expect(res.body.data.customer.id).toBe(b.id);

    const events = await admin.get(`/api/v1/assets/${asset.id}/events`);
    expect(events.body.data[0]).toMatchObject({
      type: 'CUSTOMER_CHANGED',
      fromCustomer: { id: a.id },
      toCustomer: { id: b.id },
      actor: { id: admin.user.id },
    });
    const audit = await prisma.auditLog.findFirstOrThrow({ where: { action: 'asset.reassigned' } });
    expect(audit.assetId).toBe(asset.id);
  });

  it('will not unassign an active asset', async () => {
    const admin = await loginAs('ADMIN');
    const a = await createCustomerAccount();
    const asset = await createAsset(admin.user.id, { customerAccountId: a.id, status: 'ACTIVE' });
    const res = await admin
      .patch(`/api/v1/assets/${asset.id}`)
      .send({ customerAccountId: null, version: 0 });
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('CUSTOMER_REQUIRED');
  });

  it('checks dates against the stored values', async () => {
    const admin = await loginAs('ADMIN');
    const created = await admin.post('/api/v1/assets').send(laptop);
    const res = await admin
      .patch(`/api/v1/assets/${created.body.data.id}`)
      .send({ warrantyExpiresOn: '2020-01-01', version: 0 });
    expect(res.status).toBe(422);
    expect(res.body.error.details[0].path).toBe('warrantyExpiresOn');
  });

  it('rejects a stale version', async () => {
    const admin = await loginAs('ADMIN');
    const asset = await createAsset(admin.user.id);
    await admin.patch(`/api/v1/assets/${asset.id}`).send({ model: 'Latitude 7450', version: 0 });
    const stale = await admin
      .patch(`/api/v1/assets/${asset.id}`)
      .send({ model: 'Latitude 3000', version: 0 });
    expect(stale.status).toBe(409);
  });
});

describe('asset lifecycle', () => {
  it('follows allowed transitions and records each one', async () => {
    const admin = await loginAs('ADMIN');
    const a = await createCustomerAccount();
    const asset = await createAsset(admin.user.id, { customerAccountId: a.id, status: 'IN_STOCK' });
    const url = `/api/v1/assets/${asset.id}/status`;

    const move = async (step: { status: string; reason?: string }) => {
      const { version } = await prisma.asset.findUniqueOrThrow({ where: { id: asset.id } });
      const res = await admin.post(url).send({ ...step, version });
      expect(res.status, `${step.status}: ${JSON.stringify(res.body)}`).toBe(200);
      expect(res.body.data.status).toBe(step.status);
    };

    await move({ status: 'ACTIVE' });
    // Since Phase 4 the repair leg is driven by a repair job, not set by hand.
    const repair = await admin
      .post('/api/v1/repairs')
      .send({ assetId: asset.id, faultDescription: 'Cracked screen' });
    expect(repair.status).toBe(201);
    const cancelled = await admin
      .post(`/api/v1/repairs/${repair.body.data.id}/transitions`)
      .send({ to: 'CANCELLED', note: 'Customer withdrew the request', version: 0 });
    expect(cancelled.status).toBe(200);
    await move({ status: 'RETIRED', reason: 'Screen and board beyond economic repair' });
    await move({ status: 'DISPOSED', reason: 'Sent to certified e-waste recycler' });

    const events = await prisma.assetEvent.findMany({
      where: { assetId: asset.id, type: 'STATUS_CHANGED' },
      orderBy: { createdAt: 'asc' },
    });
    expect(events.map((e) => `${e.fromStatus}>${e.toStatus}`)).toEqual([
      'IN_STOCK>ACTIVE',
      'ACTIVE>IN_REPAIR',
      'IN_REPAIR>ACTIVE',
      'ACTIVE>RETIRED',
      'RETIRED>DISPOSED',
    ]);
    expect(events.at(-1)?.note).toBe('Sent to certified e-waste recycler');
  });

  it.each([
    ['IN_STOCK', 'DISPOSED'],
    ['IN_STOCK', 'IN_REPAIR'],
    ['RETIRED', 'ACTIVE'],
    ['DISPOSED', 'IN_STOCK'],
  ] as const)('rejects %s → %s', async (from, to) => {
    const admin = await loginAs('ADMIN');
    const a = await createCustomerAccount();
    const asset = await createAsset(admin.user.id, { customerAccountId: a.id, status: from });
    const res = await admin
      .post(`/api/v1/assets/${asset.id}/status`)
      .send({ status: to, reason: 'testing', version: 0 });
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('INVALID_TRANSITION');
    expect((await prisma.asset.findUniqueOrThrow({ where: { id: asset.id } })).status).toBe(from);
  });

  it('needs a customer before becoming active, and a reason to retire', async () => {
    const admin = await loginAs('ADMIN');
    const asset = await createAsset(admin.user.id, { status: 'IN_STOCK' });
    const url = `/api/v1/assets/${asset.id}/status`;

    const active = await admin.post(url).send({ status: 'ACTIVE', version: 0 });
    expect(active.status).toBe(422);
    expect(active.body.error.code).toBe('CUSTOMER_REQUIRED');

    const noReason = await admin.post(url).send({ status: 'RETIRED', version: 0 });
    expect(noReason.status).toBe(400);
    expect(noReason.body.error.details[0].path).toBe('reason');
  });

  it('two simultaneous status changes from the same version: one wins', async () => {
    const admin = await loginAs('ADMIN');
    const asset = await createAsset(admin.user.id, { status: 'IN_STOCK' });
    const url = `/api/v1/assets/${asset.id}/status`;
    const [r1, r2] = await Promise.all([
      admin.post(url).send({ status: 'REFURBISHING', version: 0 }),
      admin.post(url).send({ status: 'RETIRED', reason: 'Obsolete', version: 0 }),
    ]);
    expect([r1.status, r2.status].sort()).toEqual([200, 409]);
    expect(
      await prisma.assetEvent.count({ where: { assetId: asset.id, type: 'STATUS_CHANGED' } }),
    ).toBe(1);
  });

  it('the database blocks edits to history and an active asset without a customer', async () => {
    const admin = await loginAs('ADMIN');
    const asset = await createAsset(admin.user.id);
    await expect(
      prisma.assetEvent.updateMany({ where: { assetId: asset.id }, data: { note: 'changed' } }),
    ).rejects.toThrow(/append-only/);
    await expect(prisma.assetEvent.deleteMany({ where: { assetId: asset.id } })).rejects.toThrow(
      /append-only/,
    );
    await expect(
      prisma.asset.update({ where: { id: asset.id }, data: { status: 'ACTIVE' } }),
    ).rejects.toThrow();
  });
});

describe('listing assets', () => {
  it('searches, filters, sorts and paginates', async () => {
    const admin = await loginAs('ADMIN');
    const school = await createCustomerAccount({ name: 'Parktown Primary' });
    await createAsset(admin.user.id, {
      customerAccountId: school.id,
      model: 'Chromebook 3100',
      serialNumber: 'CB-0001',
    });
    await createAsset(admin.user.id, { manufacturer: 'HP', model: 'EliteBook 840' });
    await createAsset(admin.user.id, {
      manufacturer: 'Lenovo',
      model: 'ThinkPad T14',
      status: 'REFURBISHING',
    });

    const bySerial = await admin.get('/api/v1/assets?search=cb-0001');
    expect(bySerial.body.data.map((a: { model: string }) => a.model)).toEqual(['Chromebook 3100']);

    const byCustomerName = await admin.get('/api/v1/assets?search=parktown');
    expect(byCustomerName.body.meta.total).toBe(1);

    const unassigned = await admin.get('/api/v1/assets?customer=none&sort=manufacturer:asc');
    expect(unassigned.body.data.map((a: { manufacturer: string }) => a.manufacturer)).toEqual([
      'HP',
      'Lenovo',
    ]);

    const refurbishing = await admin.get('/api/v1/assets?status=REFURBISHING');
    expect(refurbishing.body.meta.total).toBe(1);

    const page2 = await admin.get('/api/v1/assets?pageSize=2&page=2&sort=model:asc');
    expect(page2.body.meta).toMatchObject({ page: 2, pageSize: 2, total: 3, totalPages: 2 });
    expect(page2.body.data).toHaveLength(1);

    expect((await admin.get('/api/v1/assets?status=BROKEN')).status).toBe(400);
  });
});

describe('CSV export', () => {
  it('exports the filtered list, neutralises formulas, and audits the export', async () => {
    const admin = await loginAs('ADMIN');
    const school = await createCustomerAccount({ name: '=HYPERLINK("http://evil")' });
    await createAsset(admin.user.id, { customerAccountId: school.id, model: 'Model "Quoted"' });
    await createAsset(admin.user.id, { manufacturer: 'HP' });

    const res = await admin.get(`/api/v1/assets/export.csv?customer=${school.id}`);
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('text/csv');
    expect(res.headers['content-disposition']).toMatch(
      /attachment; filename="deviceflow-assets-\d{8}\.csv"/,
    );

    expect(res.text.charCodeAt(0)).toBe(0xfeff); // byte order mark for Excel
    const lines = res.text.slice(1).trim().split('\r\n');
    expect(lines).toHaveLength(2);
    expect(lines[0]).toContain('"Asset tag"');
    expect(lines[1]).toContain(`"'=HYPERLINK(""http://evil"")"`);
    expect(lines[1]).toContain('"Model ""Quoted"""');

    const audit = await prisma.auditLog.findFirstOrThrow({ where: { action: 'asset.exported' } });
    expect(audit.actorUserId).toBe(admin.user.id);
    expect(audit.after).toMatchObject({ rowCount: 1, filters: { customer: school.id } });
  });
});
