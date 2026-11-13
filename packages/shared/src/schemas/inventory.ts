import { z } from 'zod';
import { userRefSchema } from './assets.js';
import { paginationSchema, sortSchema } from './common.js';
import { hasChanges, optionalText, versionField } from './fields.js';
import type { RepairStatus } from './repairs.js';

/*
 * Inventory (Phase 1, §3.3). Parts are counted in whole units. Stock changes
 * only through movements in an append-only ledger; the stored stock figure and
 * the ledger are kept equal by the database.
 */

// --- Parts -------------------------------------------------------------------

export const PART_CATEGORIES = [
  'SCREEN',
  'BATTERY',
  'STORAGE',
  'MEMORY',
  'KEYBOARD',
  'POWER',
  'CABLE',
  'BOARD',
  'PERIPHERAL',
  'CONSUMABLE',
  'OTHER',
] as const;
export type PartCategory = (typeof PART_CATEGORIES)[number];

export const PART_CATEGORY_LABELS: Record<PartCategory, string> = {
  SCREEN: 'Screens and displays',
  BATTERY: 'Batteries',
  STORAGE: 'Storage',
  MEMORY: 'Memory',
  KEYBOARD: 'Keyboards and input',
  POWER: 'Power supplies and chargers',
  CABLE: 'Cables and connectors',
  BOARD: 'Boards',
  PERIPHERAL: 'Peripherals',
  CONSUMABLE: 'Consumables',
  OTHER: 'Other',
};

/** OUT: none in stock. LOW: at or below the reorder level (Phase 1: quantity <= reorder level). */
export const STOCK_STATES = ['OK', 'LOW', 'OUT'] as const;
export type StockState = (typeof STOCK_STATES)[number];

export const STOCK_STATE_LABELS: Record<StockState, string> = {
  OK: 'In stock',
  LOW: 'Low stock',
  OUT: 'Out of stock',
};

export function stockStateOf(quantityOnHand: number, reorderLevel: number): StockState {
  if (quantityOnHand <= 0) return 'OUT';
  if (quantityOnHand <= reorderLevel) return 'LOW';
  return 'OK';
}

/** Trimmed and upper-cased, matching the parts_sku_normalised_chk constraint. */
export function normaliseSku(sku: string): string {
  return sku.trim().toUpperCase();
}

/** The most units one movement can move. */
export const MAX_MOVEMENT_QUANTITY = 10_000;
/** Unit cost limit: R1 000 000.00. */
export const MAX_UNIT_COST_CENTS = 100_000_000;
export const MAX_REORDER_LEVEL = 100_000;

const sku = z
  .string()
  .trim()
  .min(1, 'Enter a SKU')
  .max(40, 'Must be at most 40 characters')
  .regex(/^[A-Za-z0-9][A-Za-z0-9._/-]*$/, 'Use letters, digits, dots, dashes or slashes')
  .transform(normaliseSku);

const partFields = {
  sku,
  name: z.string().trim().min(1, 'Enter a name').max(160),
  category: z.enum(PART_CATEGORIES),
  description: optionalText(1000),
  location: optionalText(40),
  reorderLevel: z
    .number({ message: 'Enter a reorder level' })
    .int('Use whole units')
    .min(0, 'Cannot be negative')
    .max(MAX_REORDER_LEVEL, `At most ${MAX_REORDER_LEVEL}`),
};

/** New parts start with no stock; stock arrives through a purchase or an adjustment. */
export const createPartSchema = z.object(partFields);
export type CreatePartInput = z.infer<typeof createPartSchema>;

/** `isActive: false` archives the part (only when it has no stock); `true` restores it. */
export const updatePartSchema = z
  .object(partFields)
  .partial()
  .extend({ isActive: z.boolean().optional(), version: versionField })
  .refine(hasChanges, { message: 'Provide at least one field to change' });
export type UpdatePartInput = z.infer<typeof updatePartSchema>;

export const PART_SORT_FIELDS = ['name', 'sku', 'quantityOnHand', 'updatedAt'] as const;
export const PART_STOCK_FILTERS = ['low', 'out'] as const;

export const listPartsQuerySchema = paginationSchema.extend({
  /** SKU, name or location. */
  search: z.string().trim().max(100).optional(),
  category: z.enum(PART_CATEGORIES).optional(),
  /** low = at or below the reorder level (includes out of stock); out = none in stock. */
  stock: z.enum(PART_STOCK_FILTERS).optional(),
  /** Defaults to active parts only. */
  isActive: z.stringbool().default(true),
  sort: sortSchema(PART_SORT_FIELDS, 'name:asc'),
});
export type ListPartsQuery = z.infer<typeof listPartsQuerySchema>;

export const partRefSchema = z.object({ id: z.uuid(), sku: z.string(), name: z.string() });
export type PartRef = z.infer<typeof partRefSchema>;

