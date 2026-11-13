/**
 * Development / demo seed. Creates one user per staff role.
 *
 * - Passwords come from SEED_DEFAULT_PASSWORD (see .env.example); nothing is hardcoded.
 * - Refuses to run when NODE_ENV=production unless DEMO_SEED_CONFIRM is set to
 *   "this-is-not-production" (used only by the local Docker demo stack).
 * - Idempotent: re-running updates the demo users and skips customers and assets
 *   that already exist, instead of duplicating them. Demo repairs are created only
 *   when there are no repair jobs yet.
 * - Repairs are created through the real services, so they get the same history,
 *   device status changes and audit entries as jobs created in the app.
 */
import {
  newPasswordSchema,
  normaliseSerial,
  type AssetCategory,
  type AssetStatus,
  type CreatePartInput,
  type QuoteLineInput,
  type RepairStatus,
  type Role,
} from '@deviceflow/shared';
import { hashPassword } from '../src/lib/crypto.js';
import type { Actor } from '../src/lib/context.js';
import { prisma } from '../src/lib/prisma.js';
import * as inventory from '../src/modules/inventory/inventory.service.js';
import * as repairs from '../src/modules/repairs/repairs.service.js';

const DEMO_USERS: Array<{ email: string; fullName: string; role: Role }> = [
  { email: 'admin@deviceflow.test', fullName: 'Naledi Mokoena', role: 'ADMIN' },
  { email: 'tech@deviceflow.test', fullName: 'Sipho Dlamini', role: 'TECHNICIAN' },
  { email: 'tech2@deviceflow.test', fullName: 'Lerato Khumalo', role: 'TECHNICIAN' },
  { email: 'inventory@deviceflow.test', fullName: 'Johan van Wyk', role: 'INVENTORY_MANAGER' },
];

async function main() {
  if (
    process.env.NODE_ENV === 'production' &&
    process.env.DEMO_SEED_CONFIRM !== 'this-is-not-production'
  ) {
    throw new Error('Refusing to seed demo data with NODE_ENV=production.');
  }

  const password = newPasswordSchema.safeParse(process.env.SEED_DEFAULT_PASSWORD);
  if (!password.success) {
    throw new Error(
      'SEED_DEFAULT_PASSWORD must be set (at least 12 characters). See .env.example.',
    );
  }
  const passwordHash = await hashPassword(password.data);

  for (const user of DEMO_USERS) {
    await prisma.user.upsert({
      where: { email: user.email },
      create: { ...user, passwordHash },
      update: { fullName: user.fullName, role: user.role, passwordHash, isActive: true },
    });
  }

  console.log(`Seeded ${DEMO_USERS.length} staff users:`);
  for (const user of DEMO_USERS) console.log(`  ${user.role.padEnd(18)} ${user.email}`);

  const admin = await prisma.user.findUniqueOrThrow({ where: { email: 'admin@deviceflow.test' } });
  const accounts = new Map<string, string>();
  for (const customer of DEMO_CUSTOMERS) {
    const existing = await prisma.customerAccount.findFirst({ where: { name: customer.name } });
    const account =
      existing ??
      (await prisma.customerAccount.create({
        data: {
          type: customer.type,
          name: customer.name,
          email: customer.email,
          phone: customer.phone,
          city: customer.city,
          region: 'Gauteng',
          contacts: { create: customer.contacts },
        },
      }));
    accounts.set(customer.key, account.id);
  }
  console.log(`Seeded ${DEMO_CUSTOMERS.length} customer accounts.`);

  const parktown = accounts.get('parktown')!;
  await prisma.user.upsert({
    where: { email: PORTAL_USER.email },
    create: { ...PORTAL_USER, role: 'CUSTOMER', customerAccountId: parktown, passwordHash },
    update: { fullName: PORTAL_USER.fullName, passwordHash, isActive: true },
  });
  console.log(`  CUSTOMER           ${PORTAL_USER.email} (portal user for Parktown Primary)`);

  let created = 0;
  for (const asset of DEMO_ASSETS) {
    const manufacturerKey = asset.manufacturer.toUpperCase();
    const serialNumber = normaliseSerial(asset.serial);
    const exists = await prisma.asset.findUnique({
      where: { manufacturerKey_serialNumber: { manufacturerKey, serialNumber } },
    });
    if (exists) continue;
    const customerAccountId = asset.customer ? accounts.get(asset.customer)! : null;
    await prisma.$transaction(async (tx) => {
      const row = await tx.asset.create({
        data: {
          category: asset.category,
          manufacturer: asset.manufacturer,
          manufacturerKey,
          model: asset.model,
          serialNumber,
          status: asset.status,
          customerAccountId,
          purchaseDate: new Date(`${asset.purchased}T00:00:00Z`),
          warrantyExpiresOn: new Date(`${asset.warrantyUntil}T00:00:00Z`),
          createdById: admin.id,
        },
      });
      await tx.assetEvent.create({
        data: {
          assetId: row.id,
          type: 'REGISTERED',
          toStatus: row.status,
          toCustomerAccountId: customerAccountId,
          actorUserId: admin.id,
          note: 'Demo seed',
        },
      });
    });
    created += 1;
  }
  console.log(`Seeded ${created} new assets (${DEMO_ASSETS.length - created} already present).`);

  await seedRepairs();
  await seedInventory();
}

