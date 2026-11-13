import { beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '../../src/lib/prisma.js';
import {
  createCustomerAccount,
  createPart,
  createRepairJob,
  loginAs,
  resetDatabase,
} from '../helpers/db.js';

/*
 * Phase 5 exit criterion: concurrent decrements cannot take stock below zero.
 * Every request here is sent at the same moment, each in its own transaction.
 */

beforeEach(resetDatabase);

async function stockOf(partId: string) {
  const part = await prisma.part.findUniqueOrThrow({ where: { id: partId } });
  const ledger = await prisma.stockMovement.aggregate({
    where: { partId },
    _sum: { quantityChange: true },
    _min: { balanceAfter: true },
  });
  return {
    onHand: part.quantityOnHand,
    ledgerSum: ledger._sum.quantityChange ?? 0,
    lowestBalance: ledger._min.balanceAfter,
  };
}

describe('simultaneous stock decrements', () => {
  it('lets exactly 5 of 12 simultaneous write-offs of 1 unit succeed when 5 are in stock', async () => {
    const admin = await loginAs('ADMIN');
    const part = await createPart(admin.user.id, { stock: 5 });
    const results = await Promise.all(
      Array.from({ length: 12 }, (_, i) =>
        admin
          .post(`/api/v1/inventory/parts/${part.id}/adjustments`)
          .send({ direction: 'OUT', quantity: 1, note: `Damaged unit ${i}` }),
      ),
    );
    expect(results.filter((r) => r.status === 201)).toHaveLength(5);
    const refused = results.filter((r) => r.status !== 201);
    expect(refused).toHaveLength(7);
    for (const r of refused) {
      expect(r.status).toBe(409);
      expect(r.body.error.code).toBe('INSUFFICIENT_STOCK');
    }
    expect(await stockOf(part.id)).toEqual({ onHand: 0, ledgerSum: 0, lowestBalance: 0 });
    // Each successful movement recorded a distinct balance: 4, 3, 2, 1, 0.
    const balances = results.filter((r) => r.status === 201).map((r) => r.body.data.balanceAfter);
    expect(balances.sort()).toEqual([0, 1, 2, 3, 4]);
  });

  it('never oversells when different repair jobs race for the same part', async () => {
    const admin = await loginAs('ADMIN');
    const tech = await loginAs('TECHNICIAN');
    const account = await createCustomerAccount();
    const part = await createPart(admin.user.id, { stock: 3 });
    const jobs = [];
    for (let i = 0; i < 8; i++) {
      jobs.push(
        await createRepairJob({
          createdById: admin.user.id,
          customerAccountId: account.id,
          status: 'IN_REPAIR',
          technicianId: tech.user.id,
        }),
      );
    }
    const results = await Promise.all(
      jobs.map((job) =>
        tech.post(`/api/v1/repairs/${job.id}/parts`).send({ partId: part.id, quantity: 1 }),
      ),
    );
    expect(results.filter((r) => r.status === 201)).toHaveLength(3);
    expect(results.filter((r) => r.status === 409)).toHaveLength(5);
    expect(await stockOf(part.id)).toEqual({ onHand: 0, ledgerSum: 0, lowestBalance: 0 });
    expect(await prisma.stockMovement.count({ where: { type: 'REPAIR_CONSUMPTION' } })).toBe(3);
  });

  it('takes multi-unit requests whole or not at all', async () => {
    const admin = await loginAs('ADMIN');
    const part = await createPart(admin.user.id, { stock: 5 });
    const results = await Promise.all(
      Array.from({ length: 4 }, () =>
        admin
          .post(`/api/v1/inventory/parts/${part.id}/adjustments`)
          .send({ direction: 'OUT', quantity: 2, note: 'Stock count correction' }),
      ),
    );
    expect(results.filter((r) => r.status === 201)).toHaveLength(2);
    // One unit is left: never a partial take, never below zero.
    expect(await stockOf(part.id)).toEqual({ onHand: 1, ledgerSum: 1, lowestBalance: 1 });
  });

  it('keeps stock and ledger equal under a mix of deliveries, uses and write-offs', async () => {
    const admin = await loginAs('ADMIN');
    const tech = await loginAs('TECHNICIAN');
    const account = await createCustomerAccount();
    const part = await createPart(admin.user.id, { stock: 4, unitCostCents: 10_000 });
    const job = await createRepairJob({
      createdById: admin.user.id,
      customerAccountId: account.id,
      status: 'IN_REPAIR',
      technicianId: tech.user.id,
    });
    const url = `/api/v1/inventory/parts/${part.id}`;
    const results = await Promise.all([
      ...Array.from({ length: 6 }, () =>
        admin.post(`${url}/adjustments`).send({ direction: 'OUT', quantity: 1, note: 'Lost' }),
      ),
      ...Array.from({ length: 3 }, () =>
        admin.post(`${url}/purchases`).send({ quantity: 1, unitCostCents: 10_000 }),
      ),
      ...Array.from({ length: 3 }, () =>
        tech.post(`/api/v1/repairs/${job.id}/parts`).send({ partId: part.id, quantity: 1 }),
      ),
    ]);
    expect(results.every((r) => r.status === 201 || r.status === 409)).toBe(true);
    const stock = await stockOf(part.id);
    expect(stock.onHand).toBeGreaterThanOrEqual(0);
    expect(stock.onHand).toBe(stock.ledgerSum);
    expect(stock.lowestBalance).toBeGreaterThanOrEqual(0);
    // 4 + 3 delivered; every successful take removed exactly one.
    const taken = results
      .slice(0, 6)
      .concat(results.slice(9))
      .filter((r) => r.status === 201);
    expect(stock.onHand).toBe(7 - taken.length);
  });

  it('averages the cost correctly when two deliveries arrive at once', async () => {
    const admin = await loginAs('ADMIN');
    const part = await createPart(admin.user.id);
    const url = `/api/v1/inventory/parts/${part.id}/purchases`;
    await Promise.all([
      admin.post(url).send({ quantity: 10, unitCostCents: 10_000 }),
      admin.post(url).send({ quantity: 10, unitCostCents: 20_000 }),
    ]);
    const after = await prisma.part.findUniqueOrThrow({ where: { id: part.id } });
    expect(after).toMatchObject({ quantityOnHand: 20, averageCostCents: 15_000 });
  });
});

describe('database backstops', () => {
  it('refuses negative stock even from a direct update', async () => {
    const admin = await loginAs('ADMIN');
    const part = await createPart(admin.user.id, { stock: 1 });
    await expect(
      prisma.$executeRaw`UPDATE "parts" SET "quantity_on_hand" = -1 WHERE "id" = ${part.id}::uuid`,
    ).rejects.toThrow(/parts_quantity_chk/);
  });

  it('refuses a stock change without a matching movement, and a movement without one', async () => {
    const admin = await loginAs('ADMIN');
    const part = await createPart(admin.user.id, { stock: 2 });
    await expect(
      prisma.$executeRaw`UPDATE "parts" SET "quantity_on_hand" = 5 WHERE "id" = ${part.id}::uuid`,
    ).rejects.toThrow(/movements add up to/);
    await expect(
      prisma.stockMovement.create({
        data: {
          partId: part.id,
          type: 'ADJUSTMENT_IN',
          quantityChange: 1,
          balanceAfter: 2,
          unitCostCents: 0,
          note: 'Sneaky',
          actorUserId: admin.user.id,
        },
      }),
    ).rejects.toThrow(/movements add up to/);
    expect((await stockOf(part.id)).onHand).toBe(2);
  });

  it('keeps the ledger append-only', async () => {
    const admin = await loginAs('ADMIN');
    const part = await createPart(admin.user.id, { stock: 2 });
    const movement = await prisma.stockMovement.findFirstOrThrow({ where: { partId: part.id } });
    await expect(
      prisma.stockMovement.update({ where: { id: movement.id }, data: { note: 'edited' } }),
    ).rejects.toThrow(/append-only/);
    await expect(prisma.stockMovement.delete({ where: { id: movement.id } })).rejects.toThrow(
      /append-only/,
    );
  });

  it('refuses a movement with the wrong sign, or a write-off without a reason', async () => {
    const admin = await loginAs('ADMIN');
    const part = await createPart(admin.user.id, { stock: 2 });
    const base = { partId: part.id, unitCostCents: 0, actorUserId: admin.user.id };
    await expect(
      prisma.$transaction([
        prisma.part.update({ where: { id: part.id }, data: { quantityOnHand: 3 } }),
        prisma.stockMovement.create({
          data: { ...base, type: 'ADJUSTMENT_OUT', quantityChange: 1, balanceAfter: 3, note: 'x' },
        }),
      ]),
    ).rejects.toThrow(/stock_movements_sign_chk/);
    await expect(
      prisma.$transaction([
        prisma.part.update({ where: { id: part.id }, data: { quantityOnHand: 1 } }),
        prisma.stockMovement.create({
          data: { ...base, type: 'ADJUSTMENT_OUT', quantityChange: -1, balanceAfter: 1 },
        }),
      ]),
    ).rejects.toThrow(/stock_movements_note_chk/);
  });
});
