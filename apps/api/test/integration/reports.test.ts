import { beforeEach, describe, expect, it } from 'vitest';
import type { RepairStatus, StockMovementType } from '@deviceflow/shared';
import { prisma } from '../../src/lib/prisma.js';
import { createCustomerAccount, createUser, loginAs, resetDatabase } from '../helpers/db.js';

/*
 * Phase 6 exit criterion: report numbers are checked against fixtures.
 *
 * The fixture below is a small, fully known world. Every expected figure is
 * worked out by hand in the comments, including events exactly on the edges of
 * the range (00:00:00.000 on the first day, 23:59:59.999 on the last day, and
 * 00:00:00.000 on the day after, which is outside).
 *
 * Range: 2026-10-01 to 2026-10-31 (31 days, daily buckets).
 */

const RANGE = 'from=2026-10-01&to=2026-10-31';
const t = (iso: string) => new Date(iso);

let n = 0;
async function asset(
  adminId: string,
  accountId: string | null,
  status: 'ACTIVE' | 'IN_REPAIR' | 'IN_STOCK',
  createdAt?: string,
) {
  n += 1;
  return prisma.asset.create({
    data: {
      category: 'LAPTOP',
      manufacturer: 'Dell',
      manufacturerKey: 'DELL',
      model: 'Latitude 5440',
      serialNumber: `RPT${n}`,
      status,
      customerAccountId: accountId,
      createdById: adminId,
      ...(createdAt ? { createdAt: t(createdAt) } : {}),
    },
  });
}

interface JobSpec {
  tech: string | null;
  status: RepairStatus;
  created: string;
  completed?: string;
  closed?: string;
}

async function job(adminId: string, accountId: string, spec: JobSpec) {
  const open = !['CLOSED', 'RETURNED_UNREPAIRED', 'CANCELLED'].includes(spec.status);
  const a = await asset(adminId, accountId, open ? 'IN_REPAIR' : 'ACTIVE');
  return prisma.repairJob.create({
    data: {
      assetId: a.id,
      customerAccountId: accountId,
      status: spec.status,
      source: 'STAFF',
      faultDescription: 'Fixture job',
      submittedById: adminId,
      assignedTechnicianId: spec.tech,
      createdAt: t(spec.created),
      completedAt: spec.completed ? t(spec.completed) : null,
      completionSummary: spec.completed ? 'Done' : null,
      closedAt: spec.closed ? t(spec.closed) : null,
    },
  });
}

async function quote(
  jobId: string,
  adminId: string,
  status: 'ISSUED' | 'APPROVED' | 'SUPERSEDED',
  subtotalCents: number,
  revision = 1,
) {
  const vatCents = Math.floor((subtotalCents * 1500 + 5000) / 10000);
  const totalCents = subtotalCents + vatCents;
  return prisma.quotation.create({
    data: {
      repairJobId: jobId,
      revision,
      status,
      currency: 'ZAR',
      vatRateBasisPoints: 1500,
      subtotalCents,
      vatCents,
      totalCents,
      createdById: adminId,
      issuedById: adminId,
      issuedAt: t('2026-09-01T00:00:00Z'),
      ...(status === 'APPROVED'
        ? {
            decidedById: adminId,
            decidedAt: t('2026-09-02T00:00:00Z'),
            decisionChannel: 'PHONE' as const,
            approvedTotalCents: totalCents,
          }
        : {}),
    },
  });
}

/** Writes a stock movement at a given time, with the stock change in the same transaction. */
async function move(
  actorUserId: string,
  partId: string,
  type: StockMovementType,
  change: number,
  unitCostCents: number,
  at: string,
  repairJobId: string | null = null,
) {
  await prisma.$transaction(async (tx) => {
    const part = await tx.part.update({
      where: { id: partId },
      data: { quantityOnHand: { increment: change } },
    });
    await tx.stockMovement.create({
      data: {
        partId,
        type,
        quantityChange: change,
        balanceAfter: part.quantityOnHand,
        unitCostCents,
        repairJobId,
        actorUserId,
        createdAt: t(at),
      },
    });
  });
}

async function part(
  sku: string,
  name: string,
  reorderLevel: number,
  averageCostCents: number,
  isActive = true,
) {
  return prisma.part.create({
    data: { sku, name, category: 'OTHER', reorderLevel, averageCostCents, isActive },
  });
}