const SEED_CTX = { requestId: 'demo-seed', ipAddress: null };

async function actor(email: string): Promise<Actor> {
  const u = await prisma.user.findUniqueOrThrow({ where: { email } });
  return {
    userId: u.id,
    role: u.role,
    email: u.email,
    fullName: u.fullName,
    customerAccountId: u.customerAccountId,
    sessionId: 'demo-seed',
  };
}

async function assetBySerial(manufacturer: string, serial: string): Promise<string> {
  const asset = await prisma.asset.findUniqueOrThrow({
    where: {
      manufacturerKey_serialNumber: {
        manufacturerKey: manufacturer.toUpperCase(),
        serialNumber: serial,
      },
    },
  });
  // Databases seeded before Phase 4 have a device marked IN_REPAIR by hand.
  if (asset.status === 'IN_REPAIR') {
    const admin = await prisma.user.findUniqueOrThrow({
      where: { email: 'admin@deviceflow.test' },
    });
    await prisma.$transaction([
      prisma.asset.update({ where: { id: asset.id }, data: { status: 'ACTIVE' } }),
      prisma.assetEvent.create({
        data: {
          assetId: asset.id,
          type: 'STATUS_CHANGED',
          fromStatus: 'IN_REPAIR',
          toStatus: 'ACTIVE',
          note: 'Demo seed: repairs are now tracked as repair jobs',
          actorUserId: admin.id,
        },
      }),
    ]);
  }
  return asset.id;
}

const today = () => new Date().toISOString().slice(0, 10);

const labourLine = (hours: number): QuoteLineInput => ({
  kind: 'LABOUR',
  description: 'Workshop labour',
  quantity: hours,
  unitPriceCents: 45_000,
});

