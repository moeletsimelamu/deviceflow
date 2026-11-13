import type {
  Contact,
  CreateContactInput,
  CreateCustomerInput,
  CreateCustomerUserInput,
  Customer,
  CustomerSummary,
  ListCustomersQuery,
  Paginated,
  UpdateContactInput,
  UpdateCustomerInput,
  User,
} from '@deviceflow/shared';
import { recordAudit } from '../../lib/audit.js';
import type { Actor, RequestContext } from '../../lib/context.js';
import { hashPassword } from '../../lib/crypto.js';
import { AppError, conflict, notFound } from '../../lib/errors.js';
import { pageArgs, paginated } from '../../lib/pagination.js';
import { Prisma, prisma, type Db } from '../../lib/prisma.js';
import type {
  CustomerAccount as CustomerRow,
  CustomerContact as ContactRow,
} from '../../generated/prisma/client.js';
import { toUserDto } from '../users/users.service.js';

type CustomerWithCounts = CustomerRow & { _count: { assets: number } };

const withAssetCount = { _count: { select: { assets: true } } } as const;

export function toCustomerSummary(row: CustomerRow): CustomerSummary {
  return {
    id: row.id,
    accountNumber: row.accountNumber,
    name: row.name,
    type: row.type,
    isActive: row.isActive,
  };
}

export function toCustomerDto(row: CustomerWithCounts): Customer {
  return {
    ...toCustomerSummary(row),
    email: row.email,
    phone: row.phone,
    vatNumber: row.vatNumber,
    addressLine1: row.addressLine1,
    addressLine2: row.addressLine2,
    city: row.city,
    region: row.region,
    postalCode: row.postalCode,
    notes: row.notes,
    assetCount: row._count.assets,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    version: row.version,
  };
}

function toContactDto(row: ContactRow): Contact {
  return {
    id: row.id,
    customerAccountId: row.customerAccountId,
    fullName: row.fullName,
    email: row.email,
    phone: row.phone,
    jobTitle: row.jobTitle,
    isPrimary: row.isPrimary,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    version: row.version,
  };
}

/** Drops keys whose value is undefined, so a PATCH only touches the fields it names. */
function definedOnly<T extends Record<string, unknown>>(value: T): Partial<T> {
  return Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined)) as Partial<T>;
}

async function findCustomerOrThrow(db: Db, id: string): Promise<CustomerRow> {
  const customer = await db.customerAccount.findUnique({ where: { id } });
  if (!customer) throw notFound('Customer');
  return customer;
}

// --- Accounts ------------------------------------------------------------------

export async function listCustomers(query: ListCustomersQuery): Promise<Paginated<Customer>> {
  const search = query.search;
  const where: Prisma.CustomerAccountWhereInput = {
    ...(query.type ? { type: query.type } : {}),
    ...(query.isActive !== undefined ? { isActive: query.isActive } : {}),
    ...(search
      ? {
          OR: [
            { name: { contains: search, mode: 'insensitive' } },
            { accountNumber: { contains: search, mode: 'insensitive' } },
            { email: { contains: search, mode: 'insensitive' } },
            { contacts: { some: { fullName: { contains: search, mode: 'insensitive' } } } },
          ],
        }
      : {}),
  };

  const [rows, total] = await prisma.$transaction([
    prisma.customerAccount.findMany({
      where,
      include: withAssetCount,
      orderBy: [{ [query.sort.field]: query.sort.direction }, { id: 'asc' }],
      ...pageArgs(query.page, query.pageSize),
    }),
    prisma.customerAccount.count({ where }),
  ]);
  return paginated(rows.map(toCustomerDto), total, query.page, query.pageSize);
}

export async function getCustomer(id: string): Promise<Customer> {
  const row = await prisma.customerAccount.findUnique({ where: { id }, include: withAssetCount });
  if (!row) throw notFound('Customer');
  return toCustomerDto(row);
}

