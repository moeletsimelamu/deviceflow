import request from 'supertest';
import { isRepairOpen, type RepairStatus, type Role } from '@deviceflow/shared';
import { createApp } from '../../src/http/app.js';
import { hashPassword } from '../../src/lib/crypto.js';
import { prisma } from '../../src/lib/prisma.js';

export const app = createApp();
export const TEST_PASSWORD = 'correct-horse-battery';
export const ORIGIN = 'http://localhost:5173';

let cachedHash: string | undefined;

/** Empties every data table (TRUNCATE does not fire the audit-log row triggers). */
export async function resetDatabase() {
  await prisma.$executeRawUnsafe(
    'TRUNCATE TABLE "stock_movements", "parts", "idempotency_keys", "quotation_lines", "quotations", "labour_entries", "repair_notes", "repair_status_history", "repair_jobs", "asset_events", "assets", "customer_contacts", "audit_logs", "sessions", "users", "customer_accounts" RESTART IDENTITY CASCADE',
  );
  await prisma.$executeRawUnsafe(
    `UPDATE "company_settings" SET "company_name" = 'DeviceFlow Services', "currency" = 'ZAR', "vat_rate_basis_points" = 1500, "version" = 0`,
  );
}

export async function createUser(
  role: Role,
  overrides: { email?: string; isActive?: boolean; customerAccountId?: string } = {},
) {
  cachedHash ??= await hashPassword(TEST_PASSWORD);
  return prisma.user.create({
    data: {
      email:
        overrides.email ?? `${role.toLowerCase()}-${crypto.randomUUID().slice(0, 8)}@example.test`,
      fullName: `${role} User`,
      role,
      passwordHash: cachedHash,
      isActive: overrides.isActive ?? true,
      customerAccountId: overrides.customerAccountId ?? null,
    },
  });
}

/** A Supertest agent that keeps cookies and sends the headers the web client sends. */
export function client() {
  const agent = request.agent(app);
  return {
    agent,
    get: (url: string) => agent.get(url),
    post: (url: string) =>
      agent.post(url).set('X-Requested-With', 'DeviceFlow').set('Origin', ORIGIN),
    patch: (url: string) =>
      agent.patch(url).set('X-Requested-With', 'DeviceFlow').set('Origin', ORIGIN),
    delete: (url: string) =>
      agent.delete(url).set('X-Requested-With', 'DeviceFlow').set('Origin', ORIGIN),
  };
}

export async function createCustomerAccount(
  overrides: { name?: string; type?: 'INDIVIDUAL' | 'ORGANISATION'; isActive?: boolean } = {},
) {
  return prisma.customerAccount.create({
    data: {
      name: overrides.name ?? `Customer ${crypto.randomUUID().slice(0, 6)}`,
      type: overrides.type ?? 'ORGANISATION',
      isActive: overrides.isActive ?? true,
    },
  });
}

let assetCounter = 0;

/** Inserts an asset directly (bypassing the API) for tests that need existing data. */
export async function createAsset(
  createdById: string,
  overrides: {
    customerAccountId?: string | null;
    status?: 'IN_STOCK' | 'ACTIVE' | 'IN_REPAIR' | 'REFURBISHING' | 'RETIRED' | 'DISPOSED';
    manufacturer?: string;
    serialNumber?: string | null;
    model?: string;
  } = {},
) {
  assetCounter += 1;
  const manufacturer = overrides.manufacturer ?? 'Dell';
  const asset = await prisma.asset.create({
    data: {
      category: 'LAPTOP',
      manufacturer,
      manufacturerKey: manufacturer.trim().toUpperCase(),
      model: overrides.model ?? 'Latitude 5440',
      serialNumber:
        overrides.serialNumber === undefined
          ? `SN${Date.now()}${assetCounter}`
          : overrides.serialNumber,
      status: overrides.status ?? (overrides.customerAccountId ? 'ACTIVE' : 'IN_STOCK'),
      customerAccountId: overrides.customerAccountId ?? null,
      createdById,
    },
  });
  await prisma.assetEvent.create({
    data: {
      assetId: asset.id,
      type: 'REGISTERED',
      toStatus: asset.status,
      toCustomerAccountId: asset.customerAccountId,
      actorUserId: createdById,
    },
  });
  return asset;
}

