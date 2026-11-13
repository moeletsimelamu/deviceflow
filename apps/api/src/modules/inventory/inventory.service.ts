import {
  PART_USAGE_STATUSES,
  REPAIR_STATUS_LABELS,
  stockStateOf,
  type CreatePartInput,
  type ListMovementsQuery,
  type ListPartsQuery,
  type Paginated,
  type Part,
  type RecordAdjustmentInput,
  type RecordPurchaseInput,
  type RepairPartLine,
  type RepairParts,
  type StockMovement,
  type StockMovementType,
  type UpdatePartInput,
  type UseRepairPartInput,
} from '@deviceflow/shared';
import { recordAudit } from '../../lib/audit.js';
import type { Actor, RequestContext } from '../../lib/context.js';
import { AppError, conflict, notFound } from '../../lib/errors.js';
import { pageArgs, paginated } from '../../lib/pagination.js';
import { Prisma, prisma, type Db, type Tx } from '../../lib/prisma.js';
import { assertJobWorker, lockJob, staffScope, type JobRow } from '../repairs/repairs.service.js';

/*
 * Inventory (Phase 1, §3.3).
 *
 * `parts.quantity_on_hand` is a stored balance, and the stock ledger
 * (`stock_movements`) explains every change to it. The two always change in the
 * same transaction, and a deferred database trigger refuses to commit if they
 * disagree.
 *
 * Stock is taken out with ONE conditional statement:
 *
 *   UPDATE parts SET quantity_on_hand = quantity_on_hand - n
 *   WHERE id = $1 AND is_active AND quantity_on_hand >= n
 *
 * Postgres locks the row for the UPDATE and re-checks the WHERE clause against
 * the latest committed value, so when two requests race for the last unit, one
 * updates the row and the other matches nothing and gets 409 INSUFFICIENT_STOCK.
 * Nothing reads the stock first and decides later, which is the pattern that lets
 * stock go negative. The CHECK (quantity_on_hand >= 0) constraint is the backstop.
 */

// --- Mapping ---------------------------------------------------------------------

type PartRow = Prisma.PartGetPayload<object>;

export function toPartDto(row: PartRow): Part {
  return {
    id: row.id,
    sku: row.sku,
    name: row.name,
    category: row.category,
    description: row.description,
    location: row.location,
    quantityOnHand: row.quantityOnHand,
    reorderLevel: row.reorderLevel,
    stockState: stockStateOf(row.quantityOnHand, row.reorderLevel),
    averageCostCents: row.averageCostCents,
    stockValueCents: row.quantityOnHand * row.averageCostCents,
    isActive: row.isActive,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    version: row.version,
  };
}

const movementInclude = {
  part: { select: { id: true, sku: true, name: true } },
  repairJob: { select: { id: true, reference: true } },
  actor: { select: { id: true, fullName: true } },
} satisfies Prisma.StockMovementInclude;

type MovementRow = Prisma.StockMovementGetPayload<{ include: typeof movementInclude }>;

function toMovementDto(row: MovementRow): StockMovement {
  return {
    id: row.id,
    type: row.type,
    part: row.part,
    quantityChange: row.quantityChange,
    balanceAfter: row.balanceAfter,
    unitCostCents: row.unitCostCents,
    supplier: row.supplier,
    reference: row.reference,
    note: row.note,
    repairJob: row.repairJob,
    actor: row.actor,
    createdAt: row.createdAt.toISOString(),
  };
}

// --- Stock primitives --------------------------------------------------------------

interface StockResult {
  balance: number;
  averageCostCents: number;
}

/**
 * Explains why a conditional stock update matched no row: the part does not
 * exist, it is archived, or there is not enough of it.
 */