async function buildFixture() {
  const admin = await loginAs('ADMIN');
  const adminId = admin.user.id;
  const account = await createCustomerAccount({ name: 'Fixture School' });
  const alpha = await prisma.user.update({
    where: { id: (await createUser('TECHNICIAN')).id },
    data: { fullName: 'Alpha Tech' },
  });
  const bravo = await prisma.user.update({
    where: { id: (await createUser('TECHNICIAN')).id },
    data: { fullName: 'Bravo Tech' },
  });
  const charlie = await prisma.user.update({
    where: { id: (await createUser('TECHNICIAN', { isActive: false })).id },
    data: { fullName: 'Charlie Tech' },
  });
  await prisma.user.update({
    where: { id: (await createUser('TECHNICIAN', { isActive: false })).id },
    data: { fullName: 'Delta Tech' },
  });
  const J = (spec: JobSpec) => job(adminId, account.id, spec);

  // Completed in range, turnaround 48 h. A superseded revision must not count.
  const j1 = await J({
    tech: alpha.id,
    status: 'CLOSED',
    created: '2026-10-02T08:00:00Z',
    completed: '2026-10-04T08:00:00Z',
    closed: '2026-10-05T09:00:00Z',
  });
  await quote(j1.id, adminId, 'SUPERSEDED', 80_000, 1);
  await quote(j1.id, adminId, 'APPROVED', 100_000, 2);
  // Booked in before the range, completed at the first instant of it: 62 h.
  const j2 = await J({
    tech: bravo.id,
    status: 'COMPLETED',
    created: '2026-09-28T10:00:00Z',
    completed: '2026-10-01T00:00:00.000Z',
  });
  await quote(j2.id, adminId, 'APPROVED', 50_000);
  // Completed at the last instant of the range: 36 h less 1 ms.
  const j3 = await J({
    tech: alpha.id,
    status: 'COMPLETED',
    created: '2026-10-30T12:00:00Z',
    completed: '2026-10-31T23:59:59.999Z',
  });
  await quote(j3.id, adminId, 'APPROVED', 20_000);
  // Completed at the first instant after the range: opened in range, not completed in it.
  const j4 = await J({
    tech: alpha.id,
    status: 'COMPLETED',
    created: '2026-10-20T09:00:00Z',
    completed: '2026-11-01T00:00:00.000Z',
  });
  await quote(j4.id, adminId, 'APPROVED', 99_900);
  // Cancelled in range.
  await J({
    tech: null,
    status: 'CANCELLED',
    created: '2026-10-10T09:00:00Z',
    closed: '2026-10-11T09:00:00Z',
  });
  // Open and in progress.
  const j6 = await J({ tech: alpha.id, status: 'IN_REPAIR', created: '2026-10-15T09:00:00Z' });
  // Waiting for approval: an issued quotation is not revenue.
  const j7 = await J({
    tech: bravo.id,
    status: 'AWAITING_APPROVAL',
    created: '2026-10-16T09:00:00Z',
  });
  await quote(j7.id, adminId, 'ISSUED', 40_000);
  // Submitted long before the range.
  await J({ tech: null, status: 'SUBMITTED', created: '2026-08-01T09:00:00Z' });
  // Returned unrepaired at the last instant before the range.
  await J({
    tech: bravo.id,
    status: 'RETURNED_UNREPAIRED',
    created: '2026-09-01T09:00:00Z',
    closed: '2026-09-30T23:59:59.999Z',
  });
  // Completed by a technician who has since been deactivated: 24 h.
  const j10 = await J({
    tech: charlie.id,
    status: 'CLOSED',
    created: '2026-10-19T12:00:00Z',
    completed: '2026-10-20T12:00:00Z',
    closed: '2026-10-21T09:00:00Z',
  });
  await quote(j10.id, adminId, 'APPROVED', 30_000);
  // Open, waiting for parts, booked in before the range.
  await J({ tech: alpha.id, status: 'AWAITING_PARTS', created: '2026-09-20T09:00:00Z' });

  // Two stock devices: one registered in the range, one the instant before it.
  await asset(adminId, null, 'IN_STOCK', '2026-10-05T10:00:00Z');
  await asset(adminId, null, 'IN_STOCK', '2026-09-30T23:59:59.999Z');

  // Labour: Alpha 60 + 30 in range (two entries outside), Bravo 45.
  const labour = (userId: string, repairJobId: string, minutes: number, date: string) =>
    prisma.labourEntry.create({
      data: { repairJobId, userId, minutes, description: 'Work', workDate: t(`${date}T00:00:00Z`) },
    });
  await labour(alpha.id, j6.id, 60, '2026-10-01');
  await labour(alpha.id, j6.id, 30, '2026-10-31');
  await labour(alpha.id, j6.id, 999, '2026-11-01');
  await labour(alpha.id, j6.id, 999, '2026-09-30');
  await labour(bravo.id, j7.id, 45, '2026-10-15');

  // Inventory, in time order (the ledger checks each balance as it is written).
  const p1 = await part('P1-BATTERY', 'Battery', 2, 10_000);
  const p2 = await part('P2-SCREEN', 'Screen', 3, 50_000);
  const p3 = await part('P3-PASTE', 'Paste', 0, 500);
  const p4 = await part('P4-CABLE', 'Cable', 5, 1_000);
  await part('P5-OLD', 'Old part', 0, 0, false);
  await part('P6-EMPTY', 'Empty part', 0, 0);
  await move(adminId, p1.id, 'PURCHASE', 10, 10_000, '2026-09-15T10:00:00Z');
  await move(adminId, p1.id, 'REPAIR_CONSUMPTION', -1, 10_000, '2026-09-30T23:59:59.999Z', j1.id);
  await move(adminId, p2.id, 'PURCHASE', 5, 50_000, '2026-10-01T00:00:00.000Z');
  await move(adminId, p1.id, 'REPAIR_RETURN', 1, 10_000, '2026-10-02T10:00:00Z', j1.id);
  await move(adminId, p1.id, 'REPAIR_CONSUMPTION', -2, 10_000, '2026-10-05T10:00:00Z', j6.id);
  await move(adminId, p1.id, 'REPAIR_RETURN', 1, 10_000, '2026-10-06T10:00:00Z', j6.id);
  await move(adminId, p3.id, 'PURCHASE', 20, 500, '2026-10-10T10:00:00Z');
  await move(adminId, p3.id, 'REPAIR_CONSUMPTION', -3, 500, '2026-10-12T10:00:00Z', j6.id);
  await move(adminId, p3.id, 'REPAIR_CONSUMPTION', -2, 500, '2026-10-19T10:00:00Z', j10.id);
  await move(adminId, p4.id, 'PURCHASE', 2, 1_000, '2026-10-20T10:00:00Z');
  await move(adminId, p2.id, 'REPAIR_CONSUMPTION', -1, 50_000, '2026-10-31T23:59:59.999Z', j3.id);
  await move(adminId, p2.id, 'REPAIR_CONSUMPTION', -1, 50_000, '2026-11-01T00:00:00.000Z', j4.id);

  return { admin, alpha, bravo, charlie, p1, p2, p3, p4 };
}

