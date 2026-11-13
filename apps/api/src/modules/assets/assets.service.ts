import {
  ASSET_EXPORT_LIMIT,
  ASSET_STATUS_LABELS,
  ASSET_STATUSES_SET_BY_REPAIRS,
  OPEN_REPAIR_STATUSES,
  canTransitionAsset,
  dateIssues,
  normaliseSerial,
  type Asset,
  type AssetEvent,
  type ChangeAssetStatusInput,
  type CreateAssetInput,
  type ExportAssetsQuery,
  type ListAssetsQuery,
  type Paginated,
  type UpdateAssetInput,
} from '@deviceflow/shared';
import { recordAudit } from '../../lib/audit.js';
import type { Actor, RequestContext } from '../../lib/context.js';
import { AppError, conflict, notFound } from '../../lib/errors.js';
import { pageArgs, paginated } from '../../lib/pagination.js';
import { Prisma, prisma, type Db } from '../../lib/prisma.js';
import type { Asset as AssetRow, CustomerAccount } from '../../generated/prisma/client.js';
import { toCustomerSummary } from '../customers/customers.service.js';

export const assetInclude = {
  customerAccount: true,
  createdBy: { select: { id: true, fullName: true } },
} as const;

type AssetWithRelations = AssetRow & {
  customerAccount: CustomerAccount | null;
  createdBy: { id: string; fullName: string };
};

/** `@db.Date` columns come back as UTC midnight; expose them as `YYYY-MM-DD`. */
export function toDateString(value: Date | null): string | null {
  return value ? value.toISOString().slice(0, 10) : null;
}

function toDateValue(value: string | null | undefined): Date | null | undefined {
  if (value === undefined) return undefined;
  return value === null ? null : new Date(`${value}T00:00:00.000Z`);
}

/** The manufacturer part of the duplicate-serial rule (see assets_manufacturer_key_chk). */
export function manufacturerKey(manufacturer: string): string {
  return manufacturer.trim().toUpperCase();
}

export function toAssetDto(row: AssetWithRelations): Asset {
  return {
    id: row.id,
    assetTag: row.assetTag,
    category: row.category,
    manufacturer: row.manufacturer,
    model: row.model,
    serialNumber: row.serialNumber,
    condition: row.condition,
    status: row.status,
    customer: row.customerAccount ? toCustomerSummary(row.customerAccount) : null,
    purchaseDate: toDateString(row.purchaseDate),
    warrantyExpiresOn: toDateString(row.warrantyExpiresOn),
    warrantyNotes: row.warrantyNotes,
    notes: row.notes,
    createdBy: row.createdBy,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    version: row.version,
  };
}

function todayUtc(): Date {
  return new Date(`${new Date().toISOString().slice(0, 10)}T00:00:00.000Z`);
}

export function assetWhere(query: ExportAssetsQuery): Prisma.AssetWhereInput {
  const { search } = query;
  const warranty: Prisma.AssetWhereInput =
    query.warranty === 'active'
      ? { warrantyExpiresOn: { gte: todayUtc() } }
      : query.warranty === 'expired'
        ? { warrantyExpiresOn: { lt: todayUtc() } }
        : query.warranty === 'none'
          ? { warrantyExpiresOn: null }
          : {};
  return {
    ...(query.status ? { status: query.status } : {}),
    ...(query.category ? { category: query.category } : {}),
    ...(query.customer === 'none'
      ? { customerAccountId: null }
      : query.customer
        ? { customerAccountId: query.customer }
        : {}),
    ...warranty,
    ...(search
      ? {
          OR: [
            { assetTag: { contains: search, mode: 'insensitive' } },
            // Serials are stored normalised, so normalise the search term the same way.
            { serialNumber: { contains: normaliseSerial(search) } },
            { manufacturer: { contains: search, mode: 'insensitive' } },
            { model: { contains: search, mode: 'insensitive' } },
            { customerAccount: { name: { contains: search, mode: 'insensitive' } } },
          ],
        }
      : {}),
  };
}