/** Four repairs at different stages, so every screen has something to show. */
async function seedRepairs() {
  if ((await prisma.repairJob.count()) > 0) {
    console.log('Repair jobs already exist; demo repairs skipped.');
    return;
  }
  const admin = await actor('admin@deviceflow.test');
  const sipho = await actor('tech@deviceflow.test');
  const lerato = await actor('tech2@deviceflow.test');
  const portal = await actor(PORTAL_USER.email);
  const ipad = await assetBySerial('Apple', 'DMPXK7Q1');
  const chromebook = await assetBySerial('Lenovo', 'PF4K1A02');
  const latitude = await assetBySerial('Dell', '7XK29P3');
  const prodesk = await assetBySerial('HP', '8CC2381ZTQ');

  await prisma.$transaction(
    async (tx) => {
      const move = async (
        who: Actor,
        id: string,
        to: RepairStatus,
        completionSummary: string | null = null,
      ) => {
        const { version } = await tx.repairJob.findUniqueOrThrow({ where: { id } });
        await repairs.transitionRepair(
          tx,
          who,
          id,
          { to, version, note: null, completionSummary },
          SEED_CTX,
        );
      };
      const quote = async (who: Actor, id: string, lines: QuoteLineInput[]) => {
        const draft = await repairs.createQuote(
          tx,
          who,
          id,
          { lines, customerNote: 'Prices include a 90-day warranty on replaced parts.' },
          SEED_CTX,
        );
        return repairs.issueQuote(tx, who, id, draft.id, draft.version, SEED_CTX);
      };
      const book = (who: Actor, assetId: string, fault: string, technicianId?: string) =>
        repairs.createRepair(
          tx,
          who,
          { assetId, faultDescription: fault, technicianId },
          SEED_CTX,
          who.role === 'CUSTOMER'
            ? { source: 'PORTAL', ownAccountId: who.customerAccountId ?? undefined }
            : { source: 'STAFF' },
        );

      // 1. Parktown iPad: a quotation waiting for the customer (try approving it in the portal).
      const j1 = await book(
        admin,
        ipad,
        'Screen cracked after a fall; the bottom half does not respond to touch.',
        sipho.userId,
      );
      await move(sipho, j1.id, 'DIAGNOSING');
      await repairs.addNote(
        tx,
        sipho,
        j1.id,
        { type: 'DIAGNOSTIC', body: 'Digitiser cracked; LCD and board tested fine.' },
        SEED_CTX,
      );
      await repairs.addLabour(
        tx,
        sipho,
        j1.id,
        { minutes: 40, description: 'Diagnosis and testing', workDate: today() },
        SEED_CTX,
      );
      await quote(sipho, j1.id, [
        labourLine(1),
        {
          kind: 'PART',
          description: 'iPad (10th gen) digitiser assembly',
          quantity: 1,
          unitPriceCents: 289_900,
        },
      ]);
      await repairs.addNote(
        tx,
        sipho,
        j1.id,
        {
          type: 'CUSTOMER_VISIBLE',
          body: 'We found the fault. Your quotation is ready for approval.',
        },
        SEED_CTX,
      );

      // 2. Parktown Chromebook: requested in the portal, waiting to be assigned.
      await book(portal, chromebook, 'Several keys on the keyboard do not respond.');

      // 3. Mahlangu laptop: approved by phone on the customer's behalf, being repaired.
      const j3 = await book(
        admin,
        latitude,
        'Battery drains within an hour and the laptop gets hot.',
        lerato.userId,
      );
      await move(lerato, j3.id, 'DIAGNOSING');
      const q3 = await quote(lerato, j3.id, [
        labourLine(1.5),
        { kind: 'PART', description: 'Dell 54 Wh battery', quantity: 1, unitPriceCents: 115_000 },
      ]);
      await repairs.staffDecideQuote(
        tx,
        admin,
        j3.id,
        q3.id,
        {
          approve: true,
          version: q3.version,
          channel: 'PHONE',
          note: 'Kagiso Mahlangu approved by phone.',
        },
        SEED_CTX,
      );
      await move(lerato, j3.id, 'IN_REPAIR');
      await repairs.addLabour(
        tx,
        lerato,
        j3.id,
        { minutes: 60, description: 'Battery replacement', workDate: today() },
        SEED_CTX,
      );

      // 4. Mahlangu desktop: the whole lifecycle, closed.
      const j4 = await book(
        admin,
        prodesk,
        'Desktop does not start; the power light blinks.',
        sipho.userId,
      );
      await move(sipho, j4.id, 'DIAGNOSING');
      const q4 = await quote(sipho, j4.id, [
        labourLine(1),
        { kind: 'PART', description: '260 W power supply', quantity: 1, unitPriceCents: 98_000 },
      ]);
      await repairs.staffDecideQuote(
        tx,
        admin,
        j4.id,
        q4.id,
        {
          approve: true,
          version: q4.version,
          channel: 'EMAIL',
          note: 'Approved by email from the office manager.',
        },
        SEED_CTX,
      );
      await move(sipho, j4.id, 'IN_REPAIR');
      await repairs.addLabour(
        tx,
        sipho,
        j4.id,
        { minutes: 75, description: 'Power supply replaced and tested', workDate: today() },
        SEED_CTX,
      );
      await move(sipho, j4.id, 'QUALITY_CHECK');
      await move(
        sipho,
        j4.id,
        'COMPLETED',
        'Replaced the failed power supply. Ran a two-hour burn-in test.',
      );
      await move(admin, j4.id, 'CLOSED');
    },
    { timeout: 60_000 },
  );
  console.log('Seeded 4 demo repair jobs (awaiting approval, submitted, in repair, closed).');
}