async function stockRefusal(db: Db, partId: string, wanted?: number): Promise<AppError> {
  const part = await db.part.findUnique({ where: { id: partId } });
  if (!part) return notFound('Part');
  if (!part.isActive) {
    return new AppError(
      422,
      'PART_ARCHIVED',
      `${part.name} is archived. Restore it before changing its stock.`,
    );
  }
  return new AppError(
    409,
    'INSUFFICIENT_STOCK',
    `Only ${part.quantityOnHand} of ${part.name} in stock, so ${wanted ?? 'that many'} cannot be taken out`,
  );
}

/** Removes `quantity` units if, and only if, that many are in stock right now. */
async function takeStock(tx: Tx, partId: string, quantity: number): Promise<StockResult> {
  const rows = await tx.$queryRaw<StockResult[]>`
    UPDATE "parts"
    SET "quantity_on_hand" = "quantity_on_hand" - ${quantity}::integer, "updated_at" = now()
    WHERE "id" = ${partId}::uuid AND "is_active" AND "quantity_on_hand" >= ${quantity}::integer
    RETURNING "quantity_on_hand" AS "balance", "average_cost_cents" AS "averageCostCents"`;
  if (!rows[0]) throw await stockRefusal(tx, partId, quantity);
  return rows[0];
}

/** Adds `quantity` units at the current average cost (returns and upward adjustments). */
async function addStock(tx: Tx, partId: string, quantity: number): Promise<StockResult> {
  const rows = await tx.$queryRaw<StockResult[]>`
    UPDATE "parts"
    SET "quantity_on_hand" = "quantity_on_hand" + ${quantity}::integer, "updated_at" = now()
    WHERE "id" = ${partId}::uuid AND "is_active"
    RETURNING "quantity_on_hand" AS "balance", "average_cost_cents" AS "averageCostCents"`;
  if (!rows[0]) throw await stockRefusal(tx, partId);
  return rows[0];
}

/**
 * Adds purchased units and moves the weighted average cost:
 *   new average = (on hand × average + bought × price) / (on hand + bought),
 * rounded half-up to the cent, in 64-bit integers. It is one statement, so it
 * always uses the stock figure it is changing.
 */
async function receiveStock(
  tx: Tx,
  partId: string,
  quantity: number,
  unitCostCents: number,
): Promise<StockResult> {
  const rows = await tx.$queryRaw<StockResult[]>`
    UPDATE "parts"
    SET "average_cost_cents" = (
          (2 * ("quantity_on_hand"::bigint * "average_cost_cents"
                + ${quantity}::bigint * ${unitCostCents}::bigint)
           + "quantity_on_hand" + ${quantity}::bigint)
          / (2 * ("quantity_on_hand" + ${quantity}::bigint))
        )::integer,
        "quantity_on_hand" = "quantity_on_hand" + ${quantity}::integer,
        "updated_at" = now()
    WHERE "id" = ${partId}::uuid AND "is_active"
    RETURNING "quantity_on_hand" AS "balance", "average_cost_cents" AS "averageCostCents"`;
  if (!rows[0]) throw await stockRefusal(tx, partId);
  return rows[0];
}

interface MovementData {
  partId: string;
  type: StockMovementType;
  quantityChange: number;
  balanceAfter: number;
  unitCostCents: number;
  actorUserId: string;
  supplier?: string | null;
  reference?: string | null;
  note?: string | null;
  repairJobId?: string | null;
}

function writeMovement(tx: Tx, data: MovementData): Promise<MovementRow> {
  return tx.stockMovement.create({ data, include: movementInclude });
}

// --- Parts -------------------------------------------------------------------------

function isUniqueViolation(err: unknown): boolean {
  return err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002';
}

function skuTaken(sku: string): AppError {
  return new AppError(409, 'SKU_TAKEN', `Another part already uses the SKU ${sku}`, [
    { path: 'sku', message: 'This SKU is already in use' },
  ]);
}

function stockWhere(stock: ListPartsQuery['stock']): Prisma.PartWhereInput {
  if (stock === 'out') return { quantityOnHand: { lte: 0 } };
  // Compares two columns of the same row: quantity_on_hand <= reorder_level.
  if (stock === 'low') return { quantityOnHand: { lte: prisma.part.fields.reorderLevel } };
  return {};
}