export async function loginAs(role: Role, options: { customerAccountId?: string } = {}) {
  const user = await createUser(role, options);
  const c = client();
  const res = await c
    .post('/api/v1/auth/login')
    .send({ email: user.email, password: TEST_PASSWORD });
  if (res.status !== 200)
    throw new Error(`login failed: ${res.status} ${JSON.stringify(res.body)}`);
  return { ...c, user };
}

/**
 * Inserts a repair job directly in any status (bypassing the API), with its
 * device in the matching state, so tests can start from any point of the
 * state machine. Pass `labour` to record one labour entry.
 */
export async function createRepairJob(options: {
  createdById: string;
  customerAccountId: string;
  status?: RepairStatus;
  technicianId?: string | null;
  assetId?: string;
  labour?: boolean;
}) {
  const status = options.status ?? 'SUBMITTED';
  const open = isRepairOpen(status);
  const assetId =
    options.assetId ??
    (
      await createAsset(options.createdById, {
        customerAccountId: options.customerAccountId,
        status: 'ACTIVE',
      })
    ).id;
  await prisma.asset.update({
    where: { id: assetId },
    data: { status: open ? 'IN_REPAIR' : 'ACTIVE' },
  });
  const finishedWork = ['COMPLETED', 'CLOSED'].includes(status);
  const job = await prisma.repairJob.create({
    data: {
      assetId,
      customerAccountId: options.customerAccountId,
      status,
      source: 'STAFF',
      faultDescription: 'Screen flickers and then goes black',
      submittedById: options.createdById,
      assignedTechnicianId: options.technicianId === undefined ? null : options.technicianId,
      completionSummary: finishedWork ? 'Replaced the display cable' : null,
      completedAt: finishedWork ? new Date() : null,
      closedAt: open ? null : new Date(),
    },
  });
  await prisma.repairStatusHistory.create({
    data: { repairJobId: job.id, toStatus: status, actorUserId: options.createdById },
  });
  if (options.labour) {
    await prisma.labourEntry.create({
      data: {
        repairJobId: job.id,
        userId: options.technicianId ?? options.createdById,
        minutes: 45,
        description: 'Diagnosis',
        workDate: new Date(`${new Date().toISOString().slice(0, 10)}T00:00:00.000Z`),
      },
    });
  }
  return job;
}

/**
 * Inserts a quotation for a job: a draft with one line, then optionally issued
 * (R1 000.00 + 15% VAT = R1 150.00).
 */
export async function createQuote(
  repairJobId: string,
  userId: string,
  options: { issue?: boolean; revision?: number } = {},
) {
  const quote = await prisma.quotation.create({
    data: {
      repairJobId,
      revision: options.revision ?? 1,
      currency: 'ZAR',
      vatRateBasisPoints: 1500,
      subtotalCents: 100_000,
      vatCents: 15_000,
      totalCents: 115_000,
      createdById: userId,
      lines: {
        create: [
          {
            position: 1,
            kind: 'LABOUR',
            description: 'Replace screen',
            quantityHundredths: 100,
            unitPriceCents: 100_000,
            lineTotalCents: 100_000,
          },
        ],
      },
    },
  });
  if (!options.issue) return quote;
  return prisma.quotation.update({
    where: { id: quote.id },
    data: { status: 'ISSUED', issuedAt: new Date(), issuedById: userId },
  });
}

let partCounter = 0;

/**
 * Inserts a part, then (optionally) a purchase of stock units in the same
 * transaction as the stock figure, as the database requires.
 */
export async function createPart(
  actorUserId: string,
  options: {
    sku?: string;
    name?: string;
    stock?: number;
    unitCostCents?: number;
    reorderLevel?: number;
  } = {},
) {
  partCounter += 1;
  const part = await prisma.part.create({
    data: {
      sku: options.sku ?? `PART-${partCounter}-${Date.now()}`,
      name: options.name ?? `Test part ${partCounter}`,
      category: 'BATTERY',
      reorderLevel: options.reorderLevel ?? 0,
    },
  });
  const stock = options.stock ?? 0;
  if (stock === 0) return part;
  const unitCostCents = options.unitCostCents ?? 10_000;
  return prisma.$transaction(async (tx) => {
    const updated = await tx.part.update({
      where: { id: part.id },
      data: { quantityOnHand: stock, averageCostCents: unitCostCents },
    });
    await tx.stockMovement.create({
      data: {
        partId: part.id,
        type: 'PURCHASE',
        quantityChange: stock,
        balanceAfter: stock,
        unitCostCents,
        actorUserId,
      },
    });
    return updated;
  });
}
