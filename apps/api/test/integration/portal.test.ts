import { beforeEach, describe, expect, it } from 'vitest';
import {
  createAsset,
  createCustomerAccount,
  createUser,
  loginAs,
  resetDatabase,
} from '../helpers/db.js';

beforeEach(resetDatabase);

/** Two customers, each with one device, plus a stock device nobody owns. */
async function setup() {
  const staff = await createUser('ADMIN');
  const accountA = await createCustomerAccount({ name: 'A School' });
  const accountB = await createCustomerAccount({ name: 'B School' });
  const assetA = await createAsset(staff.id, { customerAccountId: accountA.id, model: 'A laptop' });
  const assetB = await createAsset(staff.id, { customerAccountId: accountB.id, model: 'B laptop' });
  const stock = await createAsset(staff.id, { model: 'Stock laptop' });
  const customerA = await loginAs('CUSTOMER', { customerAccountId: accountA.id });
  return { staff, accountA, accountB, assetA, assetB, stock, customerA };
}

describe('customer portal isolation', () => {
  it('lists only the customer’s own devices', async () => {
    const { customerA, assetA } = await setup();
    const res = await customerA.get('/api/v1/portal/assets');
    expect(res.status).toBe(200);
    expect(res.body.data.map((a: { id: string }) => a.id)).toEqual([assetA.id]);
  });

  it('returns 404, not 403, for another customer’s device or an unowned one', async () => {
    const { customerA, assetB, stock } = await setup();
    for (const id of [assetB.id, stock.id, crypto.randomUUID()]) {
      for (const path of [`/api/v1/portal/assets/${id}`, `/api/v1/portal/assets/${id}/history`]) {
        const res = await customerA.get(path);
        expect(res.status, path).toBe(404);
        expect(res.body.error.code).toBe('NOT_FOUND');
      }
    }
  });

  it('ignores attempts to widen the scope through the query string', async () => {
    const { customerA, accountB, assetA } = await setup();
    const res = await customerA.get(
      `/api/v1/portal/assets?customerAccountId=${accountB.id}&customer=${accountB.id}`,
    );
    expect(res.body.data.map((a: { id: string }) => a.id)).toEqual([assetA.id]);
  });

  it('returns the customer’s own account only', async () => {
    const { customerA, accountA } = await setup();
    const res = await customerA.get('/api/v1/portal/account');
    expect(res.body.data).toEqual({
      accountNumber: accountA.accountNumber,
      name: 'A School',
      type: 'ORGANISATION',
    });
  });

  it('never exposes staff notes or staff identities', async () => {
    const { customerA, assetA, staff } = await setup();
    const { prisma } = await import('../../src/lib/prisma.js');
    await prisma.asset.update({
      where: { id: assetA.id },
      data: { notes: 'INTERNAL: owes money' },
    });
    await prisma.assetEvent.create({
      data: {
        assetId: assetA.id,
        type: 'STATUS_CHANGED',
        fromStatus: 'ACTIVE',
        toStatus: 'IN_REPAIR',
        note: 'INTERNAL: dropped by learner',
        actorUserId: staff.id,
      },
    });
    const detail = await customerA.get(`/api/v1/portal/assets/${assetA.id}`);
    const history = await customerA.get(`/api/v1/portal/assets/${assetA.id}/history`);
    const body = JSON.stringify([detail.body, history.body]);
    expect(body).not.toContain('INTERNAL');
    expect(body).not.toContain(staff.id);
    expect(history.body.data[0]).toMatchObject({ fromStatus: 'ACTIVE', toStatus: 'IN_REPAIR' });
  });

  it('shows history only from when the device was assigned to this customer', async () => {
    const { staff, accountA, accountB, assetB } = await setup();
    const { prisma } = await import('../../src/lib/prisma.js');
    // B's device is repaired, then moves to A.
    await prisma.assetEvent.create({
      data: {
        assetId: assetB.id,
        type: 'STATUS_CHANGED',
        fromStatus: 'ACTIVE',
        toStatus: 'IN_REPAIR',
        actorUserId: staff.id,
      },
    });
    await prisma.asset.update({
      where: { id: assetB.id },
      data: { customerAccountId: accountA.id },
    });
    await prisma.assetEvent.create({
      data: {
        assetId: assetB.id,
        type: 'CUSTOMER_CHANGED',
        fromCustomerAccountId: accountB.id,
        toCustomerAccountId: accountA.id,
        actorUserId: staff.id,
      },
    });

    const customerA2 = await loginAs('CUSTOMER', { customerAccountId: accountA.id });
    const history = await customerA2.get(`/api/v1/portal/assets/${assetB.id}/history`);
    expect(history.status).toBe(200);
    expect(history.body.data.map((e: { type: string }) => e.type)).toEqual(['CUSTOMER_CHANGED']);
    expect(JSON.stringify(history.body)).not.toContain(accountB.id);
  });

  it.each(['ADMIN', 'TECHNICIAN', 'INVENTORY_MANAGER'] as const)(
    'staff (%s) cannot use portal endpoints',
    async (role) => {
      const c = await loginAs(role);
      expect((await c.get('/api/v1/portal/assets')).status).toBe(403);
    },
  );
});
