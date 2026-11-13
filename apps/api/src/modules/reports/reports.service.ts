import {
  addDays,
  ASSET_STATUSES,
  bucketFor,
  daysInRange,
  defaultReportRange,
  MAX_REPORT_DAYS,
  OPEN_REPAIR_STATUSES,
  stockStateOf,
  TOP_PARTS_LIMIT,
  type AssetStatus,
  type InventoryReport,
  type OperationsReport,
  type ReportBucket,
  type ReportQuery,
  type ReportRange,
} from '@deviceflow/shared';
import { AppError } from '../../lib/errors.js';
import { prisma, type Tx } from '../../lib/prisma.js';

/*
 * Reports (Phase 6). The definitions are in packages/shared/src/schemas/reports.ts
 * and docs/API.md; test/integration/reports.test.ts checks every figure against
 * fixtures, including the edges of the date range.
 *
 * Each report reads in one REPEATABLE READ transaction, so all its figures come
 * from the same snapshot even while jobs and stock change. The queries run one
 * after another because a transaction has a single connection.
 */

interface Bounds {
  range: ReportRange;
  /** Inclusive start: 00:00 UTC on `from`. */
  start: Date;
  /** Exclusive end: 00:00 UTC on the day after `to`. */
  end: Date;
}

/**
 * Resolves the range: both dates as given; only `to` gives the 30 days ending
 * then; only `from` runs to today (or is just that day, if it is in the future);
 * neither gives the last 30 days.
 */
export function boundsOf(
  query: ReportQuery,
  today = new Date().toISOString().slice(0, 10),
): Bounds {
  const to = query.to ?? (query.from && query.from > today ? query.from : today);
  const from = query.from ?? defaultReportRange(to).from;
  const days = daysInRange(from, to);
  if (days > MAX_REPORT_DAYS) {
    throw new AppError(
      400,
      'VALIDATION_FAILED',
      `A report can cover at most ${MAX_REPORT_DAYS} days`,
      [{ path: 'from', message: `At most ${MAX_REPORT_DAYS} days` }],
    );
  }
  return {
    range: { from, to, days, bucket: bucketFor(days) },
    start: new Date(`${from}T00:00:00.000Z`),
    end: new Date(`${addDays(to, 1)}T00:00:00.000Z`),
  };
}

/** The first day of every bucket that overlaps the range. */
export function bucketStarts(from: string, to: string, bucket: ReportBucket): string[] {
  const d = new Date(`${from}T00:00:00Z`);
  if (bucket === 'week') d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
  if (bucket === 'month') d.setUTCDate(1);
  const starts: string[] = [];
  while (d.toISOString().slice(0, 10) <= to) {
    starts.push(d.toISOString().slice(0, 10));
    if (bucket === 'day') d.setUTCDate(d.getUTCDate() + 1);
    else if (bucket === 'week') d.setUTCDate(d.getUTCDate() + 7);
    else d.setUTCMonth(d.getUTCMonth() + 1);
  }
  return starts;
}

const OPEN = [...OPEN_REPAIR_STATUSES];
/** Workload counts jobs still being worked on, not ones waiting for collection. */
const IN_PROGRESS = OPEN.filter((s) => s !== 'COMPLETED');

/** Seconds to hours, one decimal. */
function hours(seconds: number | null): number | null {
  return seconds === null ? null : Math.round((seconds / 3600) * 10) / 10;
}

async function currency(tx: Tx): Promise<string> {
  return (await tx.companySettings.findUniqueOrThrow({ where: { id: 1 } })).currency;
}

type Series = Array<{ start: string; n: number }>;

function seriesMap(rows: Series): Map<string, number> {
  return new Map(rows.map((r) => [r.start, Number(r.n)]));
}

