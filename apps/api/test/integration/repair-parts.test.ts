import { beforeEach, describe, expect, it } from 'vitest';
import { PART_USAGE_STATUSES, REPAIR_STATUSES } from '@deviceflow/shared';
import { prisma } from '../../src/lib/prisma.js';
import {
  createCustomerAccount,
  createPart,
  createRepairJob,
  loginAs,
  resetDatabase,
} from '../helpers/db.js';

beforeEach(resetDatabase);

async function setup(status: (typeof REPAIR_STATUSES)[number] = 'IN_REPAIR') {
  const admin = await loginAs('ADMIN');
  const tech = await loginAs('TECHNICIAN');
  const account = await createCustomerAccount({ name: 'Parktown Primary' });
  await prisma.customerContact.create({
    data: {
      customerAccountId: account.id,
      fullName: 'Zanele Dube',
      phone: '082 555 0100',
      isPrimary: true,
    },
  });
  const job = await createRepairJob({
    createdById: admin.user.id,
    customerAccountId: account.id,
    status,
    technicianId: tech.user.id,
  });
  const part = await createPart(admin.user.id, { stock: 5, unitCostCents: 20_000 });
  return { admin, tech, account, job, part };
}

const onHand = async (partId: string) =>
  (await prisma.part.findUniqueOrThrow({ where: { id: partId } })).quantityOnHand;

describe('using parts on a job', () => {
  it('takes stock out for the assigned technician and records it against the job', async () => {
    const { tech, job, part } = await setup();
    const res = await tech
      .post(`/api/v1/repairs/${job.id}/parts`)
      .send({ partId: part.id, quantity: 2, note: 'Both batteries swollen' });
    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({
      type: 'REPAIR_CONSUMPTION',
      quantityChange: -2,
      balanceAfter: 3,
      unitCostCents: 20_000,
      repairJob: { id: job.id, reference: job.reference },
      actor: { id: tech.user.id },
    });
    expect(await onHand(part.id)).toBe(3);

    const audit = await prisma.auditLog.findFirstOrThrow({ where: { action: 'repair_part.used' } });
    expect(audit).toMatchObject({
      entityType: 'Part',
      entityId: part.id,
      repairJobId: job.id,
      assetId: job.assetId,
      customerAccountId: job.customerAccountId,
    });
  });

  it('summarises the parts still in use, net of returns, with their cost', async () => {
    const { tech, job, part, admin } = await setup();
    const other = await createPart(admin.user.id, {
      name: 'Adhesive strip',
      stock: 10,
      unitCostCents: 500,
    });
    await tech.post(`/api/v1/repairs/${job.id}/parts`).send({ partId: part.id, quantity: 3 });
    await tech.post(`/api/v1/repairs/${job.id}/parts`).send({ partId: other.id, quantity: 1 });
    await tech
      .post(`/api/v1/repairs/${job.id}/parts/returns`)
      .send({ partId: part.id, quantity: 1 });
    await tech
      .post(`/api/v1/repairs/${job.id}/parts/returns`)
      .send({ partId: other.id, quantity: 1 });

    const res = await tech.get(`/api/v1/repairs/${job.id}/parts`);
    expect(res.status).toBe(200);
    expect(res.body.data.lines).toEqual([
      { part: { id: part.id, sku: part.sku, name: part.name }, quantity: 2, costCents: 40_000 },
    ]);
    expect(res.body.data.totalCostCents).toBe(40_000);
    expect(res.body.data.movements.map((m: { type: string }) => m.type)).toEqual([
      'REPAIR_RETURN',
      'REPAIR_RETURN',
      'REPAIR_CONSUMPTION',
      'REPAIR_CONSUMPTION',
    ]);
    expect(await onHand(part.id)).toBe(3);
    expect(await onHand(other.id)).toBe(10);
  });

  it('refuses to take more than is in stock and changes nothing', async () => {
    const { tech, job, part } = await setup();
    const res = await tech
      .post(`/api/v1/repairs/${job.id}/parts`)
      .send({ partId: part.id, quantity: 6 });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('INSUFFICIENT_STOCK');
    expect(res.body.error.message).toMatch(/Only 5/);
    expect(await onHand(part.id)).toBe(5);
    expect(await prisma.stockMovement.count({ where: { repairJobId: job.id } })).toBe(0);
  });

  it('refuses archived and unknown parts', async () => {
    const { admin, tech, job } = await setup();
    const empty = await createPart(admin.user.id);
    await admin.patch(`/api/v1/inventory/parts/${empty.id}`).send({ isActive: false, version: 0 });
    const archived = await tech
      .post(`/api/v1/repairs/${job.id}/parts`)
      .send({ partId: empty.id, quantity: 1 });
    expect(archived.status).toBe(422);
    expect(archived.body.error.code).toBe('PART_ARCHIVED');
    const unknown = await tech
      .post(`/api/v1/repairs/${job.id}/parts`)
      .send({ partId: crypto.randomUUID(), quantity: 1 });
    expect(unknown.status).toBe(404);
  });

  it.each(REPAIR_STATUSES)(
    'from %s: allowed only while the repair is under way',
    async (status) => {
      const { tech, job, part } = await setup(status);
      const res = await tech
        .post(`/api/v1/repairs/${job.id}/parts`)
        .send({ partId: part.id, quantity: 1 });
      if (PART_USAGE_STATUSES.includes(status)) {
        expect(res.status).toBe(201);
        expect(await onHand(part.id)).toBe(4);
      } else {
        expect(res.status).toBe(422);
        expect(res.body.error.code).toBe('WRONG_REPAIR_STATUS');
        expect(await onHand(part.id)).toBe(5);
      }
    },
  );

  it('is done by the assigned technician or an administrator only', async () => {
    const { admin, account, job, part } = await setup();
    const otherTech = await loginAs('TECHNICIAN');
    const inventory = await loginAs('INVENTORY_MANAGER');
    const customer = await loginAs('CUSTOMER', { customerAccountId: account.id });
    const send = (c: typeof admin) =>
      c.post(`/api/v1/repairs/${job.id}/parts`).send({ partId: part.id, quantity: 1 });
    expect((await send(otherTech)).status).toBe(404);
    expect((await send(inventory)).status).toBe(403);
    expect((await send(customer)).status).toBe(403);
    expect(await onHand(part.id)).toBe(5);
    expect((await send(admin)).status).toBe(201);
  });

  it('applies a double-clicked "use part" once', async () => {
    const { tech, job, part } = await setup();
    const send = () =>
      tech
        .post(`/api/v1/repairs/${job.id}/parts`)
        .set('Idempotency-Key', 'use-part-form-1234')
        .send({ partId: part.id, quantity: 1 });
    const results = await Promise.all([send(), send(), send()]);
    expect(results.map((r) => r.status)).toEqual([201, 201, 201]);
    expect(new Set(results.map((r) => r.body.data.id)).size).toBe(1);
    expect(await onHand(part.id)).toBe(4);
  });
});