export async function createCustomer(
  actor: Actor,
  input: CreateCustomerInput,
  ctx: RequestContext,
): Promise<Customer> {
  return prisma.$transaction(async (tx) => {
    const row = await tx.customerAccount.create({ data: input, include: withAssetCount });
    const dto = toCustomerDto(row);
    await recordAudit(
      tx,
      {
        actorUserId: actor.userId,
        action: 'customer.created',
        entityType: 'CustomerAccount',
        entityId: row.id,
        customerAccountId: row.id,
        after: dto,
      },
      ctx,
    );
    return dto;
  });
}

/**
 * Updates profile fields, or archives / restores the account (`isActive`).
 * Archiving signs out every portal user of the account in the same transaction,
 * and they cannot sign in again until it is restored.
 */
export async function updateCustomer(
  actor: Actor,
  id: string,
  input: UpdateCustomerInput,
  ctx: RequestContext,
): Promise<Customer> {
  const { version, ...changes } = input;
  return prisma.$transaction(async (tx) => {
    const before = await tx.customerAccount.findUnique({
      where: { id },
      include: withAssetCount,
    });
    if (!before) throw notFound('Customer');

    const { count } = await tx.customerAccount.updateMany({
      where: { id, version },
      data: { ...definedOnly(changes), version: { increment: 1 } },
    });
    if (count === 0) throw conflict();

    const after = await tx.customerAccount.findUniqueOrThrow({
      where: { id },
      include: withAssetCount,
    });

    const archived = before.isActive && !after.isActive;
    const restored = !before.isActive && after.isActive;
    if (archived) {
      await tx.session.deleteMany({ where: { user: { customerAccountId: id } } });
    }

    await recordAudit(
      tx,
      {
        actorUserId: actor.userId,
        action: archived
          ? 'customer.archived'
          : restored
            ? 'customer.restored'
            : 'customer.updated',
        entityType: 'CustomerAccount',
        entityId: id,
        customerAccountId: id,
        before: toCustomerDto(before),
        after: toCustomerDto(after),
      },
      ctx,
    );
    return toCustomerDto(after);
  });
}

/** Active accounts matching a search, for pickers (e.g. assigning an asset). */
export async function searchCustomerSummaries(search: string): Promise<CustomerSummary[]> {
  const rows = await prisma.customerAccount.findMany({
    where: {
      isActive: true,
      ...(search
        ? {
            OR: [
              { name: { contains: search, mode: 'insensitive' } },
              { accountNumber: { contains: search, mode: 'insensitive' } },
            ],
          }
        : {}),
    },
    orderBy: [{ name: 'asc' }, { id: 'asc' }],
    take: 20,
  });
  return rows.map(toCustomerSummary);
}

// --- Contacts ------------------------------------------------------------------

export async function listContacts(customerId: string): Promise<Contact[]> {
  await findCustomerOrThrow(prisma, customerId);
  const rows = await prisma.customerContact.findMany({
    where: { customerAccountId: customerId },
    orderBy: [{ isPrimary: 'desc' }, { fullName: 'asc' }, { id: 'asc' }],
  });
  return rows.map(toContactDto);
}

/** The partial unique index allows one primary contact, so demote the old one first. */
async function demotePrimary(tx: Db, customerId: string, exceptContactId?: string) {
  await tx.customerContact.updateMany({
    where: {
      customerAccountId: customerId,
      isPrimary: true,
      ...(exceptContactId ? { id: { not: exceptContactId } } : {}),
    },
    data: { isPrimary: false, version: { increment: 1 } },
  });
}

export async function createContact(
  actor: Actor,
  customerId: string,
  input: CreateContactInput,
  ctx: RequestContext,
): Promise<Contact> {
  return prisma.$transaction(async (tx) => {
    await findCustomerOrThrow(tx, customerId);
    if (input.isPrimary) await demotePrimary(tx, customerId);
    const row = await tx.customerContact.create({
      data: { ...input, customerAccountId: customerId },
    });
    const dto = toContactDto(row);
    await recordAudit(
      tx,
      {
        actorUserId: actor.userId,
        action: 'contact.created',
        entityType: 'CustomerContact',
        entityId: row.id,
        customerAccountId: customerId,
        after: dto,
      },
      ctx,
    );
    return dto;
  });
}