export async function listParts(query: ListPartsQuery): Promise<Paginated<Part>> {
  const { search } = query;
  const where: Prisma.PartWhereInput = {
    AND: [
      { isActive: query.isActive },
      query.category ? { category: query.category } : {},
      stockWhere(query.stock),
      search
        ? {
            OR: [
              { sku: { contains: search, mode: 'insensitive' } },
              { name: { contains: search, mode: 'insensitive' } },
              { location: { contains: search, mode: 'insensitive' } },
            ],
          }
        : {},
    ],
  };
  const [rows, total] = await prisma.$transaction([
    prisma.part.findMany({
      where,
      orderBy: [
        { [query.sort.field]: query.sort.direction } as Prisma.PartOrderByWithRelationInput,
        { id: 'asc' },
      ],
      ...pageArgs(query.page, query.pageSize),
    }),
    prisma.part.count({ where }),
  ]);
  return paginated(rows.map(toPartDto), total, query.page, query.pageSize);
}

export async function getPart(id: string): Promise<Part> {
  const part = await prisma.part.findUnique({ where: { id } });
  if (!part) throw notFound('Part');
  return toPartDto(part);
}

export async function createPart(
  tx: Tx,
  actor: Actor,
  input: CreatePartInput,
  ctx: RequestContext,
): Promise<Part> {
  let row: PartRow;
  try {
    row = await tx.part.create({ data: input });
  } catch (err) {
    if (isUniqueViolation(err)) throw skuTaken(input.sku);
    throw err;
  }
  const dto = toPartDto(row);
  await recordAudit(
    tx,
    {
      actorUserId: actor.userId,
      action: 'part.created',
      entityType: 'Part',
      entityId: row.id,
      after: dto,
    },
    ctx,
  );
  return dto;
}

/**
 * Edits a part's details, or archives (`isActive: false`) or restores it. The row
 * is locked first, so "no stock left" is checked against the current figure and a
 * delivery cannot land between the check and the archive.
 */
export async function updatePart(
  tx: Tx,
  actor: Actor,
  id: string,
  input: UpdatePartInput,
  ctx: RequestContext,
): Promise<Part> {
  await tx.$queryRaw`SELECT 1 FROM "parts" WHERE "id" = ${id}::uuid FOR UPDATE`;
  const before = await tx.part.findUnique({ where: { id } });
  if (!before) throw notFound('Part');
  if (before.version !== input.version) throw conflict();

  const { version, ...changes } = input;
  const archiving = before.isActive && changes.isActive === false;
  if (archiving && before.quantityOnHand > 0) {
    throw new AppError(
      422,
      'PART_HAS_STOCK',
      `${before.name} still has ${before.quantityOnHand} in stock. Use it or write it off before archiving.`,
    );
  }

  let after: PartRow;
  try {
    after = await tx.part.update({
      where: { id, version },
      data: { ...changes, version: { increment: 1 } },
    });
  } catch (err) {
    if (isUniqueViolation(err)) throw skuTaken(changes.sku ?? before.sku);
    throw err;
  }

  const restored = !before.isActive && after.isActive;
  await recordAudit(
    tx,
    {
      actorUserId: actor.userId,
      action: archiving ? 'part.archived' : restored ? 'part.restored' : 'part.updated',
      entityType: 'Part',
      entityId: id,
      before: toPartDto(before),
      after: toPartDto(after),
    },
    ctx,
  );
  return toPartDto(after);
}

// --- Purchases and adjustments ---------------------------------------------------------

function stockAudit(
  action: string,
  actor: Actor,
  movement: MovementRow,
  job?: Pick<JobRow, 'id' | 'assetId' | 'customerAccountId'>,
) {
  return {
    actorUserId: actor.userId,
    action,
    entityType: 'Part',
    entityId: movement.partId,
    repairJobId: job?.id ?? null,
    assetId: job?.assetId ?? null,
    customerAccountId: job?.customerAccountId ?? null,
    after: {
      movementId: movement.id,
      type: movement.type,
      quantityChange: movement.quantityChange,
      balanceAfter: movement.balanceAfter,
      unitCostCents: movement.unitCostCents,
      supplier: movement.supplier,
      reference: movement.reference,
      note: movement.note,
    },
  };
}