beforeEach(resetDatabase);

describe('operations report against the fixture', () => {
  it('counts devices, jobs, turnaround, revenue, statuses and workload exactly', async () => {
    const { admin, alpha, bravo, charlie } = await buildFixture();
    const res = await admin.get(`/api/v1/reports/operations?${RANGE}`);
    expect(res.status).toBe(200);
    const r = res.body.data;

    expect(r.range).toEqual({ from: '2026-10-01', to: '2026-10-31', days: 31, bucket: 'day' });
    expect(r.currency).toBe('ZAR');

    // 11 job devices (7 open jobs → IN_REPAIR, 4 finished → ACTIVE) and 2 stock devices.
    expect(r.devices).toEqual({
      total: 13,
      byStatus: { IN_STOCK: 2, ACTIVE: 4, IN_REPAIR: 7, REFURBISHING: 0, RETIRED: 0, DISPOSED: 0 },
      registered: 1,
    });

    // Opened in range: j1, j3, j4, j5, j6, j7, j10. Completed: j1, j2, j3, j10 (not j4).
    // Abandoned: j5 (j9 was returned the instant before the range).
    // Open now: j2, j3, j4 (completed), j6, j7, j8, j11.
    expect(r.jobs).toEqual({ openNow: 7, opened: 7, completed: 4, abandoned: 1 });

    // 48, 62, 36 (less 1 ms) and 24 hours: average 42.5, median (36 + 48) / 2 = 42.
    expect(r.turnaround).toEqual({ jobs: 4, averageHours: 42.5, medianHours: 42 });

    // Approved quotations of j1 (rev 2), j2, j3, j10. Not j1's superseded revision,
    // j4 (completed after the range) or j7 (only issued).
    expect(r.revenue).toEqual({
      jobs: 4,
      subtotalCents: 200_000,
      vatCents: 30_000,
      totalCents: 230_000,
    });

    const statuses = Object.fromEntries(
      r.statusDistribution.map((s: { status: string; count: number }) => [s.status, s.count]),
    );
    expect(statuses).toEqual({
      SUBMITTED: 1,
      ASSIGNED: 0,
      DIAGNOSING: 0,
      AWAITING_APPROVAL: 1,
      APPROVED: 0,
      QUOTE_REJECTED: 0,
      IN_REPAIR: 1,
      AWAITING_PARTS: 1,
      QUALITY_CHECK: 0,
      COMPLETED: 3,
    });

    // Delta is deactivated with no work, so is left out. Completed jobs waiting for
    // collection do not count as open workload.
    expect(r.technicians).toEqual([
      {
        id: alpha.id,
        fullName: 'Alpha Tech',
        isActive: true,
        openJobs: 2,
        completedJobs: 2,
        labourMinutes: 90,
      },
      {
        id: bravo.id,
        fullName: 'Bravo Tech',
        isActive: true,
        openJobs: 1,
        completedJobs: 1,
        labourMinutes: 45,
      },
      {
        id: charlie.id,
        fullName: 'Charlie Tech',
        isActive: false,
        openJobs: 0,
        completedJobs: 1,
        labourMinutes: 0,
      },
    ]);
  });

  it('puts every opening, completion and rand of revenue in the right day', async () => {
    const { admin } = await buildFixture();
    const { trend } = (await admin.get(`/api/v1/reports/operations?${RANGE}`)).body.data;
    expect(trend).toHaveLength(31);
    expect(trend[0].start).toBe('2026-10-01');
    expect(trend[30].start).toBe('2026-10-31');
    const nonZero = trend.filter(
      (p: { opened: number; completed: number }) => p.opened || p.completed,
    );
    expect(nonZero).toEqual([
      { start: '2026-10-01', opened: 0, completed: 1, revenueCents: 50_000 },
      { start: '2026-10-02', opened: 1, completed: 0, revenueCents: 0 },
      { start: '2026-10-04', opened: 0, completed: 1, revenueCents: 100_000 },
      { start: '2026-10-10', opened: 1, completed: 0, revenueCents: 0 },
      { start: '2026-10-15', opened: 1, completed: 0, revenueCents: 0 },
      { start: '2026-10-16', opened: 1, completed: 0, revenueCents: 0 },
      { start: '2026-10-19', opened: 1, completed: 0, revenueCents: 0 },
      { start: '2026-10-20', opened: 1, completed: 1, revenueCents: 30_000 },
      { start: '2026-10-30', opened: 1, completed: 0, revenueCents: 0 },
      { start: '2026-10-31', opened: 0, completed: 1, revenueCents: 20_000 },
    ]);
    const sum = (k: 'opened' | 'completed' | 'revenueCents') =>
      trend.reduce((s: number, p: Record<typeof k, number>) => s + p[k], 0);
    expect([sum('opened'), sum('completed'), sum('revenueCents')]).toEqual([7, 4, 200_000]);
  });

  it('groups longer ranges by week from Monday, and by month', async () => {
    const { admin } = await buildFixture();
    const weeks = (await admin.get('/api/v1/reports/operations?from=2026-09-01&to=2026-10-31')).body
      .data;
    expect(weeks.range.bucket).toBe('week');
    // 2026-09-01 is a Tuesday, so the first week starts on Monday 2026-08-31.
    expect(weeks.trend[0].start).toBe('2026-08-31');
    expect(weeks.trend.at(-1).start).toBe('2026-10-26');
    // j2 (Thu 2026-10-01) and j1 (Sun 2026-10-04) both fall in the week of Monday 2026-09-28.
    const week = weeks.trend.find((p: { start: string }) => p.start === '2026-09-28');
    expect(week).toMatchObject({ completed: 2, revenueCents: 150_000 });
    expect(weeks.jobs.completed).toBe(4);
    // Now j9 (returned 2026-09-30) is inside the range.
    expect(weeks.jobs.abandoned).toBe(2);

    const months = (await admin.get('/api/v1/reports/operations?from=2026-01-01&to=2026-12-31'))
      .body.data;
    expect(months.range.bucket).toBe('month');
    expect(months.trend.map((p: { start: string }) => p.start)).toHaveLength(12);
    const nov = months.trend.find((p: { start: string }) => p.start === '2026-11-01');
    expect(nov).toMatchObject({ completed: 1, revenueCents: 99_900 });
    expect(months.revenue.subtotalCents).toBe(299_900);
  });

  it('reports zeros and no turnaround for an empty range', async () => {
    const { admin } = await buildFixture();
    const r = (await admin.get('/api/v1/reports/operations?from=2025-01-01&to=2025-01-07')).body
      .data;
    expect(r.jobs).toEqual({ openNow: 7, opened: 0, completed: 0, abandoned: 0 });
    expect(r.turnaround).toEqual({ jobs: 0, averageHours: null, medianHours: null });
    expect(r.revenue).toEqual({ jobs: 0, subtotalCents: 0, vatCents: 0, totalCents: 0 });
    expect(r.trend).toHaveLength(7);
  });
});