export async function operationsReport(
  query: ReportQuery,
  today?: string,
): Promise<OperationsReport> {
  const { range, start, end } = boundsOf(query, today);
  const inRange = { gte: start, lt: end };
  const bucket = range.bucket;

  return prisma.$transaction(
    async (tx) => {
      // Devices
      const byStatus = Object.fromEntries(ASSET_STATUSES.map((s) => [s, 0])) as Record<
        AssetStatus,
        number
      >;
      const assets = await tx.asset.groupBy({ by: ['status'], _count: { _all: true } });
      for (const row of assets) byStatus[row.status] = row._count._all;
      const registered = await tx.asset.count({ where: { createdAt: inRange } });

      // Jobs
      const openNow = await tx.repairJob.count({ where: { status: { in: OPEN } } });
      const opened = await tx.repairJob.count({ where: { createdAt: inRange } });
      const completed = await tx.repairJob.count({ where: { completedAt: inRange } });
      const abandoned = await tx.repairJob.count({
        where: { status: { in: ['CANCELLED', 'RETURNED_UNREPAIRED'] }, closedAt: inRange },
      });
      const openByStatus = await tx.repairJob.groupBy({
        by: ['status'],
        where: { status: { in: OPEN } },
        _count: { _all: true },
      });

      // Turnaround: booking in to completion.
      const [turnaround] = await tx.$queryRaw<
        Array<{ jobs: number; average: number | null; median: number | null }>
      >`
        SELECT count(*)::int AS "jobs",
               avg(extract(epoch FROM "completed_at" - "created_at"))::float8 AS "average",
               percentile_cont(0.5) WITHIN GROUP (
                 ORDER BY extract(epoch FROM "completed_at" - "created_at")
               )::float8 AS "median"
        FROM "repair_jobs"
        WHERE "completed_at" >= ${start} AND "completed_at" < ${end}`;

      // Billed revenue: approved quotations of jobs completed in the range.
      const revenue = await tx.quotation.aggregate({
        where: { status: 'APPROVED', repairJob: { completedAt: inRange } },
        _count: { _all: true },
        _sum: { subtotalCents: true, vatCents: true, totalCents: true },
      });

      // Technician workload
      const technicians = await tx.user.findMany({
        where: { role: 'TECHNICIAN' },
        select: { id: true, fullName: true, isActive: true },
        orderBy: { fullName: 'asc' },
      });
      const ids = technicians.map((t) => t.id);
      const openByTech = await tx.repairJob.groupBy({
        by: ['assignedTechnicianId'],
        where: { assignedTechnicianId: { in: ids }, status: { in: IN_PROGRESS } },
        _count: { _all: true },
      });
      const completedByTech = await tx.repairJob.groupBy({
        by: ['assignedTechnicianId'],
        where: { assignedTechnicianId: { in: ids }, completedAt: inRange },
        _count: { _all: true },
      });
      const labourByTech = await tx.labourEntry.groupBy({
        by: ['userId'],
        where: {
          userId: { in: ids },
          workDate: { gte: start, lte: new Date(`${range.to}T00:00:00.000Z`) },
        },
        _sum: { minutes: true },
      });
      const openMap = new Map(openByTech.map((r) => [r.assignedTechnicianId, r._count._all]));
      const doneMap = new Map(completedByTech.map((r) => [r.assignedTechnicianId, r._count._all]));
      const labourMap = new Map(labourByTech.map((r) => [r.userId, r._sum.minutes ?? 0]));
      const workload = technicians
        .map((t) => ({
          ...t,
          openJobs: openMap.get(t.id) ?? 0,
          completedJobs: doneMap.get(t.id) ?? 0,
          labourMinutes: labourMap.get(t.id) ?? 0,
        }))
        // Deactivated technicians appear only when they have work to show.
        .filter((t) => t.isActive || t.openJobs + t.completedJobs + t.labourMinutes > 0);

      // Trend, by day, week (from Monday) or month, in UTC.
      const openedSeries = await tx.$queryRaw<Series>`
        SELECT to_char(date_trunc(${bucket}, "created_at" AT TIME ZONE 'UTC'), 'YYYY-MM-DD') AS "start",
               count(*)::int AS "n"
        FROM "repair_jobs"
        WHERE "created_at" >= ${start} AND "created_at" < ${end}
        GROUP BY 1`;
      const completedSeries = await tx.$queryRaw<Series>`
        SELECT to_char(date_trunc(${bucket}, "completed_at" AT TIME ZONE 'UTC'), 'YYYY-MM-DD') AS "start",
               count(*)::int AS "n"
        FROM "repair_jobs"
        WHERE "completed_at" >= ${start} AND "completed_at" < ${end}
        GROUP BY 1`;
      const revenueSeries = await tx.$queryRaw<Series>`
        SELECT to_char(date_trunc(${bucket}, j."completed_at" AT TIME ZONE 'UTC'), 'YYYY-MM-DD') AS "start",
               sum(q."subtotal_cents")::float8 AS "n"
        FROM "quotations" q
        JOIN "repair_jobs" j ON j."id" = q."repair_job_id"
        WHERE q."status" = 'APPROVED'
          AND j."completed_at" >= ${start} AND j."completed_at" < ${end}
        GROUP BY 1`;
      const o = seriesMap(openedSeries);
      const c = seriesMap(completedSeries);
      const r = seriesMap(revenueSeries);

      return {
        range,
        currency: await currency(tx),
        devices: {
          total: Object.values(byStatus).reduce((a, b) => a + b, 0),
          byStatus,
          registered,
        },
        jobs: { openNow, opened, completed, abandoned },
        turnaround: {
          jobs: turnaround?.jobs ?? 0,
          averageHours: hours(turnaround?.average ?? null),
          medianHours: hours(turnaround?.median ?? null),
        },
        revenue: {
          jobs: revenue._count._all,
          subtotalCents: revenue._sum.subtotalCents ?? 0,
          vatCents: revenue._sum.vatCents ?? 0,
          totalCents: revenue._sum.totalCents ?? 0,
        },
        statusDistribution: OPEN.map((status) => ({
          status,
          count: openByStatus.find((row) => row.status === status)?._count._all ?? 0,
        })),
        technicians: workload,
        trend: bucketStarts(range.from, range.to, bucket).map((s) => ({
          start: s,
          opened: o.get(s) ?? 0,
          completed: c.get(s) ?? 0,
          revenueCents: Math.round(r.get(s) ?? 0),
        })),
      };
    },
    { isolationLevel: 'RepeatableRead' },
  );
}

