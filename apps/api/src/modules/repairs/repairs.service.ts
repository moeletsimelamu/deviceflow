import {
  canActAs,
  CLOSED_REPAIR_STATUSES,
  DECISION_CHANNEL_LABELS,
  findRepairRule,
  fromHundredths,
  isRepairOpen,
  LABOUR_STATUSES,
  lineTotalCents,
  MAX_QUOTE_SUBTOTAL_CENTS,
  normaliseSerial,
  OPEN_REPAIR_STATUSES,
  QUOTE_STATUSES,
  quoteTotals,
  REPAIR_STATUS_LABELS,
  repairActorsFor,
  TECHNICIAN_CHANGE_STATUSES,
  toHundredths,
  type AddLabourInput,
  type AddRepairNoteInput,
  type AssignRepairInput,
  type CreateQuoteInput,
  type CreateRepairInput,
  type DecisionChannel,
  type LabourEntry,
  type ListRepairsQuery,
  type Paginated,
  type Quotation,
  type QuoteLineInput,
  type Repair,
  type RepairActor,
  type RepairContact,
  type RepairHistoryEntry,
  type RepairNote,
  type RepairStatus,
  type RepairTransitionInput,
  type RepairTransitionRule,
  type TechnicianOption,
  type UpdateQuoteInput,
} from '@deviceflow/shared';
import { recordAudit } from '../../lib/audit.js';
import type { Actor, RequestContext } from '../../lib/context.js';
import { AppError, conflict, forbidden, notFound } from '../../lib/errors.js';
import { pageArgs, paginated } from '../../lib/pagination.js';
import { Prisma, prisma, type Db, type Tx } from '../../lib/prisma.js';
import { toCustomerSummary } from '../customers/customers.service.js';
import { toDateString } from '../assets/assets.service.js';

/*
 * Repair jobs (Phase 1, §3.1 and §3.2).
 *
 * Every mutation runs in a transaction that first locks the job row
 * (SELECT … FOR UPDATE). All changes to one job are therefore applied one at a
 * time, and every rule below is checked against the job's current state, not a
 * stale copy. The client's `version` is then compared, so a user acting on an
 * out-of-date screen gets 409 instead of overwriting someone else's change.
 *
 * Status changes go only through `applyMove`, which checks the shared state
 * machine, writes a status-history row and moves the device in and out of
 * IN_REPAIR. Every change writes an audit row in the same transaction.
 */

// --- Loading and mapping ----------------------------------------------------------

const userRef = { select: { id: true, fullName: true } } as const;

export const jobInclude = {
  asset: true,
  customerAccount: { include: { contacts: { where: { isPrimary: true }, take: 1 } } },
  assignedTechnician: userRef,
  submittedBy: userRef,
  labourEntries: { select: { minutes: true } },
  quotations: {
    where: { status: { not: 'DRAFT' } },
    orderBy: { revision: 'desc' },
    take: 1,
    select: { id: true, revision: true, status: true, totalCents: true, currency: true },
  },
} satisfies Prisma.RepairJobInclude;

export type JobRow = Prisma.RepairJobGetPayload<{ include: typeof jobInclude }>;

/** Who to contact about the job: the primary contact, falling back to the account's details. */
function contactOf(account: JobRow['customerAccount']): RepairContact | null {
  const primary = account.contacts[0];
  if (primary) {
    return {
      name: primary.fullName,
      jobTitle: primary.jobTitle,
      email: primary.email ?? account.email,
      phone: primary.phone ?? account.phone,
    };
  }
  if (account.email || account.phone) {
    return { name: account.name, jobTitle: null, email: account.email, phone: account.phone };
  }
  return null;
}

export function toRepairDto(row: JobRow): Repair {
  const quote = row.quotations[0];
  return {
    id: row.id,
    reference: row.reference,
    status: row.status,
    source: row.source,
    faultDescription: row.faultDescription,
    asset: {
      id: row.asset.id,
      assetTag: row.asset.assetTag,
      category: row.asset.category,
      manufacturer: row.asset.manufacturer,
      model: row.asset.model,
      serialNumber: row.asset.serialNumber,
    },
    customer: toCustomerSummary(row.customerAccount),
    contact: contactOf(row.customerAccount),
    technician: row.assignedTechnician,
    submittedBy: row.submittedBy,
    completionSummary: row.completionSummary,
    completedAt: row.completedAt?.toISOString() ?? null,
    closedAt: row.closedAt?.toISOString() ?? null,
    labourMinutes: row.labourEntries.reduce((sum, e) => sum + e.minutes, 0),
    currentQuote: quote ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    version: row.version,
  };
}

export const quoteInclude = {
  lines: { orderBy: { position: 'asc' } },
  createdBy: userRef,
  issuedBy: userRef,
  decidedBy: { select: { id: true, fullName: true, role: true } },
} satisfies Prisma.QuotationInclude;

export type QuoteRow = Prisma.QuotationGetPayload<{ include: typeof quoteInclude }>;

export function isOnBehalf(channel: DecisionChannel | null): boolean {
  return channel !== null && channel !== 'PORTAL';
}