export async function recordPurchase(
  tx: Tx,
  actor: Actor,
  partId: string,
  input: RecordPurchaseInput,
  ctx: RequestContext,
): Promise<StockMovement> {
  const stock = await receiveStock(tx, partId, input.quantity, input.unitCostCents);
  const movement = await writeMovement(tx, {
    partId,
    type: 'PURCHASE',
    quantityChange: input.quantity,
    balanceAfter: stock.balance,
    unitCostCents: input.unitCostCents,
    supplier: input.supplier,
    reference: input.reference,
    note: input.note,
    actorUserId: actor.userId,
  });
  await recordAudit(tx, stockAudit('stock.purchased', actor, movement), ctx);
  return toMovementDto(movement);
}

export async function recordAdjustment(
  tx: Tx,
  actor: Actor,
  partId: string,
  input: RecordAdjustmentInput,
  ctx: RequestContext,
): Promise<StockMovement> {
  const out = input.direction === 'OUT';
  const stock = out
    ? await takeStock(tx, partId, input.quantity)
    : await addStock(tx, partId, input.quantity);
  const movement = await writeMovement(tx, {
    partId,
    type: out ? 'ADJUSTMENT_OUT' : 'ADJUSTMENT_IN',
    quantityChange: out ? -input.quantity : input.quantity,
    balanceAfter: stock.balance,
    unitCostCents: stock.averageCostCents,
    note: input.note,
    actorUserId: actor.userId,
  });
  await recordAudit(tx, stockAudit('stock.adjusted', actor, movement), ctx);
  return toMovementDto(movement);
}

function dayStart(date: string): Date {
  return new Date(`${date}T00:00:00.000Z`);
}

/** The stock ledger, newest first. */
export async function listMovements(query: ListMovementsQuery): Promise<Paginated<StockMovement>> {
  const createdAt: Prisma.DateTimeFilter = {};
  if (query.from) createdAt.gte = dayStart(query.from);
  if (query.to) createdAt.lt = new Date(dayStart(query.to).getTime() + 24 * 60 * 60_000);
  const where: Prisma.StockMovementWhereInput = {
    ...(query.type ? { type: query.type } : {}),
    ...(query.part ? { partId: query.part } : {}),
    ...(query.repairJob ? { repairJobId: query.repairJob } : {}),
    ...(query.from || query.to ? { createdAt } : {}),
  };
  const [rows, total] = await prisma.$transaction([
    prisma.stockMovement.findMany({
      where,
      include: movementInclude,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      ...pageArgs(query.page, query.pageSize),
    }),
    prisma.stockMovement.count({ where }),
  ]);
  return paginated(rows.map(toMovementDto), total, query.page, query.pageSize);
}

// --- Parts on repair jobs ------------------------------------------------------------------

function assertPartStatus(job: JobRow): void {
  if (!PART_USAGE_STATUSES.includes(job.status)) {
    throw new AppError(
      422,
      'WRONG_REPAIR_STATUS',
      `Parts can be used only while a job is in repair, waiting for parts or in quality check. This job is ${REPAIR_STATUS_LABELS[job.status].toLowerCase()}.`,
    );
  }
}

async function jobMovements(db: Db, jobId: string): Promise<MovementRow[]> {
  return db.stockMovement.findMany({
    where: { repairJobId: jobId },
    include: movementInclude,
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
  });
}