describe('inventory report against the fixture', () => {
  it('nets uses and returns inside the range and values stock now', async () => {
    const { admin, p2, p3, p4 } = await buildFixture();
    const res = await admin.get(`/api/v1/reports/inventory?${RANGE}`);
    expect(res.status).toBe(200);
    const r = res.body.data;

    // P1: −2 + 1 + 1 = 0 in range (its −1 is the instant before the range).
    // P2: −1 in range (the second −1 is the instant after). P3: −3 −2.
    expect(r.consumption).toEqual({
      units: 6,
      costCents: 52_500,
      parts: 2,
      jobs: 3,
      top: [
        { part: { id: p2.id, sku: 'P2-SCREEN', name: 'Screen' }, units: 1, costCents: 50_000 },
        { part: { id: p3.id, sku: 'P3-PASTE', name: 'Paste' }, units: 5, costCents: 2_500 },
      ],
    });
    // P2 5 × 500.00 (at the first instant), P3 20 × 5.00, P4 2 × 10.00. Not P1 (September).
    expect(r.receipts).toEqual({ units: 27, costCents: 262_000 });

    // Active parts P1 9, P2 3, P3 15, P4 2, P6 0 (P5 is archived).
    // Value 9 × 100 + 3 × 500 + 15 × 5 + 2 × 10 = R2 495.00.
    expect(r.stock).toEqual({
      parts: 5,
      units: 29,
      valueCents: 249_500,
      lowStock: 3,
      outOfStock: 1,
    });
    expect(
      r.lowStockParts.map((p: { name: string; stockState: string }) => [p.name, p.stockState]),
    ).toEqual([
      ['Empty part', 'OUT'],
      ['Cable', 'LOW'],
      ['Screen', 'LOW'],
    ]);
    expect(r.lowStockParts[1]).toMatchObject({ id: p4.id, quantityOnHand: 2, reorderLevel: 5 });
  });

  it('agrees with the ledger: stock value equals the parts at their average cost', async () => {
    await buildFixture();
    const admin = await loginAs('ADMIN');
    const r = (await admin.get(`/api/v1/reports/inventory?${RANGE}`)).body.data;
    const parts = await prisma.part.findMany({ where: { isActive: true } });
    expect(r.stock.valueCents).toBe(
      parts.reduce((s, p) => s + p.quantityOnHand * p.averageCostCents, 0),
    );
  });
});