export function toQuotationDto(row: QuoteRow): Quotation {
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
      id: l.id,
      position: l.position,
      kind: l.kind,
      description: l.description,
      quantity: fromHundredths(l.quantityHundredths),
      unitPriceCents: l.unitPriceCents,
      lineTotalCents: l.lineTotalCents,
    })),
    createdBy: row.createdBy,
    issuedBy: row.issuedBy,
    issuedAt: row.issuedAt?.toISOString() ?? null,
    decidedBy: row.decidedBy ? { id: row.decidedBy.id, fullName: row.decidedBy.fullName } : null,
    decidedAt: row.decidedAt?.toISOString() ?? null,
    decisionChannel: row.decisionChannel,
    decisionNote: row.decisionNote,
    onBehalf: isOnBehalf(row.decisionChannel),
    approvedTotalCents: row.approvedTotalCents,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    version: row.version,
  };
}

// --- Scope and locking ----------------------------------------------------------------

export type JobScope = Prisma.RepairJobWhereInput;

/**
 * Row-level scope for staff. Administrators see every job; a technician sees
 * only jobs assigned to them; an inventory manager sees only jobs that have used
 * parts (Phase 1, §2.2). Anything outside the scope is "not found".
 */
export function staffScope(actor: Actor): JobScope {
  if (actor.role === 'ADMIN') return {};
  if (actor.role === 'TECHNICIAN') return { assignedTechnicianId: actor.userId };
  if (actor.role === 'INVENTORY_MANAGER') return { stockMovements: { some: {} } };
  throw forbidden();
}

/** Inventory managers see a job's customer by account name only, not their contact details. */
function forViewer(actor: Actor, repair: Repair): Repair {
  return actor.role === 'INVENTORY_MANAGER' ? { ...repair, contact: null } : repair;
}

/** Locks the job row for the rest of the transaction, then loads it within the scope. */
export async function lockJob(tx: Tx, id: string, scope: JobScope): Promise<JobRow> {
  await tx.$queryRaw`SELECT 1 FROM "repair_jobs" WHERE "id" = ${id}::uuid FOR UPDATE`;
  const job = await tx.repairJob.findFirst({ where: { id, ...scope }, include: jobInclude });
  if (!job) throw notFound('Repair job');
  return job;
}

async function findJob(db: Db, id: string, scope: JobScope): Promise<JobRow> {
  const job = await db.repairJob.findFirst({ where: { id, ...scope }, include: jobInclude });
  if (!job) throw notFound('Repair job');
  return job;
}

function actorsOn(actor: Actor, job: JobRow): RepairActor[] {
  return repairActorsFor(
    { id: actor.userId, role: actor.role, customerAccountId: actor.customerAccountId },
    job,
  );
}

function checkVersion(current: number, expected: number): void {
  if (current !== expected) throw conflict();
}

const ACTOR_WORDS: Record<RepairActor, string> = {
  ADMIN: 'an administrator',
  ASSIGNED_TECHNICIAN: 'the assigned technician',
  CUSTOMER: 'the customer',
};

function describeActors(actors: readonly RepairActor[]): string {
  return actors.map((a) => ACTOR_WORDS[a]).join(' or ');
}

function label(status: RepairStatus): string {
  return REPAIR_STATUS_LABELS[status];
}

function wrongStatus(message: string): AppError {
  return new AppError(422, 'WRONG_REPAIR_STATUS', message);
}

// --- Status moves ---------------------------------------------------------------------

const RELEASE_WORDS: Partial<Record<RepairStatus, string>> = {
  CLOSED: 'closed: device handed back',
  RETURNED_UNREPAIRED: 'returned unrepaired',
  CANCELLED: 'cancelled',
};

/** A device returns to ACTIVE when its job is closed, returned unrepaired or cancelled. */
async function releaseAsset(tx: Tx, job: JobRow, to: RepairStatus, actor: Actor): Promise<void> {
  const { count } = await tx.asset.updateMany({
    where: { id: job.assetId, status: 'IN_REPAIR' },
    data: { status: 'ACTIVE', version: { increment: 1 } },
  });
  if (count === 0) return;
  await tx.assetEvent.create({
    data: {
      assetId: job.assetId,
      type: 'STATUS_CHANGED',
      fromStatus: 'IN_REPAIR',
      toStatus: 'ACTIVE',
      note: `Repair ${job.reference} ${RELEASE_WORDS[to] ?? 'finished'}`,
      actorUserId: actor.userId,
      repairJobId: job.id,
    },
  });
}

/**
 * The single place a job's status changes. The caller has locked the job and
 * checked the rule; this applies the move, records history and frees the device
 * when the job finishes.
 */
async function moveJob(
  tx: Tx,
  job: JobRow,
  to: RepairStatus,
  actor: Actor,
  options: { note?: string | null; data?: Prisma.RepairJobUncheckedUpdateManyInput } = {},
): Promise<void> {
  const finished = !isRepairOpen(to);
  const { count } = await tx.repairJob.updateMany({
    where: { id: job.id, status: job.status, version: job.version },
    data: {
      ...options.data,
      status: to,
      version: { increment: 1 },
      ...(finished ? { closedAt: new Date() } : {}),
    },
  });
  if (count === 0) throw conflict();
  await tx.repairStatusHistory.create({
    data: {
      repairJobId: job.id,
      fromStatus: job.status,
      toStatus: to,
      note: options.note ?? null,
      actorUserId: actor.userId,
    },
  });
  if (finished) await releaseAsset(tx, job, to, actor);
}