/** Net use per part: units used minus units returned, and the cost of what is still used. */
function summarise(movements: MovementRow[]): RepairParts {
  const byPart = new Map<string, RepairPartLine>();
  for (const m of movements) {
    const line = byPart.get(m.partId) ?? { part: m.part, quantity: 0, costCents: 0 };
    line.quantity -= m.quantityChange;
    line.costCents -= m.quantityChange * m.unitCostCents;
    byPart.set(m.partId, line);
  }
  const lines = [...byPart.values()]
    .filter((l) => l.quantity > 0)
    .sort((a, b) => a.part.name.localeCompare(b.part.name));
  return {
    lines,
    totalCostCents: lines.reduce((sum, l) => sum + l.costCents, 0),
    movements: movements.map(toMovementDto),
  };
}

export async function listRepairParts(actor: Actor, jobId: string): Promise<RepairParts> {
  const job = await prisma.repairJob.findFirst({
    where: { id: jobId, ...staffScope(actor) },
    select: { id: true },
  });
  if (!job) throw notFound('Repair job');
  return summarise(await jobMovements(prisma, jobId));
}

/**
 * Takes parts out of stock for a job. The job row is locked so that uses and
 * returns on one job are applied one at a time; the stock itself is protected by
 * the conditional update, which also covers different jobs racing for one part.
 */
export async function useRepairPart(
  tx: Tx,
  actor: Actor,
  jobId: string,
  input: UseRepairPartInput,
  ctx: RequestContext,
): Promise<StockMovement> {
  const job = await lockJob(tx, jobId, staffScope(actor));
  assertJobWorker(actor, job);
  assertPartStatus(job);
  const stock = await takeStock(tx, input.partId, input.quantity);
  const movement = await writeMovement(tx, {
    partId: input.partId,
    type: 'REPAIR_CONSUMPTION',
    quantityChange: -input.quantity,
    balanceAfter: stock.balance,
    unitCostCents: stock.averageCostCents,
    note: input.note,
    repairJobId: job.id,
    actorUserId: actor.userId,
  });
  await recordAudit(tx, stockAudit('repair_part.used', actor, movement, job), ctx);
  return toMovementDto(movement);
}

/**
 * Puts unused units back in stock. At most the job's net use of the part can be
 * returned (the database trigger checks this too). The units go back at the
 * average cost the job was charged for them, and do not change the part's
 * average cost.
 */
export async function returnRepairPart(
  tx: Tx,
  actor: Actor,
  jobId: string,
  input: UseRepairPartInput,
  ctx: RequestContext,
): Promise<StockMovement> {
  const job = await lockJob(tx, jobId, staffScope(actor));
  assertJobWorker(actor, job);
  assertPartStatus(job);

  const history = await tx.stockMovement.findMany({
    where: { repairJobId: job.id, partId: input.partId },
    select: { type: true, quantityChange: true, unitCostCents: true },
  });
  const used = -history.reduce((sum, m) => sum + m.quantityChange, 0);
  if (input.quantity > used) {
    throw new AppError(
      422,
      'RETURN_EXCEEDS_USAGE',
      used === 0
        ? 'This part has not been used on this job'
        : `Only ${used} of this part ${used === 1 ? 'is' : 'are'} in use on this job`,
      [{ path: 'quantity', message: `At most ${used}` }],
    );
  }
  const consumed = history.filter((m) => m.type === 'REPAIR_CONSUMPTION');
  const consumedUnits = -consumed.reduce((sum, m) => sum + m.quantityChange, 0);
  const consumedCost = -consumed.reduce((sum, m) => sum + m.quantityChange * m.unitCostCents, 0);
  const unitCostCents = Math.floor((2 * consumedCost + consumedUnits) / (2 * consumedUnits));

  const stock = await addStock(tx, input.partId, input.quantity);
  const movement = await writeMovement(tx, {
    partId: input.partId,
    type: 'REPAIR_RETURN',
    quantityChange: input.quantity,
    balanceAfter: stock.balance,
    unitCostCents,
    note: input.note,
    repairJobId: job.id,
    actorUserId: actor.userId,
  });
  await recordAudit(tx, stockAudit('repair_part.returned', actor, movement, job), ctx);
  return toMovementDto(movement);
}
