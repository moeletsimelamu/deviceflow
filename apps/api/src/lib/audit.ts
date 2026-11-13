import type { Db } from './prisma.js';
import type { RequestContext } from './context.js';

const SENSITIVE_KEYS = new Set(['passwordHash', 'password', 'tokenHash', 'token']);

/** Strips secrets and converts Dates so snapshots are plain, safe JSON. */
function sanitize(value: unknown): unknown {
  if (value === null || value === undefined) return value;
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(sanitize);
  if (typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([key]) => !SENSITIVE_KEYS.has(key))
        .map(([key, v]) => [key, sanitize(v)]),
    );
  }
  return value;
}

export interface AuditEntry {
  actorUserId: string | null;
  action: string;
  entityType: string;
  entityId: string;
  before?: unknown;
  after?: unknown;
  /** Correlation: lets an asset's or a customer's full activity be listed. */
  assetId?: string | null;
  customerAccountId?: string | null;
  repairJobId?: string | null;
}

/**
 * Writes an audit entry. Call it with the same transaction client as the change
 * it describes, so the change and its audit record commit (or roll back) together.
 */
export async function recordAudit(db: Db, entry: AuditEntry, ctx: RequestContext): Promise<void> {
  await db.auditLog.create({
    data: {
      actorUserId: entry.actorUserId,
      action: entry.action,
      entityType: entry.entityType,
      entityId: entry.entityId,
      before: (sanitize(entry.before) ?? undefined) as object | undefined,
      after: (sanitize(entry.after) ?? undefined) as object | undefined,
      assetId: entry.assetId ?? null,
      customerAccountId: entry.customerAccountId ?? null,
      repairJobId: entry.repairJobId ?? null,
      requestId: ctx.requestId,
      ipAddress: ctx.ipAddress,
    },
  });
}
