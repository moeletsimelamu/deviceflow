import { z } from 'zod';
import { paginationSchema, sortSchema } from './common.js';
import { customerSummarySchema } from './customers.js';
import {
  hasChanges,
  latestAllowedDate,
  optionalDate,
  optionalText,
  versionField,
} from './fields.js';

export const ASSET_CATEGORIES = [
  'LAPTOP',
  'DESKTOP',
  'TABLET',
  'PHONE',
  'PRINTER',
  'MONITOR',
  'NETWORK',
  'OTHER',
] as const;
export type AssetCategory = (typeof ASSET_CATEGORIES)[number];

export const ASSET_CATEGORY_LABELS: Record<AssetCategory, string> = {
  LAPTOP: 'Laptop',
  DESKTOP: 'Desktop',
  TABLET: 'Tablet',
  PHONE: 'Phone',
  PRINTER: 'Printer',
  MONITOR: 'Monitor',
  NETWORK: 'Network device',
  OTHER: 'Other',
};

export const ASSET_CONDITIONS = ['NEW', 'GOOD', 'FAIR', 'POOR', 'FAULTY'] as const;
export type AssetCondition = (typeof ASSET_CONDITIONS)[number];

export const ASSET_CONDITION_LABELS: Record<AssetCondition, string> = {
  NEW: 'New',
  GOOD: 'Good',
  FAIR: 'Fair',
  POOR: 'Poor',
  FAULTY: 'Faulty',
};

export const ASSET_STATUSES = [
  'IN_STOCK',
  'ACTIVE',
  'IN_REPAIR',
  'REFURBISHING',
  'RETIRED',
  'DISPOSED',
] as const;
export type AssetStatus = (typeof ASSET_STATUSES)[number];

export const ASSET_STATUS_LABELS: Record<AssetStatus, string> = {
  IN_STOCK: 'In stock',
  ACTIVE: 'Active',
  IN_REPAIR: 'In repair',
  REFURBISHING: 'Refurbishing',
  RETIRED: 'Retired',
  DISPOSED: 'Disposed',
};

export const ASSET_STATUS_DESCRIPTIONS: Record<AssetStatus, string> = {
  IN_STOCK: 'Held by the service company, not in use.',
  ACTIVE: 'In use by the assigned customer.',
  IN_REPAIR: 'Being repaired.',
  REFURBISHING: 'Being prepared for reuse.',
  RETIRED: 'Taken out of service.',
  DISPOSED: 'Disposed of or recycled. Final.',
};

/**
 * Asset lifecycle (Phase 1, §3.4). The API rejects any change not listed here
 * with 422 INVALID_TRANSITION. DISPOSED is final.
 */
export const ASSET_TRANSITIONS: Record<AssetStatus, readonly AssetStatus[]> = {
  IN_STOCK: ['ACTIVE', 'REFURBISHING', 'RETIRED'],
  ACTIVE: ['IN_REPAIR', 'IN_STOCK', 'RETIRED'],
  IN_REPAIR: ['ACTIVE', 'REFURBISHING', 'RETIRED'],
  REFURBISHING: ['IN_STOCK', 'ACTIVE', 'RETIRED'],
  RETIRED: ['DISPOSED'],
  DISPOSED: [],
};

/**
 * Statuses that only repair jobs set (Phase 4). A device goes IN_REPAIR when a
 * repair job is opened for it and back to ACTIVE when the job is closed, returned
 * or cancelled; the status endpoint refuses to move a device into them by hand.
 */
export const ASSET_STATUSES_SET_BY_REPAIRS: readonly AssetStatus[] = ['IN_REPAIR'];

/** Moving into these statuses needs a recorded reason. */
export const ASSET_STATUSES_REQUIRING_REASON: readonly AssetStatus[] = ['RETIRED', 'DISPOSED'];

export function canTransitionAsset(from: AssetStatus, to: AssetStatus): boolean {
  return ASSET_TRANSITIONS[from].includes(to);
}

/**
 * Serial numbers are compared in a normalised form: upper case, whitespace removed.
 * "abc 123" and "ABC123" are the same device. The database checks this form too.
 */
export function normaliseSerial(value: string): string {
  return value.trim().toUpperCase().replace(/\s+/g, '');
}

const serialField = z
  .string()
  .max(80, 'Must be at most 80 characters')
  .nullish()
  .transform((v) => (v == null ? v : normaliseSerial(v) || null))
  .refine(
    (v) => v == null || /^[\x21-\x7E]+$/.test(v),
    'Use letters, digits and standard symbols only',
  );

const detailFields = {
  category: z.enum(ASSET_CATEGORIES),
  manufacturer: z.string().trim().min(1, 'Enter the manufacturer').max(80),
  model: z.string().trim().min(1, 'Enter the model').max(120),
  serialNumber: serialField,
  condition: z.enum(ASSET_CONDITIONS),
  purchaseDate: optionalDate,
  warrantyExpiresOn: optionalDate,
  warrantyNotes: optionalText(500),
  notes: optionalText(2000),
};

interface DateFields {
  purchaseDate?: string | null;
  warrantyExpiresOn?: string | null;
}