export const partSchema = partRefSchema.extend({
  category: z.enum(PART_CATEGORIES),
  description: z.string().nullable(),
  location: z.string().nullable(),
  quantityOnHand: z.number().int(),
  reorderLevel: z.number().int(),
  stockState: z.enum(STOCK_STATES),
  averageCostCents: z.number().int(),
  /** quantityOnHand × averageCostCents. */
  stockValueCents: z.number().int(),
  isActive: z.boolean(),
  createdAt: z.string(),
  updatedAt: z.string(),
  version: z.number().int(),
});
export type Part = z.infer<typeof partSchema>;

// --- Stock movements ---------------------------------------------------------

export const STOCK_MOVEMENT_TYPES = [
  'PURCHASE',
  'ADJUSTMENT_IN',
  'ADJUSTMENT_OUT',
  'REPAIR_CONSUMPTION',
  'REPAIR_RETURN',
] as const;
export type StockMovementType = (typeof STOCK_MOVEMENT_TYPES)[number];

export const STOCK_MOVEMENT_TYPE_LABELS: Record<StockMovementType, string> = {
  PURCHASE: 'Received',
  ADJUSTMENT_IN: 'Adjusted up',
  ADJUSTMENT_OUT: 'Adjusted down',
  REPAIR_CONSUMPTION: 'Used in repair',
  REPAIR_RETURN: 'Returned from repair',
};

const movementQuantity = z
  .number({ message: 'Enter a quantity' })
  .int('Use whole units')
  .min(1, 'At least 1')
  .max(MAX_MOVEMENT_QUANTITY, `At most ${MAX_MOVEMENT_QUANTITY} at a time`);

export const recordPurchaseSchema = z.object({
  quantity: movementQuantity,
  unitCostCents: z
    .number({ message: 'Enter the cost per unit' })
    .int('Use whole cents')
    .min(0, 'Cannot be negative')
    .max(MAX_UNIT_COST_CENTS, 'At most R1 000 000 per unit'),
  supplier: optionalText(160),
  reference: optionalText(80),
  note: optionalText(1000),
});
export type RecordPurchaseInput = z.infer<typeof recordPurchaseSchema>;

export const ADJUSTMENT_DIRECTIONS = ['IN', 'OUT'] as const;
export type AdjustmentDirection = (typeof ADJUSTMENT_DIRECTIONS)[number];

/** A correction after a count, a write-off of damaged stock, a found item… The reason is required. */
export const recordAdjustmentSchema = z.object({
  direction: z.enum(ADJUSTMENT_DIRECTIONS, { message: 'Choose add or remove' }),
  quantity: movementQuantity,
  note: z
    .string()
    .trim()
    .min(1, 'Give a reason for the adjustment')
    .max(1000, 'Must be at most 1000 characters'),
});
export type RecordAdjustmentInput = z.infer<typeof recordAdjustmentSchema>;

export const listMovementsQuerySchema = paginationSchema.extend({
  type: z.enum(STOCK_MOVEMENT_TYPES).optional(),
  part: z.uuid().optional(),
  repairJob: z.uuid().optional(),
  /** Inclusive calendar dates (UTC). */
  from: z.iso.date().optional(),
  to: z.iso.date().optional(),
});
export type ListMovementsQuery = z.infer<typeof listMovementsQuerySchema>;

export const stockMovementSchema = z.object({
  id: z.uuid(),
  type: z.enum(STOCK_MOVEMENT_TYPES),
  part: partRefSchema,
  /** Positive adds stock, negative removes it. */
  quantityChange: z.number().int(),
  balanceAfter: z.number().int(),
  unitCostCents: z.number().int(),
  supplier: z.string().nullable(),
  reference: z.string().nullable(),
  note: z.string().nullable(),
  repairJob: z.object({ id: z.uuid(), reference: z.string() }).nullable(),
  actor: userRefSchema,
  createdAt: z.string(),
});
export type StockMovement = z.infer<typeof stockMovementSchema>;

// --- Parts on repair jobs ----------------------------------------------------------

/** Parts can be used on (and returned from) a job only while the repair is under way. */
export const PART_USAGE_STATUSES: readonly RepairStatus[] = [
  'IN_REPAIR',
  'AWAITING_PARTS',
  'QUALITY_CHECK',
];

export const useRepairPartSchema = z.object({
  partId: z.uuid({ message: 'Choose a part' }),
  quantity: movementQuantity,
  note: optionalText(1000),
});
export type UseRepairPartInput = z.infer<typeof useRepairPartSchema>;

/** Puts unused units back in stock. A job can return at most what it has used. */
export const returnRepairPartSchema = useRepairPartSchema;
export type ReturnRepairPartInput = z.infer<typeof returnRepairPartSchema>;

export const repairPartLineSchema = z.object({
  part: partRefSchema,
  /** Used minus returned. */
  quantity: z.number().int(),
  /** Cost of the units still used, at the cost recorded on each movement. */
  costCents: z.number().int(),
});
export type RepairPartLine = z.infer<typeof repairPartLineSchema>;

export const repairPartsSchema = z.object({
  /** One line per part still in use on the job (net quantity above zero). */
  lines: z.array(repairPartLineSchema),
  totalCostCents: z.number().int(),
  /** Every use and return on the job, newest first. */
  movements: z.array(stockMovementSchema),
});
export type RepairParts = z.infer<typeof repairPartsSchema>;