const ACTION_HINTS: Record<RepairTransitionRule['via'], string> = {
  transition: '',
  cancel: '',
  assign: 'Assign a technician to move the job on.',
  issue_quote: 'Issue a quotation to ask the customer for approval.',
  approve_quote: 'Only the customer’s approval of the quotation does this.',
  reject_quote: 'Only the customer’s rejection of the quotation does this.',
};

export interface MoveInput {
  to: RepairStatus;
  note?: string | null;
  completionSummary?: string | null;
}

/**
 * Checks and applies a generic move (or a cancellation) for the current actor.
 * Order of checks: is the move in the state machine at all, is it a move this
 * endpoint can make, may this actor make it, and are its requirements met.
 */
export async function applyMove(
  tx: Tx,
  actor: Actor,
  job: JobRow,
  input: MoveInput,
  ctx: RequestContext,
): Promise<void> {
  const rule = findRepairRule(job.status, input.to);
  if (!rule) {
    throw new AppError(
      422,
      'INVALID_TRANSITION',
      `A repair cannot move from ${label(job.status)} to ${label(input.to)}`,
    );
  }
  if (rule.via !== 'transition' && rule.via !== 'cancel') {
    throw new AppError(
      422,
      'INVALID_TRANSITION',
      `A repair cannot be moved to ${label(input.to)} directly. ${ACTION_HINTS[rule.via]}`,
    );
  }
  if (!canActAs(rule, actorsOn(actor, job))) {
    throw forbidden(
      `Only ${describeActors(rule.actors)} can move a job from ${label(job.status)} to ${label(input.to)}`,
    );
  }
  if (rule.requires.includes('note') && !input.note) {
    throw new AppError(422, 'VALIDATION_FAILED', 'Give a reason for this change', [
      { path: 'note', message: 'Give a reason for this change' },
    ]);
  }
  if (rule.requires.includes('completionSummary') && !input.completionSummary) {
    throw new AppError(422, 'VALIDATION_FAILED', 'Summarise the work done', [
      { path: 'completionSummary', message: 'Summarise the work done for the customer' },
    ]);
  }
  if (rule.requires.includes('labour') && job.labourEntries.length === 0) {
    throw new AppError(
      422,
      'LABOUR_REQUIRED',
      'Record the time spent before sending the job to quality check',
    );
  }

  if (input.to === 'CANCELLED') {
    // The quotation the customer was looking at can no longer be approved.
    await tx.quotation.updateMany({
      where: { repairJobId: job.id, status: 'ISSUED' },
      data: { status: 'WITHDRAWN', version: { increment: 1 } },
    });
  }

  await moveJob(tx, job, input.to, actor, {
    note: input.note ?? null,
    data:
      input.to === 'COMPLETED'
        ? { completionSummary: input.completionSummary ?? null, completedAt: new Date() }
        : undefined,
  });

  await recordAudit(
    tx,
    {
      actorUserId: actor.userId,
      action: input.to === 'CANCELLED' ? 'repair.cancelled' : 'repair.status_changed',
      entityType: 'RepairJob',
      entityId: job.id,
      repairJobId: job.id,
      assetId: job.assetId,
      customerAccountId: job.customerAccountId,
      before: { status: job.status },
      after: {
        status: input.to,
        note: input.note ?? null,
        ...(input.to === 'COMPLETED' ? { completionSummary: input.completionSummary } : {}),
      },
    },
    ctx,
  );
}

export async function transitionRepair(
  tx: Tx,
  actor: Actor,
  id: string,
  input: RepairTransitionInput,
  ctx: RequestContext,
): Promise<Repair> {
  const job = await lockJob(tx, id, staffScope(actor));
  checkVersion(job.version, input.version);
  await applyMove(tx, actor, job, input, ctx);
  return toRepairDto(await findJob(tx, id, {}));
}

// --- Listing --------------------------------------------------------------------------

function stateWhere(state: 'open' | 'closed' | undefined): JobScope {
  if (state === 'open') return { status: { in: OPEN_REPAIR_STATUSES } };
  if (state === 'closed') return { status: { in: [...CLOSED_REPAIR_STATUSES] } };
  return {};
}

export async function listRepairs(
  actor: Actor,
  query: ListRepairsQuery,
): Promise<Paginated<Repair>> {
  const scope = staffScope(actor);
  const { search } = query;
  const where: Prisma.RepairJobWhereInput = {
    AND: [
      scope,
      stateWhere(query.state),
      query.status ? { status: query.status } : {},
      // Technicians always see only their own jobs; the filter is for administrators.
      actor.role === 'ADMIN' && query.technician
        ? { assignedTechnicianId: query.technician === 'unassigned' ? null : query.technician }
        : {},
      query.customer ? { customerAccountId: query.customer } : {},
      query.asset ? { assetId: query.asset } : {},
      search
        ? {
            OR: [
              { reference: { contains: search, mode: 'insensitive' } },
              { faultDescription: { contains: search, mode: 'insensitive' } },
              { asset: { assetTag: { contains: search, mode: 'insensitive' } } },
              { asset: { serialNumber: { contains: normaliseSerial(search) } } },
              { asset: { manufacturer: { contains: search, mode: 'insensitive' } } },
              { asset: { model: { contains: search, mode: 'insensitive' } } },
              { customerAccount: { name: { contains: search, mode: 'insensitive' } } },
            ],
          }
        : {},
    ],
  };
  const [rows, total] = await prisma.$transaction([
    prisma.repairJob.findMany({
      where,
      include: jobInclude,
      orderBy: [
        { [query.sort.field]: query.sort.direction } as Prisma.RepairJobOrderByWithRelationInput,
        { id: 'asc' },
      ],
      ...pageArgs(query.page, query.pageSize),
    }),
    prisma.repairJob.count({ where }),
  ]);
  return paginated(
    rows.map((row) => forViewer(actor, toRepairDto(row))),
    total,
    query.page,
    query.pageSize,
  );
}

