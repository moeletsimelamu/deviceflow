import { z } from 'zod';
import { ASSET_CATEGORIES, ASSET_CONDITIONS, ASSET_EVENT_TYPES, ASSET_STATUSES } from './assets.js';
import { paginationSchema } from './common.js';
import { CUSTOMER_TYPES } from './customers.js';

/**
 * Customer-portal views. These are deliberately separate, narrower shapes than
 * the staff DTOs: staff notes, internal reasons and the identities of staff
 * members never reach a customer.
 */
export const portalAccountSchema = z.object({
  accountNumber: z.string(),
  name: z.string(),
  type: z.enum(CUSTOMER_TYPES),
});
export type PortalAccount = z.infer<typeof portalAccountSchema>;

export const portalListAssetsQuerySchema = paginationSchema.extend({
  search: z.string().trim().max(100).optional(),
  status: z.enum(ASSET_STATUSES).optional(),
});
export type PortalListAssetsQuery = z.infer<typeof portalListAssetsQuerySchema>;

export const portalAssetSchema = z.object({
  id: z.uuid(),
  assetTag: z.string(),
  category: z.enum(ASSET_CATEGORIES),
  manufacturer: z.string(),
  model: z.string(),
  serialNumber: z.string().nullable(),
  condition: z.enum(ASSET_CONDITIONS),
  status: z.enum(ASSET_STATUSES),
  purchaseDate: z.string().nullable(),
  warrantyExpiresOn: z.string().nullable(),
});
export type PortalAsset = z.infer<typeof portalAssetSchema>;

export const portalAssetEventSchema = z.object({
  id: z.uuid(),
  type: z.enum(ASSET_EVENT_TYPES),
  fromStatus: z.enum(ASSET_STATUSES).nullable(),
  toStatus: z.enum(ASSET_STATUSES).nullable(),
  createdAt: z.string(),
});
export type PortalAssetEvent = z.infer<typeof portalAssetEventSchema>;