export async function inventoryReport(
  query: ReportQuery,
  today?: string,
): Promise<InventoryReport> {
  const { range, start, end } = boundsOf(query, today);

  return prisma.$transaction(
    async (tx) => {
      // Net use per part in the range (used minus returned), at the cost recorded
      // on each movement.
      const usage = await tx.$queryRaw<Array<{ partId: string; units: number; cost: number }>>`
        SELECT "part_id" AS "partId",
               (-sum("quantity_change"))::int AS "units",
               (-sum("quantity_change"::bigint * "unit_cost_cents"))::float8 AS "cost"
        FROM "stock_movements"
        WHERE "type" IN ('REPAIR_CONSUMPTION', 'REPAIR_RETURN')
          AND "created_at" >= ${start} AND "created_at" < ${end}
        GROUP BY "part_id"`;
      const [jobsWithParts] = await tx.$queryRaw<Array<{ n: number }>>`
        SELECT count(DISTINCT "repair_job_id")::int AS "n"
        FROM "stock_movements"
        WHERE "type" = 'REPAIR_CONSUMPTION'
          AND "created_at" >= ${start} AND "created_at" < ${end}`;
      const [receipts] = await tx.$queryRaw<Array<{ units: number; cost: number }>>`
        SELECT coalesce(sum("quantity_change"), 0)::int AS "units",
               coalesce(sum("quantity_change"::bigint * "unit_cost_cents"), 0)::float8 AS "cost"
        FROM "stock_movements"
        WHERE "type" = 'PURCHASE' AND "created_at" >= ${start} AND "created_at" < ${end}`;
      const [stock] = await tx.$queryRaw<
        Array<{ parts: number; units: number; value: number; low: number; out: number }>
      >`
        SELECT count(*)::int AS "parts",
               coalesce(sum("quantity_on_hand"), 0)::int AS "units",
               coalesce(sum("quantity_on_hand"::bigint * "average_cost_cents"), 0)::float8 AS "value",
               (count(*) FILTER (WHERE "quantity_on_hand" <= "reorder_level"))::int AS "low",
               (count(*) FILTER (WHERE "quantity_on_hand" = 0))::int AS "out"
        FROM "parts"
        WHERE "is_active"`;

      const parts = await tx.part.findMany({
        where: { id: { in: usage.map((u) => u.partId) } },
        select: { id: true, sku: true, name: true },
      });
      const byId = new Map(parts.map((p) => [p.id, p]));
      const used = usage.filter((u) => u.units > 0);
      const top = used
        .map((u) => ({ part: byId.get(u.partId)!, units: u.units, costCents: Math.round(u.cost) }))
        .sort((a, b) => b.costCents - a.costCents || a.part.name.localeCompare(b.part.name))
        .slice(0, TOP_PARTS_LIMIT);

      const low = await tx.part.findMany({
        where: { isActive: true, quantityOnHand: { lte: prisma.part.fields.reorderLevel } },
        orderBy: [{ quantityOnHand: 'asc' }, { name: 'asc' }],
        take: 10,
        select: { id: true, sku: true, name: true, quantityOnHand: true, reorderLevel: true },
      });

      return {
        range,
        currency: await currency(tx),
        consumption: {
          units: usage.reduce((sum, u) => sum + u.units, 0),
          costCents: Math.round(usage.reduce((sum, u) => sum + u.cost, 0)),
          parts: used.length,
          jobs: jobsWithParts?.n ?? 0,
          top,
        },
        receipts: { units: receipts?.units ?? 0, costCents: Math.round(receipts?.cost ?? 0) },
        stock: {
          parts: stock?.parts ?? 0,
          units: stock?.units ?? 0,
          valueCents: Math.round(stock?.value ?? 0),
          lowStock: stock?.low ?? 0,
          outOfStock: stock?.out ?? 0,
        },
        lowStockParts: low.map((p) => ({
          ...p,
          stockState: stockStateOf(p.quantityOnHand, p.reorderLevel),
        })),
      };
    },
    { isolationLevel: 'RepeatableRead' },
  );
}