export async function getRepair(actor: Actor, id: string): Promise<Repair> {
  return forViewer(actor, toRepairDto(await findJob(prisma, id, staffScope(actor))));
}

export async function listHistory(actor: Actor, id: string): Promise<RepairHistoryEntry[]> {
  await findJob(prisma, id, staffScope(actor));
  const rows = await prisma.repairStatusHistory.findMany({
    where: { repairJobId: id },
    include: { actor: userRef },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
  });
  return rows.map((r) => ({
    id: r.id,
    fromStatus: r.fromStatus,
    toStatus: r.toStatus,
    note: r.note,
    actor: r.actor,
    createdAt: r.createdAt.toISOString(),
  }));
}

/** Active technicians with their current workload, for the assignment picker. */
export async function listTechnicians(): Promise<TechnicianOption[]> {
  const technicians = await prisma.user.findMany({
    where: { role: 'TECHNICIAN', isActive: true },
    select: { id: true, fullName: true },
    orderBy: { fullName: 'asc' },
  });
  const counts = await prisma.repairJob.groupBy({
    by: ['assignedTechnicianId'],
    where: {
      assignedTechnicianId: { in: technicians.map((t) => t.id) },
      status: { in: OPEN_REPAIR_STATUSES.filter((s) => s !== 'COMPLETED') },
    },
    _count: { _all: true },
  });
  const byId = new Map(counts.map((c) => [c.assignedTechnicianId, c._count._all]));
  return technicians.map((t) => ({ ...t, openJobs: byId.get(t.id) ?? 0 }));
}

// --- Creating and assigning -------------------------------------------------------------

async function assertTechnician(db: Db, technicianId: string): Promise<{ fullName: string }> {
  const user = await db.user.findUnique({ where: { id: technicianId } });
  if (!user || user.role !== 'TECHNICIAN' || !user.isActive) {
    throw new AppError(422, 'TECHNICIAN_INVALID', 'Choose an active technician', [
      { path: 'technicianId', message: 'Choose an active technician' },
    ]);
  }
  return user;
}

function isUniqueViolation(err: unknown): boolean {
  return err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002';
}

/**
 * Opens a repair job for a customer's device and moves the device to IN_REPAIR.
 * Only ACTIVE devices that belong to a customer can be booked in, and a device
 * can have only one open job (also enforced by a partial unique index, which
 * stops two simultaneous requests from both succeeding).
 *
 * `ownAccountId` is set for portal requests: the device must belong to that
 * account, or it is reported as not found.
 */
export async function createRepair(
  tx: Tx,
  actor: Actor,
  input: CreateRepairInput,
  ctx: RequestContext,
  options: { source: 'STAFF' | 'PORTAL'; ownAccountId?: string },
): Promise<JobRow> {
  await tx.$queryRaw`SELECT 1 FROM "assets" WHERE "id" = ${input.assetId}::uuid FOR UPDATE`;
  const asset = await tx.asset.findUnique({
    where: { id: input.assetId },
    include: { customerAccount: true },
  });
  if (!asset || (options.ownAccountId && asset.customerAccountId !== options.ownAccountId)) {
    throw notFound('Device');
  }

  const open = await tx.repairJob.findFirst({
    where: { assetId: asset.id, status: { in: OPEN_REPAIR_STATUSES } },
    select: { reference: true },
  });
  if (open) {
    throw new AppError(
      409,
      'REPAIR_ALREADY_OPEN',
      `This device already has an open repair job (${open.reference})`,
    );
  }
  if (asset.status !== 'ACTIVE' || !asset.customerAccount) {
    throw new AppError(
      422,
      'ASSET_NOT_REPAIRABLE',
      'Only active devices that belong to a customer can be booked in for repair',
      [{ path: 'assetId', message: 'Choose an active customer device' }],
    );
  }
  if (!asset.customerAccount.isActive) {
    throw new AppError(422, 'CUSTOMER_ARCHIVED', `${asset.customerAccount.name} is archived`);
  }
  if (input.technicianId) await assertTechnician(tx, input.technicianId);

  let job: { id: string; reference: string };
  try {
    job = await tx.repairJob.create({
      data: {
        assetId: asset.id,
        customerAccountId: asset.customerAccount.id,
        source: options.source,
        faultDescription: input.faultDescription,
        submittedById: actor.userId,
      },
      select: { id: true, reference: true },
    });
  } catch (err) {
    if (isUniqueViolation(err)) {
      throw new AppError(409, 'REPAIR_ALREADY_OPEN', 'This device already has an open repair job');
    }
    throw err;
  }

  await tx.repairStatusHistory.create({
    data: { repairJobId: job.id, toStatus: 'SUBMITTED', actorUserId: actor.userId },
  });
  await tx.asset.update({
    where: { id: asset.id },
    data: { status: 'IN_REPAIR', version: { increment: 1 } },
  });
  await tx.assetEvent.create({
    data: {
      assetId: asset.id,
      type: 'STATUS_CHANGED',
      fromStatus: 'ACTIVE',
      toStatus: 'IN_REPAIR',
      note: `Booked in for repair ${job.reference}`,
      actorUserId: actor.userId,
      repairJobId: job.id,
    },
  });

  if (input.technicianId) {
    const submitted = await findJob(tx, job.id, {});
    await moveJob(tx, submitted, 'ASSIGNED', actor, {
      data: { assignedTechnicianId: input.technicianId },
    });
  }

  const created = await findJob(tx, job.id, {});
  await recordAudit(
    tx,
    {
      actorUserId: actor.userId,
      action: 'repair.created',
      entityType: 'RepairJob',
      entityId: job.id,
      repairJobId: job.id,
      assetId: asset.id,
      customerAccountId: asset.customerAccount.id,
      after: toRepairDto(created),
    },
    ctx,
  );
  return created;
}