describe('access and validation', () => {
  it('gives operations reports to administrators only, inventory reports to inventory managers too', async () => {
    const admin = await loginAs('ADMIN');
    const inventory = await loginAs('INVENTORY_MANAGER');
    const tech = await loginAs('TECHNICIAN');
    const account = await createCustomerAccount();
    const customer = await loginAs('CUSTOMER', { customerAccountId: account.id });
    expect((await admin.get('/api/v1/reports/operations')).status).toBe(200);
    expect((await admin.get('/api/v1/reports/inventory')).status).toBe(200);
    expect((await inventory.get('/api/v1/reports/inventory')).status).toBe(200);
    expect((await inventory.get('/api/v1/reports/operations')).status).toBe(403);
    for (const c of [tech, customer]) {
      expect((await c.get('/api/v1/reports/operations')).status).toBe(403);
      expect((await c.get('/api/v1/reports/inventory')).status).toBe(403);
    }
  });

  it('defaults to the last 30 days, ending today', async () => {
    const admin = await loginAs('ADMIN');
    const today = new Date().toISOString().slice(0, 10);
    const r = (await admin.get('/api/v1/reports/operations')).body.data;
    expect(r.range).toMatchObject({ to: today, days: 30, bucket: 'day' });
    expect(r.trend).toHaveLength(30);
    const onlyTo = (await admin.get('/api/v1/reports/inventory?to=2026-10-31')).body.data;
    expect(onlyTo.range).toMatchObject({ from: '2026-10-02', to: '2026-10-31', days: 30 });
  });

  it('refuses reversed, invalid and over-long ranges', async () => {
    const admin = await loginAs('ADMIN');
    for (const q of [
      'from=2026-10-31&to=2026-10-01',
      'from=2026-13-01&to=2026-12-31',
      'from=2020-01-01&to=2026-01-01',
      'from=2020-01-01',
    ]) {
      const res = await admin.get(`/api/v1/reports/operations?${q}`);
      expect(res.status, q).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_FAILED');
    }
  });
});
