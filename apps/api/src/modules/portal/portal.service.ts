import type {
  Paginated,
  PortalAccount,
  PortalAsset,
  PortalAssetEvent,
  PortalListAssetsQuery,
} from '@deviceflow/shared';
import { normaliseSerial } from '@deviceflow/shared';
import type { Actor } from '../../lib/context.js';
import { forbidden, notFound } from '../../lib/errors.js';
import { pageArgs, paginated } from '../../lib/pagination.js';
import { prisma, type Prisma } from '../../lib/prisma.js';
import type { Asset as AssetRow } from '../../generated/prisma/client.js';
import { toDateString } from '../assets/assets.service.js';

/**
 * Customer portal. Every query here is scoped to the signed-in user's own
 * customer account, taken from the session and never from the request. A record
 * that belongs to someone else is reported as "not found" (404, not 403), so
 * the portal never reveals whether another customer's record exists.
 */
function accountOf(actor: Actor): string {
  if (actor.role !== 'CUSTOMER' || !actor.customerAccountId) throw forbidden();
  return actor.customerAccountId;
}

function toPortalAsset(row: AssetRow): PortalAsset {
  return {
    id: row.id,
    assetTag: row.assetTag,
    category: row.category,
    manufacturer: row.manufacturer,
    model: row.model,
    serialNumber: row.serialNumber,
    condition: row.condition,
    status: row.status,
    purchaseDate: toDateString(row.purchaseDate),
    warrantyExpiresOn: toDateString(row.warrantyExpiresOn),
  };
}

export async function getAccount(actor: Actor): Promise<PortalAccount> {
  const account = await prisma.customerAccount.findUniqueOrThrow({
    where: { id: accountOf(actor) },
    select: { accountNumber: true, name: true, type: true },
  });
  return account;
}

export async function listAssets(
  actor: Actor,
  query: PortalListAssetsQuery,
): Promise<Paginated<PortalAsset>> {
  const { search } = query;
  const where: Prisma.AssetWhereInput = {
    customerAccountId: accountOf(actor),
    ...(query.status ? { status: query.status } : {}),
    ...(search
      ? {
          OR: [
            { assetTag: { contains: search, mode: 'insensitive' } },
            { serialNumber: { contains: normaliseSerial(search) } },
            { manufacturer: { contains: search, mode: 'insensitive' } },
            { model: { contains: search, mode: 'insensitive' } },
          ],
        }
      : {}),
  };
  const [rows, total] = await prisma.$transaction([
    prisma.asset.findMany({
      where,
      orderBy: [{ assetTag: 'asc' }],
      ...pageArgs(query.page, query.pageSize),
    }),
    prisma.asset.count({ where }),
  ]);
  return paginated(rows.map(toPortalAsset), total, query.page, query.pageSize);
}

async function findOwnAsset(actor: Actor, id: string): Promise<AssetRow> {
  const row = await prisma.asset.findFirst({
    where: { id, customerAccountId: accountOf(actor) },
  });
  if (!row) throw notFound('Device');
  return row;
}

export async function getAsset(actor: Actor, id: string): Promise<PortalAsset> {
  return toPortalAsset(await findOwnAsset(actor, id));
}

/**
 * Status history since the device was assigned to this customer. Earlier
 * events may describe a previous owner, so they are not shown. Staff notes are
 * never included.
 */
export async function listAssetHistory(actor: Actor, id: string): Promise<PortalAssetEvent[]> {
  const accountId = accountOf(actor);
  await findOwnAsset(actor, id);

  const assignedAt = await prisma.assetEvent.findFirst({
    where: { assetId: id, toCustomerAccountId: accountId },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    select: { createdAt: true },
  });

  const events = await prisma.assetEvent.findMany({
    where: {
      assetId: id,
      type: { in: ['REGISTERED', 'STATUS_CHANGED', 'CUSTOMER_CHANGED'] },
      ...(assignedAt ? { createdAt: { gte: assignedAt.createdAt } } : {}),
    },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: 100,
  });

  return events.map((e) => ({
    id: e.id,
    type: e.type,
    fromStatus: e.fromStatus,
    toStatus: e.toStatus,
    createdAt: e.createdAt.toISOString(),
  }));
}