const DEMO_PARTS: Array<
  Omit<CreatePartInput, 'description'> & { stock: number; unitCostCents: number; supplier: string }
> = [
  {
    sku: 'DELL-BAT-54WH',
    name: 'Dell 54 Wh battery (Latitude 5440)',
    category: 'BATTERY',
    location: 'A1-01',
    reorderLevel: 2,
    stock: 4,
    unitCostCents: 78_000,
    supplier: 'Rectron',
  },
  {
    sku: 'IPAD10-DIGI',
    name: 'iPad (10th gen) digitiser assembly',
    category: 'SCREEN',
    location: 'B2-03',
    reorderLevel: 2,
    stock: 1,
    unitCostCents: 185_000,
    supplier: 'Mobile Parts SA',
  },
  {
    sku: 'HP-PSU-260W',
    name: 'HP 260 W power supply',
    category: 'POWER',
    location: 'C1-02',
    reorderLevel: 1,
    stock: 3,
    unitCostCents: 62_000,
    supplier: 'Rectron',
  },
  {
    sku: 'LEN-300E-KB',
    name: 'Lenovo 300e keyboard (US layout)',
    category: 'KEYBOARD',
    location: 'A2-04',
    reorderLevel: 3,
    stock: 2,
    unitCostCents: 41_000,
    supplier: 'Lenovo Partner Hub',
  },
  {
    sku: 'SSD-NVME-512',
    name: '512 GB NVMe SSD (M.2 2280)',
    category: 'STORAGE',
    location: 'D1-01',
    reorderLevel: 4,
    stock: 10,
    unitCostCents: 69_500,
    supplier: 'Takealot Business',
  },
  {
    sku: 'DDR4-SO-8G',
    name: '8 GB DDR4 SO-DIMM 3200',
    category: 'MEMORY',
    location: 'D1-02',
    reorderLevel: 4,
    stock: 6,
    unitCostCents: 38_000,
    supplier: 'Takealot Business',
  },
  {
    sku: 'USBC-65W',
    name: '65 W USB-C charger',
    category: 'POWER',
    location: 'C2-01',
    reorderLevel: 3,
    stock: 0,
    unitCostCents: 0,
    supplier: '',
  },
  {
    sku: 'THERMAL-PASTE',
    name: 'Thermal paste, 4 g syringe',
    category: 'CONSUMABLE',
    location: 'E1-01',
    reorderLevel: 5,
    stock: 20,
    unitCostCents: 9_500,
    supplier: 'Communica',
  },
];

/**
 * Demo parts, received through the real inventory service so every unit in
 * stock has a ledger entry. The battery for the Dell laptop that is being
 * repaired is used on its job. Skipped when any parts already exist.
 */
async function seedInventory() {
  if ((await prisma.part.count()) > 0) {
    console.log('Parts already exist; demo inventory skipped.');
    return;
  }
  const manager = await actor('inventory@deviceflow.test');
  const lerato = await actor('tech2@deviceflow.test');
  await prisma.$transaction(
    async (tx) => {
      for (const { stock, unitCostCents, supplier, ...part } of DEMO_PARTS) {
        const created = await inventory.createPart(
          tx,
          manager,
          { ...part, description: null },
          SEED_CTX,
        );
        if (stock > 0) {
          await inventory.recordPurchase(
            tx,
            manager,
            created.id,
            { quantity: stock, unitCostCents, supplier, reference: 'Opening stock', note: null },
            SEED_CTX,
          );
        }
      }
      const battery = await tx.part.findUniqueOrThrow({ where: { sku: 'DELL-BAT-54WH' } });
      const job = await tx.repairJob.findFirst({
        where: {
          status: 'IN_REPAIR',
          assignedTechnicianId: lerato.userId,
          asset: { serialNumber: '7XK29P3' },
        },
      });
      if (job) {
        await inventory.useRepairPart(
          tx,
          lerato,
          job.id,
          { partId: battery.id, quantity: 1, note: 'Old battery swollen; replaced.' },
          SEED_CTX,
        );
      }
    },
    { timeout: 60_000 },
  );
  console.log(
    `Seeded ${DEMO_PARTS.length} parts (two at or below their reorder level, one out of stock).`,
  );
}