describe('returning parts', () => {
  it('returns at most what the job has used of that part', async () => {
    const { tech, job, part } = await setup();
    const none = await tech
      .post(`/api/v1/repairs/${job.id}/parts/returns`)
      .send({ partId: part.id, quantity: 1 });
    expect(none.status).toBe(422);
    expect(none.body.error.code).toBe('RETURN_EXCEEDS_USAGE');
    expect(none.body.error.message).toMatch(/has not been used/);

    await tech.post(`/api/v1/repairs/${job.id}/parts`).send({ partId: part.id, quantity: 2 });
    const tooMany = await tech
      .post(`/api/v1/repairs/${job.id}/parts/returns`)
      .send({ partId: part.id, quantity: 3 });
    expect(tooMany.status).toBe(422);
    expect(tooMany.body.error.message).toMatch(/Only 2/);

    const ok = await tech
      .post(`/api/v1/repairs/${job.id}/parts/returns`)
      .send({ partId: part.id, quantity: 2, note: 'Wrong model' });
    expect(ok.status).toBe(201);
    expect(ok.body.data).toMatchObject({
      type: 'REPAIR_RETURN',
      quantityChange: 2,
      balanceAfter: 5,
    });
    expect(await onHand(part.id)).toBe(5);
  });

  it('cannot return another job’s parts, and the database refuses an over-return too', async () => {
    const { admin, tech, account, job, part } = await setup();
    const other = await createRepairJob({
      createdById: admin.user.id,
      customerAccountId: account.id,
      status: 'IN_REPAIR',
      technicianId: tech.user.id,
    });
    await tech.post(`/api/v1/repairs/${job.id}/parts`).send({ partId: part.id, quantity: 2 });
    const res = await tech
      .post(`/api/v1/repairs/${other.id}/parts/returns`)
      .send({ partId: part.id, quantity: 1 });
    expect(res.status).toBe(422);

    await expect(
      prisma.$transaction([
        prisma.part.update({ where: { id: part.id }, data: { quantityOnHand: 4 } }),
        prisma.stockMovement.create({
          data: {
            partId: part.id,
            type: 'REPAIR_RETURN',
            quantityChange: 1,
            balanceAfter: 4,
            unitCostCents: 0,
            repairJobId: other.id,
            actorUserId: tech.user.id,
          },
        }),
      ]),
    ).rejects.toThrow(/cannot be returned/);
  });

  it('puts returns back at the cost the job was charged, without changing the average', async () => {
    const { admin, tech, job, part } = await setup();
    await tech.post(`/api/v1/repairs/${job.id}/parts`).send({ partId: part.id, quantity: 2 });
    // A dearer delivery moves the average from R200.00 to R250.00.
    await admin
      .post(`/api/v1/inventory/parts/${part.id}/purchases`)
      .send({ quantity: 3, unitCostCents: 30_000 });
    expect((await prisma.part.findUniqueOrThrow({ where: { id: part.id } })).averageCostCents).toBe(
      25_000,
    );
    const ret = await tech
      .post(`/api/v1/repairs/${job.id}/parts/returns`)
      .send({ partId: part.id, quantity: 1 });
    expect(ret.body.data.unitCostCents).toBe(20_000);
    const after = await prisma.part.findUniqueOrThrow({ where: { id: part.id } });
    expect(after).toMatchObject({ quantityOnHand: 7, averageCostCents: 25_000 });
    const summary = (await tech.get(`/api/v1/repairs/${job.id}/parts`)).body.data;
    expect(summary.totalCostCents).toBe(20_000);
  });
});