export async function updateContact(
  actor: Actor,
  customerId: string,
  contactId: string,
  input: UpdateContactInput,
  ctx: RequestContext,
): Promise<Contact> {
  const { version, ...changes } = input;
  return prisma.$transaction(async (tx) => {
    // Scoping the lookup by account means a contact id from another account is a 404.
    const before = await tx.customerContact.findFirst({
      where: { id: contactId, customerAccountId: customerId },
    });
    if (!before) throw notFound('Contact');

    if (changes.isPrimary === true && !before.isPrimary) {
      await demotePrimary(tx, customerId, contactId);
    }
    const { count } = await tx.customerContact.updateMany({
      where: { id: contactId, version },
      data: { ...definedOnly(changes), version: { increment: 1 } },
    });
    if (count === 0) throw conflict();

    const after = await tx.customerContact.findUniqueOrThrow({ where: { id: contactId } });
    await recordAudit(
      tx,
      {
        actorUserId: actor.userId,
        action: 'contact.updated',
        entityType: 'CustomerContact',
        entityId: contactId,
        customerAccountId: customerId,
        before: toContactDto(before),
        after: toContactDto(after),
      },
      ctx,
    );
    return toContactDto(after);
  });
}

/**
 * Contacts are the one record type that can be removed: a person who has left
 * a school is no longer a contact. The audit entry keeps what was removed.
 */
export async function deleteContact(
  actor: Actor,
  customerId: string,
  contactId: string,
  ctx: RequestContext,
): Promise<void> {
  await prisma.$transaction(async (tx) => {
    const before = await tx.customerContact.findFirst({
      where: { id: contactId, customerAccountId: customerId },
    });
    if (!before) throw notFound('Contact');
    await tx.customerContact.delete({ where: { id: contactId } });
    await recordAudit(
      tx,
      {
        actorUserId: actor.userId,
        action: 'contact.deleted',
        entityType: 'CustomerContact',
        entityId: contactId,
        customerAccountId: customerId,
        before: toContactDto(before),
      },
      ctx,
    );
  });
}

// --- Portal users --------------------------------------------------------------

export async function listCustomerUsers(customerId: string): Promise<User[]> {
  await findCustomerOrThrow(prisma, customerId);
  const rows = await prisma.user.findMany({
    where: { customerAccountId: customerId },
    orderBy: [{ fullName: 'asc' }, { id: 'asc' }],
    take: 100,
  });
  return rows.map(toUserDto);
}

export async function createCustomerUser(
  actor: Actor,
  customerId: string,
  input: CreateCustomerUserInput,
  ctx: RequestContext,
): Promise<User> {
  const customer = await findCustomerOrThrow(prisma, customerId);
  if (!customer.isActive) {
    throw new AppError(
      422,
      'CUSTOMER_ARCHIVED',
      'This customer is archived. Restore it before adding portal users.',
    );
  }
  const passwordHash = await hashPassword(input.password);
  try {
    return await prisma.$transaction(async (tx) => {
      const user = await tx.user.create({
        data: {
          email: input.email,
          fullName: input.fullName,
          role: 'CUSTOMER',
          customerAccountId: customerId,
          passwordHash,
        },
      });
      const dto = toUserDto(user);
      await recordAudit(
        tx,
        {
          actorUserId: actor.userId,
          action: 'customer_user.created',
          entityType: 'User',
          entityId: user.id,
          customerAccountId: customerId,
          after: dto,
        },
        ctx,
      );
      return dto;
    });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      throw new AppError(409, 'EMAIL_TAKEN', 'A user with this email address already exists');
    }
    throw err;
  }
}