/** Date rules shared by create and (after merging with the stored row) update. */
export function dateIssues(value: DateFields): Array<{ path: string; message: string }> {
  const issues: Array<{ path: string; message: string }> = [];
  if (value.purchaseDate && value.purchaseDate > latestAllowedDate()) {
    issues.push({ path: 'purchaseDate', message: 'The purchase date cannot be in the future' });
  }
  if (
    value.purchaseDate &&
    value.warrantyExpiresOn &&
    value.warrantyExpiresOn < value.purchaseDate
  ) {
    issues.push({
      path: 'warrantyExpiresOn',
      message: 'The warranty cannot end before the purchase date',
    });
  }
  return issues;
}

/** A new asset starts in stock, or already in use by a customer. */
export const ASSET_INITIAL_STATUSES = ['IN_STOCK', 'ACTIVE'] as const;

export const createAssetSchema = z
  .object({
    ...detailFields,
    condition: detailFields.condition.default('GOOD'),
    customerAccountId: z.uuid().nullish(),
    status: z.enum(ASSET_INITIAL_STATUSES).default('IN_STOCK'),
  })
  .superRefine((value, ctx) => {
    for (const issue of dateIssues(value)) {
      ctx.addIssue({ code: 'custom', path: [issue.path], message: issue.message });
    }
    if (value.status === 'ACTIVE' && !value.customerAccountId) {
      ctx.addIssue({
        code: 'custom',
        path: ['customerAccountId'],
        message: 'Choose the customer who uses this device, or register it as in stock',
      });
    }
  });
export type CreateAssetInput = z.infer<typeof createAssetSchema>;

/**
 * Edits details and the customer assignment. Status changes go through the
 * separate status endpoint so every lifecycle move is checked and recorded.
 */
export const updateAssetSchema = z
  .object(detailFields)
  .partial()
  .extend({
    customerAccountId: z.uuid().nullable().optional(),
    version: versionField,
  })
  .refine(hasChanges, { message: 'Provide at least one field to change' });
export type UpdateAssetInput = z.infer<typeof updateAssetSchema>;

export const changeAssetStatusSchema = z
  .object({
    status: z.enum(ASSET_STATUSES),
    reason: optionalText(500),
    version: versionField,
  })
  .superRefine((value, ctx) => {
    if (ASSET_STATUSES_REQUIRING_REASON.includes(value.status) && !value.reason) {
      ctx.addIssue({
        code: 'custom',
        path: ['reason'],
        message: 'Give a reason for this change',
      });
    }
  });
export type ChangeAssetStatusInput = z.infer<typeof changeAssetStatusSchema>;

export const ASSET_SORT_FIELDS = [
  'assetTag',
  'createdAt',
  'manufacturer',
  'model',
  'status',
  'warrantyExpiresOn',
] as const;

export const WARRANTY_FILTERS = ['active', 'expired', 'none'] as const;

const assetFilterFields = {
  search: z.string().trim().max(100).optional(),
  status: z.enum(ASSET_STATUSES).optional(),
  category: z.enum(ASSET_CATEGORIES).optional(),
  /** A customer account id, or "none" for assets held by the service company. */
  customer: z.union([z.uuid(), z.literal('none')]).optional(),
  warranty: z.enum(WARRANTY_FILTERS).optional(),
  sort: sortSchema(ASSET_SORT_FIELDS, 'createdAt:desc'),
};

export const listAssetsQuerySchema = paginationSchema.extend(assetFilterFields);
export type ListAssetsQuery = z.infer<typeof listAssetsQuerySchema>;

export const exportAssetsQuerySchema = z.object(assetFilterFields);
export type ExportAssetsQuery = z.infer<typeof exportAssetsQuerySchema>;

/** The most rows one CSV export may contain; larger exports must be filtered. */
export const ASSET_EXPORT_LIMIT = 10_000;

/** A staff member or user, as shown next to a record. */
export const userRefSchema = z.object({ id: z.uuid(), fullName: z.string() });
export type UserRef = z.infer<typeof userRefSchema>;

export const assetSchema = z.object({
  id: z.uuid(),
  assetTag: z.string(),
  category: z.enum(ASSET_CATEGORIES),
  manufacturer: z.string(),
  model: z.string(),
  serialNumber: z.string().nullable(),
  condition: z.enum(ASSET_CONDITIONS),
  status: z.enum(ASSET_STATUSES),
  customer: customerSummarySchema.nullable(),
  purchaseDate: z.string().nullable(),
  warrantyExpiresOn: z.string().nullable(),
  warrantyNotes: z.string().nullable(),
  notes: z.string().nullable(),
  createdBy: userRefSchema,
  createdAt: z.string(),
  updatedAt: z.string(),
  version: z.number().int(),
});
export type Asset = z.infer<typeof assetSchema>;

export const ASSET_EVENT_TYPES = [
  'REGISTERED',
  'DETAILS_UPDATED',
  'STATUS_CHANGED',
  'CUSTOMER_CHANGED',
] as const;
export type AssetEventType = (typeof ASSET_EVENT_TYPES)[number];

export const assetEventSchema = z.object({
  id: z.uuid(),
  type: z.enum(ASSET_EVENT_TYPES),
  fromStatus: z.enum(ASSET_STATUSES).nullable(),
  toStatus: z.enum(ASSET_STATUSES).nullable(),
  fromCustomer: customerSummarySchema.nullable(),
  toCustomer: customerSummarySchema.nullable(),
  note: z.string().nullable(),
  actor: userRefSchema,
  createdAt: z.string(),
});
export type AssetEvent = z.infer<typeof assetEventSchema>;
