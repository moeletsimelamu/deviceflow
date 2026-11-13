import { z } from 'zod';
import { paginationSchema } from './common.js';

export const listAuditQuerySchema = paginationSchema.extend({
  /** Exact action ("asset.created") or a prefix ending in a dot ("asset."). */
  action: z
    .string()
    .trim()
    .max(64)
    .regex(/^[a-z_.]+$/, 'Use an action such as asset.created or asset.')
    .optional(),
  entityType: z.string().trim().max(64).optional(),
  entityId: z.string().trim().max(64).optional(),
  actorUserId: z.uuid().optional(),
  assetId: z.uuid().optional(),
  customerAccountId: z.uuid().optional(),
  repairJobId: z.uuid().optional(),
  /** Inclusive calendar dates (UTC). */
  from: z.iso.date().optional(),
  to: z.iso.date().optional(),
});
export type ListAuditQuery = z.infer<typeof listAuditQuerySchema>;

export const auditEntrySchema = z.object({
  id: z.uuid(),
  action: z.string(),
  entityType: z.string(),
  entityId: z.string(),
  actor: z.object({ id: z.uuid(), fullName: z.string(), email: z.string() }).nullable(),
  before: z.unknown(),
  after: z.unknown(),
  assetId: z.string().nullable(),
  customerAccountId: z.string().nullable(),
  repairJobId: z.string().nullable(),
  requestId: z.string().nullable(),
  ipAddress: z.string().nullable(),
  createdAt: z.string(),
});
export type AuditEntry = z.infer<typeof auditEntrySchema>;

/** Human-readable descriptions for the activity feed. Unknown actions fall back to the raw code. */
export const AUDIT_ACTION_LABELS: Record<string, string> = {
  'auth.login': 'Signed in',
  'auth.logout': 'Signed out',
  'user.created': 'Created user',
  'user.updated': 'Updated user',
  'user.deactivated': 'Deactivated user',
  'user.reactivated': 'Reactivated user',
  'settings.updated': 'Updated company settings',
  'customer.created': 'Created customer',
  'customer.updated': 'Updated customer',
  'customer.archived': 'Archived customer',
  'customer.restored': 'Restored customer',
  'contact.created': 'Added contact',
  'contact.updated': 'Updated contact',
  'contact.deleted': 'Removed contact',
  'customer_user.created': 'Created portal user',
  'asset.created': 'Registered asset',
  'asset.updated': 'Updated asset',
  'asset.reassigned': 'Reassigned asset',
  'asset.status_changed': 'Changed asset status',
  'asset.exported': 'Exported assets',
  'repair.created': 'Opened repair job',
  'repair.assigned': 'Assigned technician',
  'repair.status_changed': 'Changed repair status',
  'repair.cancelled': 'Cancelled repair job',
  'repair_note.created': 'Added repair note',
  'labour.created': 'Recorded labour',
  'labour.deleted': 'Removed labour entry',
  'quote.created': 'Drafted quotation',
  'quote.updated': 'Edited draft quotation',
  'quote.deleted': 'Discarded draft quotation',
  'quote.issued': 'Issued quotation',
  'quote.approved': 'Approved quotation',
  'quote.rejected': 'Rejected quotation',
  'part.created': 'Added part',
  'part.updated': 'Updated part',
  'part.archived': 'Archived part',
  'part.restored': 'Restored part',
  'stock.purchased': 'Received stock',
  'stock.adjusted': 'Adjusted stock',
  'repair_part.used': 'Used part in repair',
  'repair_part.returned': 'Returned part to stock',
};

export function auditActionLabel(action: string): string {
  return AUDIT_ACTION_LABELS[action] ?? action;
}