const DEMO_CUSTOMERS = [
  {
    key: 'parktown',
    type: 'ORGANISATION' as const,
    name: 'Parktown Primary School',
    email: 'admin@parktown-primary.example',
    phone: '011 555 0142',
    city: 'Johannesburg',
    contacts: [
      {
        fullName: 'Zanele Dube',
        jobTitle: 'Principal',
        email: 'principal@parktown-primary.example',
        isPrimary: true,
      },
      { fullName: 'Pieter Botha', jobTitle: 'IT coordinator', phone: '082 555 0199' },
    ],
  },
  {
    key: 'mahlangu',
    type: 'ORGANISATION' as const,
    name: 'Mahlangu & Partners Attorneys',
    email: 'office@mahlangu-law.example',
    phone: '012 555 0110',
    city: 'Pretoria',
    contacts: [{ fullName: 'Kagiso Mahlangu', jobTitle: 'Office manager', isPrimary: true }],
  },
  {
    key: 'nkosi',
    type: 'INDIVIDUAL' as const,
    name: 'Thandi Nkosi',
    email: 'thandi.nkosi@example.test',
    phone: '073 555 0123',
    city: 'Midrand',
    contacts: [],
  },
];

const PORTAL_USER = { email: 'portal@deviceflow.test', fullName: 'Zanele Dube' };

const DEMO_ASSETS: Array<{
  category: AssetCategory;
  manufacturer: string;
  model: string;
  serial: string;
  status: AssetStatus;
  customer: string | null;
  purchased: string;
  warrantyUntil: string;
}> = [
  {
    category: 'LAPTOP',
    manufacturer: 'Lenovo',
    model: '300e Chromebook Gen 4',
    serial: 'PF4K1A01',
    status: 'ACTIVE',
    customer: 'parktown',
    purchased: '2024-01-15',
    warrantyUntil: '2027-01-15',
  },
  {
    category: 'LAPTOP',
    manufacturer: 'Lenovo',
    model: '300e Chromebook Gen 4',
    serial: 'PF4K1A02',
    status: 'ACTIVE',
    customer: 'parktown',
    purchased: '2024-01-15',
    warrantyUntil: '2027-01-15',
  },
  {
    category: 'TABLET',
    manufacturer: 'Apple',
    model: 'iPad (10th generation)',
    serial: 'DMPXK7Q1',
    status: 'ACTIVE',
    customer: 'parktown',
    purchased: '2023-02-01',
    warrantyUntil: '2024-02-01',
  },
  {
    category: 'PRINTER',
    manufacturer: 'HP',
    model: 'LaserJet Pro M404dn',
    serial: 'VNB3K12345',
    status: 'ACTIVE',
    customer: 'parktown',
    purchased: '2022-06-20',
    warrantyUntil: '2025-06-20',
  },
  {
    category: 'LAPTOP',
    manufacturer: 'Dell',
    model: 'Latitude 5440',
    serial: '7XK29P3',
    status: 'ACTIVE',
    customer: 'mahlangu',
    purchased: '2025-03-03',
    warrantyUntil: '2028-03-03',
  },
  {
    category: 'DESKTOP',
    manufacturer: 'HP',
    model: 'ProDesk 400 G9',
    serial: '8CC2381ZTQ',
    status: 'ACTIVE',
    customer: 'mahlangu',
    purchased: '2023-09-12',
    warrantyUntil: '2026-09-12',
  },
  {
    category: 'PHONE',
    manufacturer: 'Samsung',
    model: 'Galaxy A55',
    serial: 'R58W30ABCDE',
    status: 'ACTIVE',
    customer: 'nkosi',
    purchased: '2025-07-01',
    warrantyUntil: '2027-07-01',
  },
  {
    category: 'LAPTOP',
    manufacturer: 'Dell',
    model: 'Latitude 3540',
    serial: 'GH2K8M3',
    status: 'IN_STOCK',
    customer: null,
    purchased: '2025-10-01',
    warrantyUntil: '2026-10-01',
  },
  {
    category: 'MONITOR',
    manufacturer: 'Dell',
    model: 'P2423D',
    serial: 'CN0J8K2V',
    status: 'REFURBISHING',
    customer: null,
    purchased: '2021-05-10',
    warrantyUntil: '2024-05-10',
  },
];

main()
  .catch((err: unknown) => {
    console.error(err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