/** Assigns (from SUBMITTED, moving the job to ASSIGNED) or reassigns a technician. */
export async function assignRepair(
  tx: Tx,
  actor: Actor,
  id: string,
  input: AssignRepairInput,
  ctx: RequestContext,
): Promise<Repair> {
  const job = await lockJob(tx, id, staffScope(actor));
  checkVersion(job.version, input.version);
  if (!TECHNICIAN_CHANGE_STATUSES.includes(job.status)) {
    throw new AppError(
      422,
      'INVALID_TRANSITION',
      `The technician cannot be changed on a job that is ${label(job.status).toLowerCase()}`,
    );
  }
  if (job.assignedTechnicianId === input.technicianId) {
    throw new AppError(422, 'VALIDATION_FAILED', 'This technician is already assigned', [
      { path: 'technicianId', message: 'Already assigned' },
    ]);
  }
  const technician = await assertTechnician(tx, input.technicianId);

  if (job.status === 'SUBMITTED') {
    await moveJob(tx, job, 'ASSIGNED', actor, {
      data: { assignedTechnicianId: input.technicianId },
    });
  } else {
    const { count } = await tx.repairJob.updateMany({
      where: { id, version: job.version },
      data: { assignedTechnicianId: input.technicianId, version: { increment: 1 } },
    });
    if (count === 0) throw conflict();
  }

  await recordAudit(
    tx,
    {
      actorUserId: actor.userId,
      action: 'repair.assigned',
      entityType: 'RepairJob',
      entityId: id,
      repairJobId: id,
      assetId: job.assetId,
      customerAccountId: job.customerAccountId,
      before: { technician: job.assignedTechnician, status: job.status },
      after: {
        technician: { id: input.technicianId, fullName: technician.fullName },
        status: job.status === 'SUBMITTED' ? 'ASSIGNED' : job.status,
      },
    },
    ctx,
  );
  return toRepairDto(await findJob(tx, id, {}));
}

// --- Notes and labour -----------------------------------------------------------------

export async function listNotes(actor: Actor, id: string): Promise<RepairNote[]> {
  await findJob(prisma, id, staffScope(actor));
  const rows = await prisma.repairNote.findMany({
    where: { repairJobId: id },
    include: { author: userRef },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
  });
  return rows.map((n) => ({
    id: n.id,
    type: n.type,
    body: n.body,
    author: n.author,
    createdAt: n.createdAt.toISOString(),
  }));
}

export async function addNote(
  tx: Tx,
  actor: Actor,
  id: string,
  input: AddRepairNoteInput,
  ctx: RequestContext,
): Promise<RepairNote> {
  const job = await findJob(tx, id, staffScope(actor));
  const note = await tx.repairNote.create({
    data: { repairJobId: id, type: input.type, body: input.body, authorId: actor.userId },
    include: { author: userRef },
  });
  await recordAudit(
    tx,
    {
      actorUserId: actor.userId,
      action: 'repair_note.created',
      entityType: 'RepairNote',
      entityId: note.id,
      repairJobId: id,
      assetId: job.assetId,
      customerAccountId: job.customerAccountId,
      after: { type: note.type, length: note.body.length },
    },
    ctx,
  );
  return {
    id: note.id,
    type: note.type,
    body: note.body,
    author: note.author,
    createdAt: note.createdAt.toISOString(),
  };
}

function toLabourDto(row: {
  id: string;
  minutes: number;
  description: string;
  workDate: Date;
  createdAt: Date;
  user: { id: string; fullName: string };
}): LabourEntry {
  return {
    id: row.id,
    minutes: row.minutes,
    description: row.description,
    workDate: toDateString(row.workDate)!,
    user: row.user,
    createdAt: row.createdAt.toISOString(),
  };
}

