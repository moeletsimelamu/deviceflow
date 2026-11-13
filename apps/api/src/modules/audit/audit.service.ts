import type { AuditEntry, ListAuditQuery, Paginated } from '@deviceflow/shared';
import { pageArgs, paginated } from '../../lib/pagination.js';
import { prisma, type Prisma } from '../../lib/prisma.js';

function dayStart(date: string): Date {
  return new Date(`${date}T00:00:00.000Z`);
}

/** The activity feed: newest first, filterable by actor, record and time range. */
export async function listAudit(query: ListAuditQuery): Promise<Paginated<AuditEntry>> {
  const createdAt: Prisma.DateTimeFilter = {};
  if (query.from) createdAt.gte = dayStart(query.from);
  if (query.to) createdAt.lt = new Date(dayStart(query.to).getTime() + 24 * 60 * 60_000);

  const where: Prisma.AuditLogWhereInput = {
    ...(query.action
      ? query.action.endsWith('.')
        ? { action: { startsWith: query.action } }
        : { action: query.action }
      : {}),
    ...(query.entityType ? { entityType: query.entityType } : {}),
    ...(query.entityId ? { entityId: query.entityId } : {}),
    ...(query.actorUserId ? { actorUserId: query.actorUserId } : {}),
    ...(query.assetId ? { assetId: query.assetId } : {}),
    ...(query.customerAccountId ? { customerAccountId: query.customerAccountId } : {}),
    ...(query.repairJobId ? { repairJobId: query.repairJobId } : {}),
    ...(query.from || query.to ? { createdAt } : {}),
  };

  const [rows, total] = await prisma.$transaction([
    prisma.auditLog.findMany({
      where,
      include: { actor: { select: { id: true, fullName: true, email: true } } },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      ...pageArgs(query.page, query.pageSize),
    }),
    prisma.auditLog.count({ where }),
  ]);

  return paginated(
    rows.map((row) => ({
      id: row.id,
      action: row.action,
      entityType: row.entityType,
      entityId: row.entityId,
      actor: row.actor,
      before: row.before,
      after: row.after,
      assetId: row.assetId,
      customerAccountId: row.customerAccountId,
      repairJobId: row.repairJobId,
      requestId: row.requestId,
      ipAddress: row.ipAddress,
      createdAt: row.createdAt.toISOString(),
    })),
    total,
    query.page,
    query.pageSize,
  );
}