describe('inventory managers and repair jobs', () => {
  it('see only jobs that have used parts, without the customer’s contact details', async () => {
    const { admin, tech, account, job, part } = await setup();
    const unused = await createRepairJob({
      createdById: admin.user.id,
      customerAccountId: account.id,
      status: 'IN_REPAIR',
      technicianId: tech.user.id,
    });
    await tech.post(`/api/v1/repairs/${job.id}/parts`).send({ partId: part.id, quantity: 1 });
    const inventory = await loginAs('INVENTORY_MANAGER');

    const list = await inventory.get('/api/v1/repairs');
    expect(list.status).toBe(200);
    expect(list.body.data.map((r: { id: string }) => r.id)).toEqual([job.id]);
    expect(list.body.data[0].contact).toBeNull();
    expect(list.body.data[0].customer.name).toBe('Parktown Primary');

    const detail = await inventory.get(`/api/v1/repairs/${job.id}`);
    expect(detail.status).toBe(200);
    expect(detail.body.data.contact).toBeNull();
    expect(JSON.stringify(detail.body)).not.toContain('082 555 0100');
    expect((await inventory.get(`/api/v1/repairs/${job.id}/parts`)).status).toBe(200);
    expect((await inventory.get(`/api/v1/repairs/${job.id}/history`)).status).toBe(200);
    for (const part of ['notes', 'labour', 'quotes']) {
      expect((await inventory.get(`/api/v1/repairs/${job.id}/${part}`)).status).toBe(403);
    }
    expect((await inventory.get(`/api/v1/repairs/${unused.id}`)).status).toBe(404);
    expect((await inventory.get(`/api/v1/repairs/${unused.id}/parts`)).status).toBe(404);
  });

  it('cannot change repair jobs', async () => {
    const { job } = await setup();
    const inventory = await loginAs('INVENTORY_MANAGER');
    const res = await inventory
      .post(`/api/v1/repairs/${job.id}/transitions`)
      .send({ to: 'AWAITING_PARTS', note: 'x', version: 0 });
    expect(res.status).toBe(403);
    expect(
      (
        await inventory
          .post(`/api/v1/repairs/${job.id}/notes`)
          .send({ type: 'INTERNAL', body: 'x' })
      ).status,
    ).toBe(403);
  });
});
