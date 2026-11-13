import {
  CLOSED_REPAIR_STATUSES,
  OPEN_REPAIR_STATUSES,
  fromHundredths,
  type Paginated,
  type PortalCancelRepairInput,
  type PortalCreateRepairInput,
  type PortalListRepairsQuery,
  type PortalQuotation,
  type PortalRejectQuoteInput,
  type PortalRepair,
  type PortalRepairTimelineEntry,
} from '@deviceflow/shared';
import type { Actor, RequestContext } from '../../lib/context.js';
import { conflict, forbidden, notFound } from '../../lib/errors.js';
import { pageArgs, paginated } from '../../lib/pagination.js';
import { prisma, type Prisma, type Tx } from '../../lib/prisma.js';
import {
  applyMove,
  createRepair,
  decideQuote,
  jobInclude,
  lockJob,
  quoteInclude,
  type JobRow,
  type JobScope,
  type QuoteRow,
} from '../repairs/repairs.service.js';

/*
 * Repairs in the customer portal. As with devices, the account comes from the
 * session, never the request, and anything outside it is "not found". The
 * shapes are narrower than the staff ones: no internal notes, no status-change
 * reasons, no staff names, no labour records.
 */

function accountOf(actor: Actor): string {
  if (actor.role !== 'CUSTOMER' || !actor.customerAccountId) throw forbidden();
  return actor.customerAccountId;
}

function ownScope(actor: Actor): JobScope {
  return { customerAccountId: accountOf(actor) };
}

export function toPortalRepair(row: JobRow): PortalRepair {
  return {
    id: row.id,
    reference: row.reference,
    status: row.status,
    faultDescription: row.faultDescription,
    completionSummary: row.completionSummary,
    device: {
      id: row.asset.id,
      assetTag: row.asset.assetTag,
      category: row.asset.category,
      manufacturer: row.asset.manufacturer,
      model: row.asset.model,
    },
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    completedAt: row.completedAt?.toISOString() ?? null,
    closedAt: row.closedAt?.toISOString() ?? null,
    version: row.version,
  };
}

function toPortalQuotation(row: QuoteRow): PortalQuotation {
  const byCustomer = row.decisionChannel === 'PORTAL';
  return {
    id: row.id,
    revision: row.revision,
    status: row.status,
    currency: row.currency,
    vatRateBasisPoints: row.vatRateBasisPoints,
    subtotalCents: row.subtotalCents,
    vatCents: row.vatCents,
    totalCents: row.totalCents,
    customerNote: row.customerNote,
    lines: row.lines.map((l) => ({
      position: l.position,
      kind: l.kind,
      description: l.description,
      quantity: fromHundredths(l.quantityHundredths),
      unitPriceCents: l.unitPriceCents,
      lineTotalCents: l.lineTotalCents,
    })),
    issuedAt: row.issuedAt?.toISOString() ?? null,
    decidedAt: row.decidedAt?.toISOString() ?? null,
    decisionChannel: row.decisionChannel,
    onBehalf: row.decisionChannel !== null && !byCustomer,
    // A colleague's name may be shown; a staff member's name or note never is.
    decidedByName: byCustomer && row.decidedBy?.role === 'CUSTOMER' ? row.decidedBy.fullName : null,
    decisionNote: byCustomer ? row.decisionNote : null,
    version: row.version,
  };
}

async function findOwnJob(actor: Actor, id: string): Promise<JobRow> {
  const job = await prisma.repairJob.findFirst({
    where: { id, ...ownScope(actor) },
    include: jobInclude,
  });
  if (!job) throw notFound('Repair');
  return job;
}

export async function listRepairs(
  actor: Actor,
  query: PortalListRepairsQuery,
): Promise<Paginated<PortalRepair>> {
  const where: Prisma.RepairJobWhereInput = {
    ...ownScope(actor),
    ...(query.state === 'open'
      ? { status: { in: OPEN_REPAIR_STATUSES } }
      : query.state === 'closed'
        ? { status: { in: [...CLOSED_REPAIR_STATUSES] } }
        : {}),
    ...(query.asset ? { assetId: query.asset } : {}),
  };
  const [rows, total] = await prisma.$transaction([
    prisma.repairJob.findMany({
      where,
      include: jobInclude,
      orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
      ...pageArgs(query.page, query.pageSize),
    }),
    prisma.repairJob.count({ where }),
  ]);
  return paginated(rows.map(toPortalRepair), total, query.page, query.pageSize);
}