export function assetOrderBy(
  sort: ListAssetsQuery['sort'],
): Prisma.AssetOrderByWithRelationInput[] {
  const primary: Prisma.AssetOrderByWithRelationInput =
    sort.field === 'warrantyExpiresOn'
      ? { warrantyExpiresOn: { sort: sort.direction, nulls: 'last' } }
      : { [sort.field]: sort.direction };
  return [primary, { id: 'asc' }];
}

export async function listAssets(query: ListAssetsQuery): Promise<Paginated<Asset>> {
  const where = assetWhere(query);
  const [rows, total] = await prisma.$transaction([
    prisma.asset.findMany({
      where,
      include: assetInclude,
      orderBy: assetOrderBy(query.sort),
      ...pageArgs(query.page, query.pageSize),
    }),
    prisma.asset.count({ where }),
  ]);
  return paginated(rows.map(toAssetDto), total, query.page, query.pageSize);
}

export async function getAsset(id: string): Promise<Asset> {
  const row = await prisma.asset.findUnique({ where: { id }, include: assetInclude });
  if (!row) throw notFound('Asset');
  return toAssetDto(row);
}

/**
 * While a device has an open repair job, the job controls its status and its
 * owner (the job is scoped to that customer). Manual changes are refused.
 */
async function assertNoOpenRepair(db: Db, assetId: string, what: string): Promise<void> {
  const open = await db.repairJob.findFirst({
    where: { assetId, status: { in: OPEN_REPAIR_STATUSES } },
    select: { reference: true },
  });
  if (open) {
    throw new AppError(
      422,
      'ASSET_IN_REPAIR_JOB',
      `This device has an open repair job (${open.reference}). Its ${what} cannot change until the job is finished.`,
    );
  }
}

/** An asset can only be given to an existing, non-archived customer account. */
async function assertAssignableCustomer(db: Db, customerAccountId: string): Promise<void> {
  const customer = await db.customerAccount.findUnique({ where: { id: customerAccountId } });
  if (!customer) {
    throw new AppError(422, 'VALIDATION_FAILED', 'Some fields are invalid', [
      { path: 'customerAccountId', message: 'Customer not found' },
    ]);
  }
  if (!customer.isActive) {
    throw new AppError(422, 'CUSTOMER_ARCHIVED', `${customer.name} is archived`, [
      { path: 'customerAccountId', message: 'This customer is archived' },
    ]);
  }
}

/**
 * The unique index on (manufacturer_key, serial_number) is the real guard: it
 * also stops two simultaneous registrations of the same device. When it fires,
 * look up the existing asset so the user is told which record already has it.
 */