export async function listLabour(actor: Actor, id: string): Promise<LabourEntry[]> {
  await findJob(prisma, id, staffScope(actor));
  const rows = await prisma.labourEntry.findMany({
    where: { repairJobId: id },
    include: { user: userRef },
    orderBy: [{ workDate: 'desc' }, { createdAt: 'desc' }],
  });
  return rows.map(toLabourDto);
}

function assertLabourStatus(job: JobRow): void {
  if (!LABOUR_STATUSES.includes(job.status)) {
    throw wrongStatus(
      `Labour cannot be changed while the job is ${label(job.status).toLowerCase()}`,
    );
  }
}

export async function addLabour(
  tx: Tx,
  actor: Actor,
  id: string,
  input: AddLabourInput,
  ctx: RequestContext,
): Promise<LabourEntry> {
  const job = await lockJob(tx, id, staffScope(actor));
  assertLabourStatus(job);
  const entry = await tx.labourEntry.create({
    data: {
      repairJobId: id,
      userId: actor.userId,
      minutes: input.minutes,
      description: input.description,
      workDate: new Date(`${input.workDate}T00:00:00.000Z`),
    },
    include: { user: userRef },
  });
  const dto = toLabourDto(entry);
  await recordAudit(
    tx,
    {
      actorUserId: actor.userId,
      action: 'labour.created',
      entityType: 'LabourEntry',
      entityId: entry.id,
      repairJobId: id,
      assetId: job.assetId,
      customerAccountId: job.customerAccountId,
      after: dto,
    },
    ctx,
  );
  return dto;
}

/** Removes a mistaken entry. Technicians can remove only their own. The audit keeps a copy. */
export async function deleteLabour(
  tx: Tx,
  actor: Actor,
  id: string,
  entryId: string,
  ctx: RequestContext,
): Promise<void> {
  const job = await lockJob(tx, id, staffScope(actor));
  assertLabourStatus(job);
  const entry = await tx.labourEntry.findFirst({
    where: { id: entryId, repairJobId: id },
    include: { user: userRef },
  });
  if (!entry) throw notFound('Labour entry');
  if (actor.role !== 'ADMIN' && entry.userId !== actor.userId) {
    throw forbidden('You can only remove your own labour entries');
  }
  await tx.labourEntry.delete({ where: { id: entryId } });
  await recordAudit(
    tx,
    {
      actorUserId: actor.userId,
      action: 'labour.deleted',
      entityType: 'LabourEntry',
      entityId: entryId,
      repairJobId: id,
      assetId: job.assetId,
      customerAccountId: job.customerAccountId,
      before: toLabourDto(entry),
    },
    ctx,
  );
}

// --- Quotations -----------------------------------------------------------------------

async function companyRates(db: Db): Promise<{ currency: string; vatRateBasisPoints: number }> {
  const settings = await db.companySettings.findUniqueOrThrow({ where: { id: 1 } });
  return { currency: settings.currency, vatRateBasisPoints: settings.vatRateBasisPoints };
}

function pricedLines(lines: QuoteLineInput[]) {
  return lines.map((line, index) => {
    const quantityHundredths = toHundredths(line.quantity);
    return {
      position: index + 1,
      kind: line.kind,
      description: line.description,
      quantityHundredths,
      unitPriceCents: line.unitPriceCents,
      lineTotalCents: lineTotalCents(quantityHundredths, line.unitPriceCents),
    };
  });
}

function totalsFor(
  lines: Array<{ quantityHundredths: number; unitPriceCents: number }>,
  vatRateBasisPoints: number,
) {
  const totals = quoteTotals(lines, vatRateBasisPoints);
  if (totals.subtotalCents > MAX_QUOTE_SUBTOTAL_CENTS) {
    throw new AppError(
      422,
      'QUOTE_TOTAL_INVALID',
      'This quotation is larger than the R10 000 000 a single quotation can hold',
    );
  }
  return totals;
}

/** Quotations and parts are prepared by the assigned technician or an administrator. */
export function assertJobWorker(actor: Actor, job: JobRow): void {
  const actors = actorsOn(actor, job);
  if (!actors.includes('ADMIN') && !actors.includes('ASSIGNED_TECHNICIAN')) throw forbidden();
}

function assertQuoteStatus(job: JobRow): void {
  if (!QUOTE_STATUSES.includes(job.status)) {
    throw wrongStatus(
      job.status === 'QUOTE_REJECTED'
        ? 'Move the job back to diagnosing before preparing a revised quotation'
        : `Quotations cannot be prepared while the job is ${label(job.status).toLowerCase()}`,
    );
  }
}

async function findQuote(db: Db, jobId: string, quoteId: string): Promise<QuoteRow> {
  const quote = await db.quotation.findFirst({
    where: { id: quoteId, repairJobId: jobId },
    include: quoteInclude,
  });
  if (!quote) throw notFound('Quotation');
  return quote;
}

function quoteAudit(
  action: string,
  actor: Actor,
  job: JobRow,
  quoteId: string,
  after: unknown,
  before?: unknown,
) {
  return {
    actorUserId: actor.userId,
    action,
    entityType: 'Quotation',
    entityId: quoteId,
    repairJobId: job.id,
    assetId: job.assetId,
    customerAccountId: job.customerAccountId,
    before,
    after,
  };
}