export async function getRepair(actor: Actor, id: string): Promise<PortalRepair> {
  return toPortalRepair(await findOwnJob(actor, id));
}

/** Status changes and messages addressed to the customer, newest first. */
export async function getTimeline(actor: Actor, id: string): Promise<PortalRepairTimelineEntry[]> {
  await findOwnJob(actor, id);
  const [history, notes] = await Promise.all([
    prisma.repairStatusHistory.findMany({
      where: { repairJobId: id },
      select: { id: true, fromStatus: true, toStatus: true, createdAt: true },
    }),
    prisma.repairNote.findMany({
      where: { repairJobId: id, type: 'CUSTOMER_VISIBLE' },
      select: { id: true, body: true, createdAt: true },
    }),
  ]);
  const entries: Array<PortalRepairTimelineEntry & { at: number }> = [
    ...history.map((h) => ({
      kind: 'status' as const,
      id: h.id,
      fromStatus: h.fromStatus,
      toStatus: h.toStatus,
      createdAt: h.createdAt.toISOString(),
      at: h.createdAt.getTime(),
    })),
    ...notes.map((n) => ({
      kind: 'message' as const,
      id: n.id,
      body: n.body,
      createdAt: n.createdAt.toISOString(),
      at: n.createdAt.getTime(),
    })),
  ];
  return entries.sort((a, b) => b.at - a.at).map(({ at: _at, ...entry }) => entry);
}

/** Issued quotations and their outcomes. Drafts are never shown to customers. */
export async function listQuotes(actor: Actor, id: string): Promise<PortalQuotation[]> {
  await findOwnJob(actor, id);
  const rows = await prisma.quotation.findMany({
    where: { repairJobId: id, status: { not: 'DRAFT' } },
    include: quoteInclude,
    orderBy: { revision: 'desc' },
  });
  return rows.map(toPortalQuotation);
}

export async function submitRepair(
  tx: Tx,
  actor: Actor,
  input: PortalCreateRepairInput,
  ctx: RequestContext,
): Promise<PortalRepair> {
  const job = await createRepair(tx, actor, input, ctx, {
    source: 'PORTAL',
    ownAccountId: accountOf(actor),
  });
  return toPortalRepair(job);
}

async function decide(
  tx: Tx,
  actor: Actor,
  id: string,
  quoteId: string,
  approve: boolean,
  version: number,
  reason: string | null,
  ctx: RequestContext,
): Promise<PortalQuotation> {
  await decideQuote(
    tx,
    actor,
    ownScope(actor),
    id,
    quoteId,
    { approve, version, channel: 'PORTAL', note: reason },
    ctx,
  );
  const quote = await tx.quotation.findUniqueOrThrow({
    where: { id: quoteId },
    include: quoteInclude,
  });
  return toPortalQuotation(quote);
}

export function approveQuote(
  tx: Tx,
  actor: Actor,
  id: string,
  quoteId: string,
  version: number,
  ctx: RequestContext,
): Promise<PortalQuotation> {
  return decide(tx, actor, id, quoteId, true, version, null, ctx);
}

export function rejectQuote(
  tx: Tx,
  actor: Actor,
  id: string,
  quoteId: string,
  input: PortalRejectQuoteInput,
  ctx: RequestContext,
): Promise<PortalQuotation> {
  return decide(tx, actor, id, quoteId, false, input.version, input.reason ?? null, ctx);
}

/** Customers can cancel their own request until a technician has been assigned. */
export async function cancelRepair(
  tx: Tx,
  actor: Actor,
  id: string,
  input: PortalCancelRepairInput,
  ctx: RequestContext,
): Promise<PortalRepair> {
  const job = await lockJob(tx, id, ownScope(actor));
  if (job.version !== input.version) throw conflict();
  if (job.status !== 'SUBMITTED') {
    throw forbidden(
      'This repair can no longer be cancelled online because work has started. Please contact us.',
    );
  }
  await applyMove(tx, actor, job, { to: 'CANCELLED', note: input.reason }, ctx);
  const after = await tx.repairJob.findUniqueOrThrow({ where: { id }, include: jobInclude });
  return toPortalRepair(after);
}