async function serialConflict(
  err: unknown,
  manufacturer: string,
  serialNumber: string | null | undefined,
) {
  if (
    !(err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') ||
    !serialNumber
  ) {
    return err;
  }
  const existing = await prisma.asset.findFirst({
    where: { manufacturerKey: manufacturerKey(manufacturer), serialNumber },
    select: { assetTag: true, manufacturer: true },
  });
  const message = existing
    ? `This ${existing.manufacturer} serial number is already registered as ${existing.assetTag}`
    : `This ${manufacturer} serial number is already registered`;
  return new AppError(409, 'SERIAL_TAKEN', message, [{ path: 'serialNumber', message }]);
}

export async function createAsset(
  actor: Actor,
  input: CreateAssetInput,
  ctx: RequestContext,
): Promise<Asset> {
  try {
    return await prisma.$transaction(async (tx) => {
      if (input.customerAccountId) await assertAssignableCustomer(tx, input.customerAccountId);

      const row = await tx.asset.create({
        data: {
          category: input.category,
          manufacturer: input.manufacturer,
          manufacturerKey: manufacturerKey(input.manufacturer),
          model: input.model,
          serialNumber: input.serialNumber ?? null,
          condition: input.condition,
          status: input.status,
          customerAccountId: input.customerAccountId ?? null,
          purchaseDate: toDateValue(input.purchaseDate),
          warrantyExpiresOn: toDateValue(input.warrantyExpiresOn),
          warrantyNotes: input.warrantyNotes,
          notes: input.notes,
          createdById: actor.userId,
        },
        include: assetInclude,
      });

      await tx.assetEvent.create({
        data: {
          assetId: row.id,
          type: 'REGISTERED',
          toStatus: row.status,
          toCustomerAccountId: row.customerAccountId,
          actorUserId: actor.userId,
        },
      });

      const dto = toAssetDto(row);
      await recordAudit(
        tx,
        {
          actorUserId: actor.userId,
          action: 'asset.created',
          entityType: 'Asset',
          entityId: row.id,
          assetId: row.id,
          customerAccountId: row.customerAccountId,
          after: dto,
        },
        ctx,
      );
      return dto;
    });
  } catch (err) {
    throw await serialConflict(err, input.manufacturer, input.serialNumber);
  }
}

const DETAIL_KEYS = [
  'category',
  'manufacturer',
  'model',
  'serialNumber',
  'condition',
  'purchaseDate',
  'warrantyExpiresOn',
  'warrantyNotes',
  'notes',
] as const;

/**
 * Edits details and/or the customer assignment, with optimistic concurrency.
 * Rules checked against the merged result (not just the request):
 *  - dates (warranty not before purchase, purchase not in the future),
 *  - an ACTIVE asset must stay assigned to a customer,
 *  - a new customer must exist and not be archived.
 * Each kind of change gets its own history event.
 */
export async function updateAsset(
  actor: Actor,
  id: string,
  input: UpdateAssetInput,
  ctx: RequestContext,
): Promise<Asset> {
  const { version, customerAccountId, ...details } = input;
  // Used to explain a duplicate-serial error with the values the row would have had.
  let manufacturerForError = details.manufacturer;
  let serialForError = details.serialNumber;

  try {
    return await prisma.$transaction(async (tx) => {
      const before = await tx.asset.findUnique({ where: { id }, include: assetInclude });
      if (!before) throw notFound('Asset');
      manufacturerForError ??= before.manufacturer;
      if (serialForError === undefined) serialForError = before.serialNumber;

      const issues = dateIssues({
        purchaseDate:
          details.purchaseDate !== undefined
            ? details.purchaseDate
            : toDateString(before.purchaseDate),
        warrantyExpiresOn:
          details.warrantyExpiresOn !== undefined
            ? details.warrantyExpiresOn
            : toDateString(before.warrantyExpiresOn),
      });
      if (issues.length > 0) {
        throw new AppError(422, 'VALIDATION_FAILED', 'Some fields are invalid', issues);
      }

      const customerChanging =
        customerAccountId !== undefined && customerAccountId !== before.customerAccountId;
      if (customerChanging) {
        if (customerAccountId === null && before.status === 'ACTIVE') {
          throw new AppError(
            422,
            'CUSTOMER_REQUIRED',
            'An active asset must belong to a customer. Change its status first.',
            [{ path: 'customerAccountId', message: 'An active asset needs a customer' }],
          );
        }
        if (customerAccountId) await assertAssignableCustomer(tx, customerAccountId);
        await assertNoOpenRepair(tx, id, 'owner');
      }

      // Compare in DTO form (normalised serial, YYYY-MM-DD dates) so re-saving an
      // unchanged value does not add a "details updated" event.
      const beforeDto = toAssetDto(before);
      const detailsChanging = DETAIL_KEYS.some(
        (key) => details[key] !== undefined && details[key] !== beforeDto[key],
      );

      const { count } = await tx.asset.updateMany({
        where: { id, version },
        data: {
          ...(details.category !== undefined ? { category: details.category } : {}),
          ...(details.manufacturer !== undefined
            ? {
                manufacturer: details.manufacturer,
                manufacturerKey: manufacturerKey(details.manufacturer),
              }
            : {}),
          ...(details.model !== undefined ? { model: details.model } : {}),
          ...(details.serialNumber !== undefined ? { serialNumber: details.serialNumber } : {}),
          ...(details.condition !== undefined ? { condition: details.condition } : {}),
          ...(details.purchaseDate !== undefined
            ? { purchaseDate: toDateValue(details.purchaseDate) }
            : {}),
          ...(details.warrantyExpiresOn !== undefined
            ? { warrantyExpiresOn: toDateValue(details.warrantyExpiresOn) }
            : {}),
          ...(details.warrantyNotes !== undefined ? { warrantyNotes: details.warrantyNotes } : {}),
          ...(details.notes !== undefined ? { notes: details.notes } : {}),
          ...(customerChanging ? { customerAccountId } : {}),
          version: { increment: 1 },
        },
      });
      if (count === 0) throw conflict();

      const after = await tx.asset.findUniqueOrThrow({ where: { id }, include: assetInclude });

      if (detailsChanging) {
        await tx.assetEvent.create({
          data: { assetId: id, type: 'DETAILS_UPDATED', actorUserId: actor.userId },
        });
      }
      if (customerChanging) {
        await tx.assetEvent.create({
          data: {
            assetId: id,
            type: 'CUSTOMER_CHANGED',
            fromCustomerAccountId: before.customerAccountId,
            toCustomerAccountId: after.customerAccountId,
            actorUserId: actor.userId,
          },
        });
      }

      await recordAudit(
        tx,
        {
          actorUserId: actor.userId,
          action: customerChanging ? 'asset.reassigned' : 'asset.updated',
          entityType: 'Asset',
          entityId: id,
          assetId: id,
          customerAccountId: after.customerAccountId ?? before.customerAccountId,
          before: toAssetDto(before),
          after: toAssetDto(after),
        },
        ctx,
      );
      return toAssetDto(after);
    });
  } catch (err) {
    throw await serialConflict(err, manufacturerForError ?? '', serialForError);
  }
}

/**
 * Moves an asset through its lifecycle. Only transitions in ASSET_TRANSITIONS
 * are allowed. The update is conditional on the version the user saw, so two
 * people changing the status at once cannot both succeed.
 */
export async function changeAssetStatus(
  actor: Actor,
  id: string,
  input: ChangeAssetStatusInput,
  ctx: RequestContext,
): Promise<Asset> {
  return prisma.$transaction(async (tx) => {
    const before = await tx.asset.findUnique({ where: { id }, include: assetInclude });
    if (!before) throw notFound('Asset');

    if (!canTransitionAsset(before.status, input.status)) {
      throw new AppError(
        422,
        'INVALID_TRANSITION',
        `An asset cannot move from ${ASSET_STATUS_LABELS[before.status]} to ${ASSET_STATUS_LABELS[input.status]}`,
      );
    }
    if (ASSET_STATUSES_SET_BY_REPAIRS.includes(input.status)) {
      throw new AppError(
        422,
        'INVALID_TRANSITION',
        'A device goes into repair when a repair job is opened for it. Book it in from Repairs.',
      );
    }
    await assertNoOpenRepair(tx, id, 'status');
    if (input.status === 'ACTIVE' && !before.customerAccountId) {
      throw new AppError(
        422,
        'CUSTOMER_REQUIRED',
        'Assign the asset to a customer before making it active',
      );
    }

    const { count } = await tx.asset.updateMany({
      where: { id, version: input.version },
      data: { status: input.status, version: { increment: 1 } },
    });
    if (count === 0) throw conflict();

    await tx.assetEvent.create({
      data: {
        assetId: id,
        type: 'STATUS_CHANGED',
        fromStatus: before.status,
        toStatus: input.status,
        note: input.reason ?? null,
        actorUserId: actor.userId,
      },
    });

    const after = await tx.asset.findUniqueOrThrow({ where: { id }, include: assetInclude });
    await recordAudit(
      tx,
      {
        actorUserId: actor.userId,
        action: 'asset.status_changed',
        entityType: 'Asset',
        entityId: id,
        assetId: id,
        customerAccountId: after.customerAccountId,
        before: { status: before.status },
        after: { status: after.status, reason: input.reason ?? null },
      },
      ctx,
    );
    return toAssetDto(after);
  });
}

export async function listAssetEvents(id: string): Promise<AssetEvent[]> {
  const asset = await prisma.asset.findUnique({ where: { id }, select: { id: true } });
  if (!asset) throw notFound('Asset');

  const events = await prisma.assetEvent.findMany({
    where: { assetId: id },
    include: { actor: { select: { id: true, fullName: true } } },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: 200,
  });

  const customerIds = [
    ...new Set(
      events.flatMap((e) => [e.fromCustomerAccountId, e.toCustomerAccountId]).filter(Boolean),
    ),
  ] as string[];
  const customers = new Map(
    (await prisma.customerAccount.findMany({ where: { id: { in: customerIds } } })).map((c) => [
      c.id,
      toCustomerSummary(c),
    ]),
  );

  return events.map((e) => ({
    id: e.id,
    type: e.type,
    fromStatus: e.fromStatus,
    toStatus: e.toStatus,
    fromCustomer: e.fromCustomerAccountId ? (customers.get(e.fromCustomerAccountId) ?? null) : null,
    toCustomer: e.toCustomerAccountId ? (customers.get(e.toCustomerAccountId) ?? null) : null,
    note: e.note,
    actor: e.actor,
    createdAt: e.createdAt.toISOString(),
  }));
}

// --- CSV export ------------------------------------------------------------------

const CSV_COLUMNS: Array<[string, (a: AssetWithRelations) => string | null]> = [
  ['Asset tag', (a) => a.assetTag],
  ['Category', (a) => a.category],
  ['Manufacturer', (a) => a.manufacturer],
  ['Model', (a) => a.model],
  ['Serial number', (a) => a.serialNumber],
  ['Condition', (a) => a.condition],
  ['Status', (a) => a.status],
  ['Customer account', (a) => a.customerAccount?.accountNumber ?? null],
  ['Customer name', (a) => a.customerAccount?.name ?? null],
  ['Purchase date', (a) => toDateString(a.purchaseDate)],
  ['Warranty expires', (a) => toDateString(a.warrantyExpiresOn)],
  ['Registered at', (a) => a.createdAt.toISOString()],
];

/**
 * Quotes every cell and neutralises spreadsheet formula injection: a cell that
 * starts with = + - @ (or a tab or carriage return) would be executed as a formula
 * by Excel, so it is prefixed with an apostrophe.
 */
export function csvCell(value: string | null): string {
  if (value === null) return '';
  const safe = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
  return `"${safe.replace(/"/g, '""')}"`;
}

/**
 * Produces the export in batches inside one REPEATABLE READ transaction, so the
 * file is a consistent snapshot even if assets change while it is written. The
 * export is capped and audited (who exported which filter, and how many rows).
 */
export async function exportAssets(
  actor: Actor,
  query: ExportAssetsQuery,
  ctx: RequestContext,
  write: (chunk: string) => void,
): Promise<number> {
  const where = assetWhere(query);
  return prisma.$transaction(
    async (tx) => {
      const total = await tx.asset.count({ where });
      if (total > ASSET_EXPORT_LIMIT) {
        throw new AppError(
          422,
          'EXPORT_TOO_LARGE',
          `This export has ${total.toLocaleString('en-ZA')} assets. Narrow the filters to ${ASSET_EXPORT_LIMIT.toLocaleString('en-ZA')} or fewer.`,
        );
      }

      await recordAudit(
        tx,
        {
          actorUserId: actor.userId,
          action: 'asset.exported',
          entityType: 'Asset',
          entityId: 'export',
          after: { filters: query, rowCount: total },
        },
        ctx,
      );

      // A UTF-8 byte order mark makes Excel read accented names correctly.
      write('\uFEFF' + CSV_COLUMNS.map(([header]) => csvCell(header)).join(',') + '\r\n');
      const batchSize = 500;
      for (let skip = 0; skip < total; skip += batchSize) {
        const rows = await tx.asset.findMany({
          where,
          include: assetInclude,
          orderBy: assetOrderBy(query.sort),
          skip,
          take: batchSize,
        });
        write(
          rows
            .map((row) => CSV_COLUMNS.map(([, get]) => csvCell(get(row))).join(','))
            .join('\r\n') + '\r\n',
        );
      }
      return total;
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead, timeout: 60_000 },
  );
}