export async function listQuotes(actor: Actor, id: string): Promise<Quotation[]> {
  await findJob(prisma, id, staffScope(actor));
  const rows = await prisma.quotation.findMany({
    where: { repairJobId: id },
    include: quoteInclude,
    orderBy: { revision: 'desc' },
  });
  return rows.map(toQuotationDto);
}

export async function createQuote(
  tx: Tx,
  actor: Actor,
  id: string,
  input: CreateQuoteInput,
  ctx: RequestContext,
): Promise<Quotation> {
  const job = await lockJob(tx, id, staffScope(actor));
  assertJobWorker(actor, job);
  assertQuoteStatus(job);
  const draft = await tx.quotation.findFirst({ where: { repairJobId: id, status: 'DRAFT' } });
  if (draft) {
    throw new AppError(
      409,
      'CONFLICT',
      `This job already has a draft quotation (revision ${draft.revision}). Edit or discard it first.`,
    );
  }
  const last = await tx.quotation.aggregate({
    where: { repairJobId: id },
    _max: { revision: true },
  });
  const rates = await companyRates(tx);
  const lines = pricedLines(input.lines);
  const created = await tx.quotation.create({
    data: {
      repairJobId: id,
      revision: (last._max.revision ?? 0) + 1,
      ...rates,
      ...totalsFor(lines, rates.vatRateBasisPoints),
      customerNote: input.customerNote ?? null,
      createdById: actor.userId,
      lines: { create: lines },
    },
    include: quoteInclude,
  });
  const dto = toQuotationDto(created);
  await recordAudit(tx, quoteAudit('quote.created', actor, job, created.id, dto), ctx);
  return dto;
}

export async function updateQuote(
  tx: Tx,
  actor: Actor,
  id: string,
  quoteId: string,
  input: UpdateQuoteInput,
  ctx: RequestContext,
): Promise<Quotation> {
  const job = await lockJob(tx, id, staffScope(actor));
  assertJobWorker(actor, job);
  assertQuoteStatus(job);
  const before = await findQuote(tx, id, quoteId);
  if (before.status !== 'DRAFT') {
    throw new AppError(
      409,
      'QUOTE_NOT_EDITABLE',
      'Only a draft quotation can be edited. Issued quotations are final; prepare a new revision instead.',
    );
  }
  checkVersion(before.version, input.version);

  const rates = await companyRates(tx);
  const newLines = input.lines ? pricedLines(input.lines) : undefined;
  if (newLines) {
    await tx.quotationLine.deleteMany({ where: { quotationId: quoteId } });
    await tx.quotationLine.createMany({
      data: newLines.map((l) => ({ ...l, quotationId: quoteId })),
    });
  }
  const lines = newLines ?? before.lines;
  const { count } = await tx.quotation.updateMany({
    where: { id: quoteId, status: 'DRAFT', version: input.version },
    data: {
      ...rates,
      ...totalsFor(lines, rates.vatRateBasisPoints),
      ...(input.customerNote !== undefined ? { customerNote: input.customerNote } : {}),
      version: { increment: 1 },
    },
  });
  if (count === 0) throw conflict();
  const after = toQuotationDto(await findQuote(tx, id, quoteId));
  await recordAudit(
    tx,
    quoteAudit('quote.updated', actor, job, quoteId, after, toQuotationDto(before)),
    ctx,
  );
  return after;
}

export async function deleteQuote(
  tx: Tx,
  actor: Actor,
  id: string,
  quoteId: string,
  ctx: RequestContext,
): Promise<void> {
  const job = await lockJob(tx, id, staffScope(actor));
  assertJobWorker(actor, job);
  const quote = await findQuote(tx, id, quoteId);
  if (quote.status !== 'DRAFT') {
    throw new AppError(409, 'QUOTE_NOT_EDITABLE', 'Only a draft quotation can be discarded');
  }
  await tx.quotation.delete({ where: { id: quoteId } });
  await recordAudit(
    tx,
    quoteAudit('quote.deleted', actor, job, quoteId, undefined, toQuotationDto(quote)),
    ctx,
  );
}

/**
 * Issues a draft. The VAT rate and totals are frozen from this moment (the
 * database refuses later changes). A previously issued quotation is marked
 * SUPERSEDED, so the customer can approve only the latest one. A job that was
 * DIAGNOSING moves to AWAITING_APPROVAL.
 */
