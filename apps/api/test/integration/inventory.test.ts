import { beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '../../src/lib/prisma.js';
import { createCustomerAccount, createPart, loginAs, resetDatabase } from '../helpers/db.js';

beforeEach(resetDatabase);

const battery = {
  sku: ' dell-bat-54wh ',
  name: 'Dell 54 Wh battery',
  category: 'BATTERY',
  location: 'A3-02',
  reorderLevel: 2,
};

describe('permissions', () => {
  it('lets administrators and inventory managers manage parts', async () => {
    for (const role of ['ADMIN', 'INVENTORY_MANAGER'] as const) {
      await resetDatabase();
      const user = await loginAs(role);
      const res = await user.post('/api/v1/inventory/parts').send(battery);
      expect(res.status).toBe(201);
      expect(res.body.data).toMatchObject({
        sku: 'DELL-BAT-54WH',
        quantityOnHand: 0,
        stockState: 'OUT',
        isActive: true,
      });
    }
  });

  it('lets technicians look up stock but not change it', async () => {
    const admin = await loginAs('ADMIN');
    const tech = await loginAs('TECHNICIAN');
    const part = await createPart(admin.user.id, { stock: 3 });
    expect((await tech.get('/api/v1/inventory/parts')).body.meta.total).toBe(1);
    expect((await tech.get(`/api/v1/inventory/parts/${part.id}`)).status).toBe(200);
    expect((await tech.get('/api/v1/inventory/movements')).status).toBe(200);
    const writes = [
      tech.post('/api/v1/inventory/parts').send(battery),
      tech.patch(`/api/v1/inventory/parts/${part.id}`).send({ name: 'x', version: 0 }),
      tech.post(`/api/v1/inventory/parts/${part.id}/purchases`).send({
        quantity: 1,
        unitCostCents: 100,
      }),
      tech
        .post(`/api/v1/inventory/parts/${part.id}/adjustments`)
        .send({ direction: 'OUT', quantity: 1, note: 'x' }),
    ];
    for (const res of await Promise.all(writes)) expect(res.status).toBe(403);
    expect((await prisma.part.findUniqueOrThrow({ where: { id: part.id } })).quantityOnHand).toBe(
      3,
    );
  });

  it('keeps customers out of inventory entirely', async () => {
    const account = await createCustomerAccount();
    const customer = await loginAs('CUSTOMER', { customerAccountId: account.id });
    expect((await customer.get('/api/v1/inventory/parts')).status).toBe(403);
    expect((await customer.get('/api/v1/inventory/movements')).status).toBe(403);
  });
});

describe('parts', () => {
  it('refuses a duplicate SKU, ignoring case and spaces', async () => {
    const admin = await loginAs('ADMIN');
    await admin.post('/api/v1/inventory/parts').send(battery);
    const res = await admin
      .post('/api/v1/inventory/parts')
      .send({ ...battery, sku: 'DELL-BAT-54WH' });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('SKU_TAKEN');
    expect(res.body.error.details[0].path).toBe('sku');
  });

  it('validates the SKU and the reorder level', async () => {
    const admin = await loginAs('ADMIN');
    for (const bad of [
      { sku: 'has space' },
      { sku: '' },
      { reorderLevel: -1 },
      { reorderLevel: 1.5 },
    ]) {
      const res = await admin.post('/api/v1/inventory/parts').send({ ...battery, ...bad });
      expect(res.status, JSON.stringify(bad)).toBe(400);
    }
  });

  it('edits with optimistic locking and records the change', async () => {
    const admin = await loginAs('ADMIN');
    const part = (await admin.post('/api/v1/inventory/parts').send(battery)).body.data;
    const edited = await admin
      .patch(`/api/v1/inventory/parts/${part.id}`)
      .send({ location: 'B1-04', reorderLevel: 5, version: 0 });
    expect(edited.status).toBe(200);
    expect(edited.body.data).toMatchObject({ location: 'B1-04', reorderLevel: 5, version: 1 });
    const stale = await admin
      .patch(`/api/v1/inventory/parts/${part.id}`)
      .send({ name: 'Old screen', version: 0 });
    expect(stale.status).toBe(409);
    const audit = await prisma.auditLog.findMany({
      where: { entityType: 'Part', entityId: part.id },
      orderBy: { createdAt: 'asc' },
    });
    expect(audit.map((a) => a.action)).toEqual(['part.created', 'part.updated']);
  });

  it('archives a part only when it has no stock, and then refuses stock changes', async () => {
    const admin = await loginAs('ADMIN');
    const part = await createPart(admin.user.id, { stock: 2 });
    const url = `/api/v1/inventory/parts/${part.id}`;
    const blocked = await admin.patch(url).send({ isActive: false, version: 0 });
    expect(blocked.status).toBe(422);
    expect(blocked.body.error.code).toBe('PART_HAS_STOCK');

    await admin
      .post(`${url}/adjustments`)
      .send({ direction: 'OUT', quantity: 2, note: 'Written off: water damage' });
    const archived = await admin.patch(url).send({ isActive: false, version: 0 });
    expect(archived.status).toBe(200);
    expect(archived.body.data.isActive).toBe(false);

    const purchase = await admin.post(`${url}/purchases`).send({ quantity: 1, unitCostCents: 1 });
    expect(purchase.status).toBe(422);
    expect(purchase.body.error.code).toBe('PART_ARCHIVED');
    expect((await admin.get('/api/v1/inventory/parts')).body.meta.total).toBe(0);
    expect((await admin.get('/api/v1/inventory/parts?isActive=false')).body.meta.total).toBe(1);

    const restored = await admin.patch(url).send({ isActive: true, version: 1 });
    expect(restored.status).toBe(200);
    const actions = await prisma.auditLog.findMany({
      where: { entityId: part.id, action: { startsWith: 'part.' } },
      orderBy: { createdAt: 'asc' },
    });
    expect(actions.map((a) => a.action)).toEqual(['part.archived', 'part.restored']);
  });

  it('filters low and out-of-stock parts and searches by SKU, name and location', async () => {
    const admin = await loginAs('ADMIN');
    await createPart(admin.user.id, { name: 'Plenty', stock: 10, reorderLevel: 3 });
    await createPart(admin.user.id, { name: 'At reorder level', stock: 3, reorderLevel: 3 });
    await createPart(admin.user.id, { name: 'Empty', stock: 0, reorderLevel: 0 });
    await createPart(admin.user.id, {
      name: 'Screen A3',
      sku: 'SCR-14',
      stock: 1,
      reorderLevel: 0,
    });

    const names = async (query: string) =>
      (await admin.get(`/api/v1/inventory/parts?${query}`)).body.data.map(
        (p: { name: string }) => p.name,
      );
    expect(await names('stock=low')).toEqual(['At reorder level', 'Empty']);
    expect(await names('stock=out')).toEqual(['Empty']);
    expect(await names('search=scr-14')).toEqual(['Screen A3']);
    expect(await names('sort=quantityOnHand:desc&pageSize=2')).toEqual([
      'Plenty',
      'At reorder level',
    ]);

    const states = (await admin.get('/api/v1/inventory/parts')).body.data.map(
      (p: { name: string; stockState: string }) => [p.name, p.stockState],
    );
    expect(states).toEqual([
      ['At reorder level', 'LOW'],
      ['Empty', 'OUT'],
      ['Plenty', 'OK'],
      ['Screen A3', 'OK'],
    ]);
  });
});

describe('receiving and adjusting stock', () => {
  it('receives purchases and keeps a weighted average cost, rounded half-up', async () => {
    const admin = await loginAs('ADMIN');
    const part = await createPart(admin.user.id);
    const url = `/api/v1/inventory/parts/${part.id}/purchases`;
    const first = await admin.post(url).send({
      quantity: 3,
      unitCostCents: 100_000,
      supplier: 'Rectron',
      reference: 'INV-2026-0042',
    });
    expect(first.status).toBe(201);
    expect(first.body.data).toMatchObject({
      type: 'PURCHASE',
      quantityChange: 3,
      balanceAfter: 3,
      unitCostCents: 100_000,
      supplier: 'Rectron',
      reference: 'INV-2026-0042',
      actor: { id: admin.user.id },
    });
    // (3 × 1000.00 + 4 × 1200.01) / 7 = 1114.2914… → R1 114.29
    await admin.post(url).send({ quantity: 4, unitCostCents: 120_001 });
    const after = (await admin.get(`/api/v1/inventory/parts/${part.id}`)).body.data;
    expect(after).toMatchObject({
      quantityOnHand: 7,
      averageCostCents: 111_429,
      stockValueCents: 7 * 111_429,
    });
    // 1 unit at 0.01 + 1 unit at 0.02 averages to 1.5 cents, which rounds up to 2.
    const small = await createPart(admin.user.id);
    const smallUrl = `/api/v1/inventory/parts/${small.id}/purchases`;
    await admin.post(smallUrl).send({ quantity: 1, unitCostCents: 1 });
    await admin.post(smallUrl).send({ quantity: 1, unitCostCents: 2 });
    expect(
      (await prisma.part.findUniqueOrThrow({ where: { id: small.id } })).averageCostCents,
    ).toBe(2);
  });

  it('adjusts stock in either direction with a reason, at the average cost', async () => {
    const admin = await loginAs('INVENTORY_MANAGER');
    const part = await createPart(admin.user.id, { stock: 5, unitCostCents: 2_500 });
    const url = `/api/v1/inventory/parts/${part.id}/adjustments`;
    const noReason = await admin.post(url).send({ direction: 'OUT', quantity: 1, note: ' ' });
    expect(noReason.status).toBe(400);

    const down = await admin
      .post(url)
      .send({ direction: 'OUT', quantity: 2, note: 'Stock count found 3' });
    expect(down.body.data).toMatchObject({
      type: 'ADJUSTMENT_OUT',
      quantityChange: -2,
      balanceAfter: 3,
      unitCostCents: 2_500,
      note: 'Stock count found 3',
    });
    const up = await admin
      .post(url)
      .send({ direction: 'IN', quantity: 1, note: 'Found in the van' });
    expect(up.body.data).toMatchObject({
      type: 'ADJUSTMENT_IN',
      quantityChange: 1,
      balanceAfter: 4,
    });

    const tooMany = await admin.post(url).send({ direction: 'OUT', quantity: 5, note: 'Lost' });
    expect(tooMany.status).toBe(409);
    expect(tooMany.body.error.code).toBe('INSUFFICIENT_STOCK');
    expect(tooMany.body.error.message).toMatch(/Only 4/);
    expect((await prisma.part.findUniqueOrThrow({ where: { id: part.id } })).quantityOnHand).toBe(
      4,
    );
  });

  it('applies a repeated delivery with the same Idempotency-Key once', async () => {
    const admin = await loginAs('ADMIN');
    const part = await createPart(admin.user.id);
    const send = () =>
      admin
        .post(`/api/v1/inventory/parts/${part.id}/purchases`)
        .set('Idempotency-Key', 'delivery-note-7781')
        .send({ quantity: 10, unitCostCents: 5_000 });
    const [a, b] = await Promise.all([send(), send()]);
    expect([a.status, b.status]).toEqual([201, 201]);
    expect(a.body).toEqual(b.body);
    expect((await prisma.part.findUniqueOrThrow({ where: { id: part.id } })).quantityOnHand).toBe(
      10,
    );
  });

  it('lists the ledger newest first, for one part or filtered by type and date', async () => {
    const admin = await loginAs('ADMIN');
    const part = await createPart(admin.user.id, { stock: 5 });
    const other = await createPart(admin.user.id, { stock: 1 });
    await admin
      .post(`/api/v1/inventory/parts/${part.id}/adjustments`)
      .send({ direction: 'OUT', quantity: 1, note: 'Damaged' });

    const ledger = (await admin.get(`/api/v1/inventory/parts/${part.id}/movements`)).body;
    expect(ledger.meta.total).toBe(2);
    expect(ledger.data.map((m: { type: string }) => m.type)).toEqual([
      'ADJUSTMENT_OUT',
      'PURCHASE',
    ]);
    expect(ledger.data[0].part).toEqual({ id: part.id, sku: part.sku, name: part.name });

    const all = await admin.get('/api/v1/inventory/movements?type=PURCHASE');
    expect(all.body.meta.total).toBe(2);
    const today = new Date().toISOString().slice(0, 10);
    expect((await admin.get(`/api/v1/inventory/movements?from=${today}`)).body.meta.total).toBe(3);
    expect((await admin.get('/api/v1/inventory/movements?to=2020-01-01')).body.meta.total).toBe(0);
    expect(
      (await admin.get(`/api/v1/inventory/movements?part=${other.id}`)).body.data[0].part.id,
    ).toBe(other.id);
    expect(
      (await admin.get(`/api/v1/inventory/parts/${crypto.randomUUID()}/movements`)).status,
    ).toBe(404);
  });

  it('writes an audit entry for every stock change, on the part', async () => {
    const admin = await loginAs('ADMIN');
    const part = await createPart(admin.user.id);
    await admin
      .post(`/api/v1/inventory/parts/${part.id}/purchases`)
      .send({ quantity: 2, unitCostCents: 100 });
    await admin
      .post(`/api/v1/inventory/parts/${part.id}/adjustments`)
      .send({ direction: 'OUT', quantity: 1, note: 'Broken' });
    const audit = await admin.get(`/api/v1/audit?entityType=Part&entityId=${part.id}`);
    expect(audit.body.data.map((a: { action: string }) => a.action)).toEqual([
      'stock.adjusted',
      'stock.purchased',
    ]);
    expect(audit.body.data[0].after).toMatchObject({ quantityChange: -1, balanceAfter: 1 });
  });
});
