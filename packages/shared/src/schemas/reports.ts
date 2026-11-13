import { z } from 'zod';
import { ASSET_STATUSES } from './assets.js';
import { partRefSchema, STOCK_STATES } from './inventory.js';
import { OPEN_REPAIR_STATUSES, REPAIR_STATUSES } from './repairs.js';

/*
 * Reporting (Phase 6). Every figure has one definition, written here and in
 * docs/API.md, and the integration tests check each one against fixtures.
 *
 * Dates are calendar days in UTC, inclusive at both ends: a range from
 * 2026-11-01 to 2026-11-30 covers 2026-11-01T00:00Z up to, but not including,
 * 2026-12-01T00:00Z. "Now" figures (open jobs, stock) ignore the range.
 */

/** The longest range a report covers: two years. */
export const MAX_REPORT_DAYS = 731;
/** Default range: the last 30 days, ending today. */
export const DEFAULT_REPORT_DAYS = 30;

const DAY_MS = 24 * 60 * 60_000;

export function addDays(date: string, days: number): string {
  return new Date(Date.parse(`${date}T00:00:00Z`) + days * DAY_MS).toISOString().slice(0, 10);
}

/** Days in an inclusive range of calendar dates. */
export function daysInRange(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY_MS) + 1;
}

/** The default range ending on `today` (YYYY-MM-DD, UTC). */
export function defaultReportRange(today: string): { from: string; to: string } {
  return { from: addDays(today, -(DEFAULT_REPORT_DAYS - 1)), to: today };
}

export const REPORT_BUCKETS = ['day', 'week', 'month'] as const;
export type ReportBucket = (typeof REPORT_BUCKETS)[number];

/** Daily up to a month, weekly (from Monday) up to about six months, then monthly. */
export function bucketFor(days: number): ReportBucket {
  if (days <= 31) return 'day';
  if (days <= 183) return 'week';
  return 'month';
}

export const reportQuerySchema = z
  .object({
    from: z.iso.date({ message: 'Enter a valid start date' }).optional(),
    to: z.iso.date({ message: 'Enter a valid end date' }).optional(),
  })
  .refine((q) => !q.from || !q.to || q.from <= q.to, {
    message: 'The start date must be on or before the end date',
    path: ['from'],
  })
  .refine((q) => !q.from || !q.to || daysInRange(q.from, q.to) <= MAX_REPORT_DAYS, {
    message: `A report can cover at most ${MAX_REPORT_DAYS} days`,
    path: ['from'],
  });
export type ReportQuery = z.infer<typeof reportQuerySchema>;

export const reportRangeSchema = z.object({
  from: z.string(),
  to: z.string(),
  days: z.number().int(),
  bucket: z.enum(REPORT_BUCKETS),
});
export type ReportRange = z.infer<typeof reportRangeSchema>;

// --- Operations ---------------------------------------------------------------------

export const technicianWorkloadSchema = z.object({
  id: z.uuid(),
  fullName: z.string(),
  isActive: z.boolean(),
  /** Assigned open jobs now, not counting completed jobs waiting for collection. */
  openJobs: z.number().int(),
  /** Assigned jobs completed in the range. */
  completedJobs: z.number().int(),
  /** Labour they recorded with a work date in the range. */
  labourMinutes: z.number().int(),
});
export type TechnicianWorkload = z.infer<typeof technicianWorkloadSchema>;

export const operationsTrendPointSchema = z.object({
  /** First day of the bucket (a Monday for weeks, the 1st for months). */
  start: z.string(),
  opened: z.number().int(),
  completed: z.number().int(),
  /** Billed revenue excluding VAT, in cents. */
  revenueCents: z.number().int(),
});
export type OperationsTrendPoint = z.infer<typeof operationsTrendPointSchema>;

export const operationsReportSchema = z.object({
  range: reportRangeSchema,
  currency: z.string(),
  devices: z.object({
    /** Every registered device now, whatever its status. */
    total: z.number().int(),
    byStatus: z.record(z.enum(ASSET_STATUSES), z.number().int()),
    /** Devices registered in the range. */
    registered: z.number().int(),
  }),
  jobs: z.object({
    /** Jobs not closed, returned unrepaired or cancelled, now. */
    openNow: z.number().int(),
    /** Jobs booked in (created) in the range. */
    opened: z.number().int(),
    /** Jobs that reached COMPLETED in the range (including those since closed). */
    completed: z.number().int(),
    /** Jobs cancelled or returned unrepaired in the range. */
    abandoned: z.number().int(),
  }),
  /** Booking-in to completion, for jobs completed in the range. */
  turnaround: z.object({
    jobs: z.number().int(),
    averageHours: z.number().nullable(),
    medianHours: z.number().nullable(),
  }),
  /**
   * Billed revenue: the approved quotation of each job completed in the range
   * (Phase 1 assumption 3: not cash received; there is no invoicing in v1).
   */
  revenue: z.object({
    jobs: z.number().int(),
    subtotalCents: z.number().int(),
    vatCents: z.number().int(),
    totalCents: z.number().int(),
  }),
  /** Open jobs now, by status, in workflow order (zeros included). */
  statusDistribution: z.array(
    z.object({ status: z.enum(REPAIR_STATUSES), count: z.number().int() }),
  ),
  technicians: z.array(technicianWorkloadSchema),
  trend: z.array(operationsTrendPointSchema),
});
export type OperationsReport = z.infer<typeof operationsReportSchema>;

/** The statuses shown in the status distribution: every open status. */
export const REPORT_OPEN_STATUSES = OPEN_REPAIR_STATUSES;

// --- Inventory -------------------------------------------------------------------------

export const partConsumptionSchema = z.object({
  part: partRefSchema,
  /** Units used on repairs in the range, minus units returned in the range. */
  units: z.number().int(),
  costCents: z.number().int(),
});
export type PartConsumption = z.infer<typeof partConsumptionSchema>;

/** The most parts the consumption table lists, by cost. */
export const TOP_PARTS_LIMIT = 10;

export const inventoryReportSchema = z.object({
  range: reportRangeSchema,
  currency: z.string(),
  consumption: z.object({
    units: z.number().int(),
    costCents: z.number().int(),
    /** Distinct parts with net use above zero in the range. */
    parts: z.number().int(),
    /** Repair jobs that used parts in the range. */
    jobs: z.number().int(),
    /** The parts with the highest net cost, at most TOP_PARTS_LIMIT. */
    top: z.array(partConsumptionSchema),
  }),
  /** Purchases received in the range. */
  receipts: z.object({ units: z.number().int(), costCents: z.number().int() }),
  /** Stock now (active parts). */
  stock: z.object({
    parts: z.number().int(),
    units: z.number().int(),
    valueCents: z.number().int(),
    lowStock: z.number().int(),
    outOfStock: z.number().int(),
  }),
  /** Active parts at or below their reorder level now, least in stock first (at most 10). */
  lowStockParts: z.array(
    partRefSchema.extend({
      quantityOnHand: z.number().int(),
      reorderLevel: z.number().int(),
      stockState: z.enum(STOCK_STATES),
    }),
  ),
});
export type InventoryReport = z.infer<typeof inventoryReportSchema>;