export async function issueQuote(
  tx: Tx,
  actor: Actor,
  id: string,
  quoteId: string,
  version: number,
  ctx: RequestContext,
): Promise<Quotation> {
  const job = await lockJob(tx, id, staffScope(actor));
  assertJobWorker(actor, job);
  if (!QUOTE_STATUSES.includes(job.status)) {
    throw new AppError(
      422,
      'INVALID_TRANSITION',
      `A quotation cannot be issued while the job is ${label(job.status).toLowerCase()}`,
    );
  }
  const quote = await findQuote(tx, id, quoteId);
  if (quote.status !== 'DRAFT') {
    throw new AppError(409, 'QUOTE_NOT_EDITABLE', 'This quotation has already been issued');
  }
  checkVersion(quote.version, version);
  if (quote.lines.length === 0) {
    throw new AppError(422, 'QUOTE_TOTAL_INVALID', 'Add at least one line before issuing');
  }
  const rates = await companyRates(tx);
  const totals = totalsFor(quote.lines, rates.vatRateBasisPoints);
  if (totals.totalCents <= 0) {
    throw new AppError(422, 'QUOTE_TOTAL_INVALID', 'A quotation must have a total above zero');
  }

  const previous = await tx.quotation.findFirst({
    where: { repairJobId: id, status: 'ISSUED' },
    select: { id: true, revision: true },
  });
  if (previous) {
    await tx.quotation.update({
      where: { id: previous.id },
      data: { status: 'SUPERSEDED', version: { increment: 1 } },
    });
  }
  const { count } = await tx.quotation.updateMany({
    where: { id: quoteId, status: 'DRAFT', version },
    data: {
      status: 'ISSUED',
      ...rates,
      ...totals,
      issuedAt: new Date(),
      issuedById: actor.userId,
      version: { increment: 1 },
    },
  });
  if (count === 0) throw conflict();

  if (job.status === 'DIAGNOSING') {
    await moveJob(tx, job, 'AWAITING_APPROVAL', actor, {
      note: `Quotation revision ${quote.revision} issued`,
    });
  }

  const after = toQuotationDto(await findQuote(tx, id, quoteId));
  await recordAudit(
    tx,
    quoteAudit('quote.issued', actor, job, quoteId, {
      revision: after.revision,
      totalCents: after.totalCents,
      vatRateBasisPoints: after.vatRateBasisPoints,
      supersededRevision: previous?.revision ?? null,
      jobStatus: job.status === 'DIAGNOSING' ? 'AWAITING_APPROVAL' : job.status,
    }),
    ctx,
  );
  return after;
}

const NOT_ISSUED_MESSAGES: Record<string, string> = {
  DRAFT: 'This quotation has not been issued yet',
  APPROVED: 'This quotation has already been approved',
  REJECTED: 'This quotation has already been rejected',
  SUPERSEDED: 'This quotation has been replaced by a newer revision. Review the latest one.',
  WITHDRAWN: 'This quotation has been withdrawn',
};

export interface QuoteDecision {
  approve: boolean;
  version: number;
  channel: DecisionChannel;
  note: string | null;
}

/**
 * Approves or rejects the issued quotation. The quotation update is
 * conditional on `status = 'ISSUED' AND version = :seen`, and it runs while the
 * job row is locked, so a double click, two colleagues approving at once, or a
 * stale tab showing a superseded revision cannot approve twice or approve the
 * wrong quotation. The exact approved total is stored with the approval.
 */
export async function decideQuote(
  tx: Tx,
  actor: Actor,
  scope: JobScope,
  id: string,
  quoteId: string,
  decision: QuoteDecision,
  ctx: RequestContext,
): Promise<void> {
  const job = await lockJob(tx, id, scope);
  const quote = await findQuote(tx, id, quoteId);
  // Customers never see drafts, so a draft id is "not found" for them.
  if (actor.role === 'CUSTOMER' && quote.status === 'DRAFT') throw notFound('Quotation');

  const to = decision.approve ? 'APPROVED' : 'QUOTE_REJECTED';
  const rule = findRepairRule('AWAITING_APPROVAL', to)!;
  if (!canActAs(rule, actorsOn(actor, job))) throw forbidden();

  if (quote.status !== 'ISSUED' || job.status !== 'AWAITING_APPROVAL') {
    throw new AppError(
      409,
      'QUOTE_NOT_ISSUED',
      NOT_ISSUED_MESSAGES[quote.status] ?? 'This quotation is no longer open for a decision',
    );
  }
  checkVersion(quote.version, decision.version);

  const { count } = await tx.quotation.updateMany({
    where: { id: quoteId, status: 'ISSUED', version: decision.version },
    data: {
      status: decision.approve ? 'APPROVED' : 'REJECTED',
      decidedById: actor.userId,
      decidedAt: new Date(),
      decisionChannel: decision.channel,
      decisionNote: decision.note,
      approvedTotalCents: decision.approve ? quote.totalCents : null,
      version: { increment: 1 },
    },
  });
  if (count === 0) throw new AppError(409, 'QUOTE_NOT_ISSUED', 'This quotation was just decided');

  const onBehalf = isOnBehalf(decision.channel);
  const verb = decision.approve ? 'Approved' : 'Rejected';
  await moveJob(tx, job, to, actor, {
    note: onBehalf
      ? `${verb} on behalf of the customer (${DECISION_CHANNEL_LABELS[decision.channel]}): ${decision.note}`
      : `${verb} by the customer in the portal${decision.note ? `: ${decision.note}` : ''}`,
  });

  await recordAudit(
    tx,
    quoteAudit(decision.approve ? 'quote.approved' : 'quote.rejected', actor, job, quoteId, {
      revision: quote.revision,
      totalCents: quote.totalCents,
      channel: decision.channel,
      onBehalf,
      note: decision.note,
    }),
    ctx,
  );
}

export async function staffDecideQuote(
  tx: Tx,
  actor: Actor,
  id: string,
  quoteId: string,
  decision: QuoteDecision,
  ctx: RequestContext,
): Promise<Quotation> {
  await decideQuote(tx, actor, staffScope(actor), id, quoteId, decision, ctx);
  return toQuotationDto(await findQuote(tx, id, quoteId));
}
