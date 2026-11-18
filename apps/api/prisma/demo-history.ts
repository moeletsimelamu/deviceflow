/**
 * Demo history: about five months of finished repair jobs and the stock movements
 * behind them, so the reports, the portal and the part ledgers look like a workshop
 * that has been running for a while. Development and demo data only (see seed.ts).
 *
 * Why these rows are written directly instead of through the services: the services
 * always stamp the current time, and the records they write (status history, notes,
 * issued quotations, the stock ledger, asset events) cannot be edited afterwards, by
 * design. So the history is inserted with its real dates instead, in date order, and
 * follows the same rules the services and the database enforce:
 *
 * - every status move is an allowed move from REPAIR_TRANSITIONS, recorded in order;
 * - quotations go DRAFT → ISSUED → APPROVED or REJECTED, with totals from the shared
 *   money functions and the company's VAT rate;
 * - each part used on a job is received first (a dated delivery at the same unit
 *   cost), so the stock ledger balances after every movement and the opening stock
 *   levels in seed.ts are unchanged at the end;
 * - devices go to IN_REPAIR when booked in and back to ACTIVE when the job closes,
 *   and end up ACTIVE.
 *
 * The audit log is left alone: it records real actions, and backfilling it would
 * defeat its purpose. The activity page therefore starts at the time of seeding.
 */
import {
  DECISION_CHANNEL_LABELS,
  lineTotalCents,
  quoteTotals,
  toHundredths,
  type DecisionChannel,
  type QuoteLineKind,
  type RepairStatus,
} from '@deviceflow/shared';
import type { Tx } from '../src/lib/prisma.js';

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const LABOUR_RATE_CENTS = 45_000;

/** The first demo job is booked in this many days before the seed runs. */
export const HISTORY_DAYS = 160;

interface Line {
  kind: QuoteLineKind;
  description: string;
  quantity: number;
  unitPriceCents: number;
  /** A stocked part used on the job when the repair starts. */
  sku?: string;
}

interface Template {
  fault: string;
  diagnosis: string;
  lines: Line[];
  summary: string;
}

const labour = (hours: number): Line => ({
  kind: 'LABOUR',
  description: 'Workshop labour',
  quantity: hours,
  unitPriceCents: LABOUR_RATE_CENTS,
});

const TEMPLATES = {
  printerJam: {
    fault: 'Paper jams on every second page and the prints are faded.',
    diagnosis: 'Paper path and fuser are dirty; the toner level is fine.',
    lines: [labour(1.5)],
    summary: 'Cleaned the paper path and the fuser and recalibrated. Printed 200 test pages.',
  },
  chromebookKeyboard: {
    fault: 'Several keys on the keyboard do not respond.',
    diagnosis: 'Liquid damage under the keyboard; the main board tested fine.',
    lines: [
      labour(1),
      {
        kind: 'PART',
        description: 'Lenovo 300e keyboard (US layout)',
        quantity: 1,
        unitPriceCents: 69_000,
        sku: 'LEN-300E-KB',
      },
    ],
    summary: 'Replaced the keyboard and tested every key.',
  },
  chromebookHinge: {
    fault: 'The screen hinge is loose and the lid will not stay open.',
    diagnosis: 'Both hinges and the bezel are cracked; the whole lid assembly must be replaced.',
    lines: [
      labour(1.5),
      {
        kind: 'PART',
        description: 'Lenovo 300e lid assembly (special order)',
        quantity: 1,
        unitPriceCents: 145_000,
      },
    ],
    summary: '',
  },
  failingDrive: {
    fault: 'Very slow to start, and some files will not open.',
    diagnosis: 'The hard drive reports reallocated sectors and is failing.',
    lines: [
      labour(2),
      {
        kind: 'PART',
        description: '512 GB NVMe SSD (M.2 2280)',
        quantity: 1,
        unitPriceCents: 109_500,
        sku: 'SSD-NVME-512',
      },
    ],
    summary: 'Replaced the drive with a 512 GB SSD, reinstalled Windows and restored the files.',
  },
  powerSupply: {
    fault: 'The desktop switches itself off a few minutes after starting.',
    diagnosis: 'The power supply output drops under load.',
    lines: [
      labour(1),
      {
        kind: 'PART',
        description: 'HP 260 W power supply',
        quantity: 1,
        unitPriceCents: 98_000,
        sku: 'HP-PSU-260W',
      },
    ],
    summary: 'Replaced the power supply and ran a two-hour burn-in test.',
  },
  overheating: {
    fault: 'The fan is loud and the computer shuts down when it is busy.',
    diagnosis: 'Heatsink clogged with dust; the thermal paste has dried out.',
    lines: [
      labour(1),
      {
        kind: 'PART',
        description: 'Thermal paste, 4 g syringe',
        quantity: 1,
        unitPriceCents: 15_000,
        sku: 'THERMAL-PASTE',
      },
    ],
    summary: 'Cleaned the fan and heatsink and replaced the thermal paste. Normal under load.',
  },
  memory: {
    fault: 'Freezes when several programs are open.',
    diagnosis: 'Only 8 GB of memory installed, and it is full in normal use.',
    lines: [
      labour(0.5),
      {
        kind: 'PART',
        description: '8 GB DDR4 SO-DIMM 3200',
        quantity: 1,
        unitPriceCents: 62_000,
        sku: 'DDR4-SO-8G',
      },
    ],
    summary: 'Added an 8 GB memory module (16 GB in total) and ran a memory test.',
  },
  battery: {
    fault: 'The battery lasts less than an hour.',
    diagnosis: 'Battery capacity is down to 41% of its design capacity.',
    lines: [
      labour(1),
      {
        kind: 'PART',
        description: 'Dell 54 Wh battery',
        quantity: 1,
        unitPriceCents: 115_000,
        sku: 'DELL-BAT-54WH',
      },
    ],
    summary: 'Replaced the battery and tested a full charge cycle.',
  },
  ipadScreen: {
    fault: 'Cracked screen; touch does not work along the bottom edge.',
    diagnosis: 'Digitiser cracked; the LCD and the board tested fine.',
    lines: [
      labour(1),
      {
        kind: 'PART',
        description: 'iPad (10th gen) digitiser assembly',
        quantity: 1,
        unitPriceCents: 289_900,
        sku: 'IPAD10-DIGI',
      },
    ],
    summary: 'Replaced the digitiser assembly and tested touch across the whole screen.',
  },
  phoneCharging: {
    fault: 'Charges only when the cable is held at an angle.',
    diagnosis: 'Lint packed into the charging port; the port itself is undamaged.',
    lines: [labour(0.5)],
    summary: 'Cleaned the charging port. Charges normally with the original cable.',
  },
  phoneSoftware: {
    fault: 'Restarts by itself several times a day.',
    diagnosis: 'A failed system update; the hardware tests all pass.',
    lines: [labour(1)],
    summary: 'Backed up the phone, reinstalled the firmware and restored the data.',
  },
} satisfies Record<string, Template>;

type TemplateKey = keyof typeof TEMPLATES;
type Tech = 'sipho' | 'lerato';

interface JobSpec {
  /** Booked in this many days before the seed runs. */
  daysAgo: number;
  /** Serial number of the device (seed.ts DEMO_ASSETS). */
  serial: string;
  template: TemplateKey;
  tech: Tech;
  /** Days from booking in to completion (turnaround). */
  days: number;
  /** Requested by the customer in the portal (Parktown only). */
  portal?: boolean;
  /** The customer declines the quotation and the device goes back unrepaired. */
  rejected?: boolean;
}

/** Oldest first. A device never has two jobs open at once. */
const JOBS: JobSpec[] = [
  { daysAgo: 158, serial: 'VNB3K12345', template: 'printerJam', tech: 'sipho', days: 2 },
  {
    daysAgo: 151,
    serial: 'PF4K1A01',
    template: 'chromebookKeyboard',
    tech: 'lerato',
    days: 4,
    portal: true,
  },
  { daysAgo: 146, serial: '8CC2381ZTQ', template: 'failingDrive', tech: 'sipho', days: 3 },
  { daysAgo: 139, serial: 'R58W30ABCDE', template: 'phoneCharging', tech: 'lerato', days: 2 },
  {
    daysAgo: 133,
    serial: 'DMPXK7Q1',
    template: 'ipadScreen',
    tech: 'sipho',
    days: 6,
    portal: true,
  },
  { daysAgo: 127, serial: '7XK29P3', template: 'overheating', tech: 'lerato', days: 2 },
  {
    daysAgo: 120,
    serial: 'PF4K1A02',
    template: 'chromebookKeyboard',
    tech: 'sipho',
    days: 5,
    portal: true,
  },
  { daysAgo: 113, serial: '8CC2381ZTQ', template: 'powerSupply', tech: 'lerato', days: 4 },
  { daysAgo: 106, serial: 'VNB3K12345', template: 'printerJam', tech: 'sipho', days: 1 },
  { daysAgo: 99, serial: '7XK29P3', template: 'memory', tech: 'lerato', days: 3 },
  {
    daysAgo: 93,
    serial: 'PF4K1A01',
    template: 'chromebookHinge',
    tech: 'sipho',
    days: 3,
    portal: true,
    rejected: true,
  },
  { daysAgo: 86, serial: 'R58W30ABCDE', template: 'phoneSoftware', tech: 'lerato', days: 1 },
  {
    daysAgo: 78,
    serial: 'DMPXK7Q1',
    template: 'ipadScreen',
    tech: 'lerato',
    days: 7,
    portal: true,
  },
  { daysAgo: 71, serial: '8CC2381ZTQ', template: 'overheating', tech: 'sipho', days: 2 },
  { daysAgo: 63, serial: '7XK29P3', template: 'battery', tech: 'sipho', days: 4 },
  {
    daysAgo: 56,
    serial: 'PF4K1A02',
    template: 'chromebookKeyboard',
    tech: 'lerato',
    days: 3,
    portal: true,
  },
  {
    daysAgo: 48,
    serial: 'VNB3K12345',
    template: 'printerJam',
    tech: 'lerato',
    days: 2,
    portal: true,
  },
  { daysAgo: 41, serial: '8CC2381ZTQ', template: 'failingDrive', tech: 'sipho', days: 5 },
  {
    daysAgo: 33,
    serial: 'PF4K1A01',
    template: 'chromebookKeyboard',
    tech: 'sipho',
    days: 2,
    portal: true,
  },
  { daysAgo: 26, serial: 'R58W30ABCDE', template: 'phoneCharging', tech: 'lerato', days: 3 },
  { daysAgo: 19, serial: '7XK29P3', template: 'memory', tech: 'lerato', days: 2 },
  {
    daysAgo: 12,
    serial: 'DMPXK7Q1',
    template: 'ipadScreen',
    tech: 'sipho',
    days: 5,
    portal: true,
  },
  { daysAgo: 8, serial: '8CC2381ZTQ', template: 'powerSupply', tech: 'lerato', days: 3 },
  {
    daysAgo: 5,
    serial: 'PF4K1A01',
    template: 'chromebookKeyboard',
    tech: 'sipho',
    days: 2,
    portal: true,
  },
];

/** How a customer who is not on the portal approved, recorded by the administrator. */
const STAFF_DECISIONS: Record<string, { channel: DecisionChannel; note: string }> = {
  'Mahlangu & Partners Attorneys': {
    channel: 'EMAIL',
    note: 'Approved by email from the office manager.',
  },
  'Thandi Nkosi': { channel: 'PHONE', note: 'Thandi Nkosi approved by phone.' },
  'Parktown Primary School': { channel: 'PHONE', note: 'Pieter Botha approved by phone.' },
};

export interface HistoryPeople {
  admin: string;
  sipho: string;
  lerato: string;
  inventoryManager: string;
  portal: string;
}

export interface HistoryAsset {
  id: string;
  customerAccountId: string;
  customerName: string;
}

export interface HistoryPart {
  id: string;
  unitCostCents: number;
  supplier: string;
}

/** A dated time: `daysAgo` days before `now`, at `hour` o'clock South African time. */
export function sastTime(now: Date, daysAgo: number, hour: number): Date {
  const d = new Date(now.getTime() - daysAgo * DAY);
  const whole = Math.floor(hour);
  d.setUTCHours(whole - 2, Math.round((hour - whole) * 60), 0, 0);
  return d;
}

/**
 * Writes one stock movement at a given time and moves the part's stock with it,
 * using the same weighted-average formula as inventory.service.ts (purchases change
 * the average cost; everything else moves stock at the current average).
 */
export async function datedMovement(
  tx: Tx,
  movement: {
    partId: string;
    type: 'PURCHASE' | 'REPAIR_CONSUMPTION';
    quantity: number;
    unitCostCents?: number;
    supplier?: string | null;
    reference?: string | null;
    note?: string | null;
    repairJobId?: string | null;
    actorUserId: string;
    at: Date;
  },
): Promise<void> {
  const part = await tx.part.findUniqueOrThrow({ where: { id: movement.partId } });
  const receiving = movement.type === 'PURCHASE';
  const change = receiving ? movement.quantity : -movement.quantity;
  const balance = part.quantityOnHand + change;
  if (balance < 0) throw new Error(`Demo history would take ${part.sku} below zero`);
  const cost = receiving ? movement.unitCostCents! : part.averageCostCents;
  const average = receiving
    ? Number(
        (2n *
          (BigInt(part.quantityOnHand) * BigInt(part.averageCostCents) +
            BigInt(movement.quantity) * BigInt(cost)) +
          BigInt(balance)) /
          (2n * BigInt(balance)),
      )
    : part.averageCostCents;
  await tx.part.update({
    where: { id: part.id },
    data: { quantityOnHand: balance, averageCostCents: average, updatedAt: movement.at },
  });
  await tx.stockMovement.create({
    data: {
      partId: part.id,
      type: movement.type,
      quantityChange: change,
      balanceAfter: balance,
      unitCostCents: cost,
      supplier: movement.supplier ?? null,
      reference: movement.reference ?? null,
      note: movement.note ?? null,
      repairJobId: movement.repairJobId ?? null,
      actorUserId: movement.actorUserId,
      createdAt: movement.at,
    },
  });
}

/** Creates the finished demo jobs, oldest first. Returns how many were written. */
export async function seedDemoHistory(
  tx: Tx,
  input: {
    now: Date;
    people: HistoryPeople;
    assets: Map<string, HistoryAsset>;
    parts: Map<string, HistoryPart>;
  },
): Promise<number> {
  const { now, people, assets, parts } = input;
  const settings = await tx.companySettings.findUniqueOrThrow({ where: { id: 1 } });
  const vatRate = settings.vatRateBasisPoints;
  let order = 0;

  for (const [index, spec] of JOBS.entries()) {
    const template: Template = TEMPLATES[spec.template];
    const asset = assets.get(spec.serial);
    if (!asset) throw new Error(`Demo history: no asset with serial ${spec.serial}`);
    const tech = people[spec.tech];

    // The job's timeline, in hours after booking in (08:00 to 11:00, by job).
    const booked = sastTime(now, spec.daysAgo, 8 + (index % 4));
    const at = (hours: number) => new Date(booked.getTime() + hours * HOUR);
    const completedHour = Math.max(28, spec.days * 24 + 6);
    const decided = at(22);
    const repairStarted = at(24);
    const completed = at(completedHour);
    const finished = spec.rejected ? at(3 * 24) : at(completedHour + 18);

    // Parts are delivered two days before the job is booked in.
    const used = template.lines.filter((line) => line.sku);
    for (const line of used) {
      const part = parts.get(line.sku!);
      if (!part || spec.rejected) continue;
      order += 1;
      await datedMovement(tx, {
        partId: part.id,
        type: 'PURCHASE',
        quantity: line.quantity,
        unitCostCents: part.unitCostCents,
        supplier: part.supplier,
        reference: `PO-${String(2400 + order)}`,
        actorUserId: people.inventoryManager,
        at: sastTime(now, spec.daysAgo + 2, 10),
      });
    }

    const submittedBy = spec.portal ? people.portal : people.admin;
    const finalStatus: RepairStatus = spec.rejected ? 'RETURNED_UNREPAIRED' : 'CLOSED';
    const job = await tx.repairJob.create({
      data: {
        assetId: asset.id,
        customerAccountId: asset.customerAccountId,
        status: finalStatus,
        source: spec.portal ? 'PORTAL' : 'STAFF',
        faultDescription: template.fault,
        assignedTechnicianId: tech,
        submittedById: submittedBy,
        completionSummary: spec.rejected ? null : template.summary,
        completedAt: spec.rejected ? null : completed,
        closedAt: finished,
        version: spec.rejected ? 6 : 9,
        createdAt: booked,
        updatedAt: finished,
      },
      select: { id: true, reference: true },
    });

    const history: Array<{
      from: RepairStatus | null;
      to: RepairStatus;
      by: string;
      at: Date;
      note?: string;
    }> = [];
    const move = (
      from: RepairStatus | null,
      to: RepairStatus,
      by: string,
      when: Date,
      note?: string,
    ) => history.push({ from, to, by, at: when, note });

    move(null, 'SUBMITTED', submittedBy, booked);
    move('SUBMITTED', 'ASSIGNED', people.admin, at(0.25));
    move('ASSIGNED', 'DIAGNOSING', tech, at(1.5));
    move('DIAGNOSING', 'AWAITING_APPROVAL', tech, at(3), 'Quotation revision 1 issued');

    // The decision: in the portal for the school's portal requests, otherwise
    // recorded by the administrator from a phone call or an email.
    const staffDecision = STAFF_DECISIONS[asset.customerName]!;
    const channel: DecisionChannel = spec.portal ? 'PORTAL' : staffDecision.channel;
    const decisionNote = spec.rejected
      ? 'We will replace this device instead.'
      : spec.portal
        ? null
        : staffDecision.note;
    const verb = spec.rejected ? 'Rejected' : 'Approved';
    const historyNote = spec.portal
      ? `${verb} by the customer in the portal${decisionNote ? `: ${decisionNote}` : ''}`
      : `${verb} on behalf of the customer (${DECISION_CHANNEL_LABELS[channel]}): ${decisionNote}`;
    const decider = spec.portal ? people.portal : people.admin;

    if (spec.rejected) {
      move('AWAITING_APPROVAL', 'QUOTE_REJECTED', decider, decided, historyNote);
      move('QUOTE_REJECTED', 'RETURNED_UNREPAIRED', people.admin, finished);
    } else {
      move('AWAITING_APPROVAL', 'APPROVED', decider, decided, historyNote);
      move('APPROVED', 'IN_REPAIR', tech, repairStarted);
      move('IN_REPAIR', 'QUALITY_CHECK', tech, at(completedHour - 1));
      move('QUALITY_CHECK', 'COMPLETED', tech, completed);
      move('COMPLETED', 'CLOSED', people.admin, finished);
    }
    for (const h of history) {
      await tx.repairStatusHistory.create({
        data: {
          repairJobId: job.id,
          fromStatus: h.from,
          toStatus: h.to,
          note: h.note ?? null,
          actorUserId: h.by,
          createdAt: h.at,
        },
      });
    }

    // The device is in repair from booking in until the job is finished.
    await tx.assetEvent.create({
      data: {
        assetId: asset.id,
        type: 'STATUS_CHANGED',
        fromStatus: 'ACTIVE',
        toStatus: 'IN_REPAIR',
        note: `Booked in for repair ${job.reference}`,
        actorUserId: submittedBy,
        repairJobId: job.id,
        createdAt: booked,
      },
    });

    await tx.repairNote.create({
      data: {
        repairJobId: job.id,
        type: 'DIAGNOSTIC',
        body: template.diagnosis,
        authorId: tech,
        createdAt: at(2.5),
      },
    });
    await tx.labourEntry.create({
      data: {
        repairJobId: job.id,
        userId: tech,
        minutes: 30,
        description: 'Diagnosis and testing',
        workDate: new Date(`${booked.toISOString().slice(0, 10)}T00:00:00Z`),
        createdAt: at(2.5),
      },
    });

    // The quotation: a draft with its lines, then issued, then decided.
    const lines = template.lines.map((line, i) => {
      const quantityHundredths = toHundredths(line.quantity);
      return {
        position: i + 1,
        kind: line.kind,
        description: line.description,
        quantityHundredths,
        unitPriceCents: line.unitPriceCents,
        lineTotalCents: lineTotalCents(quantityHundredths, line.unitPriceCents),
      };
    });
    const totals = quoteTotals(lines, vatRate);
    const quote = await tx.quotation.create({
      data: {
        repairJobId: job.id,
        revision: 1,
        currency: settings.currency,
        vatRateBasisPoints: vatRate,
        customerNote: 'Prices include a 90-day warranty on replaced parts.',
        createdById: tech,
        createdAt: at(2.75),
        updatedAt: at(2.75),
        lines: { create: lines },
      },
    });
    await tx.quotation.update({
      where: { id: quote.id },
      data: {
        status: 'ISSUED',
        ...totals,
        issuedById: tech,
        issuedAt: at(3),
        version: 1,
        updatedAt: at(3),
      },
    });
    await tx.quotation.update({
      where: { id: quote.id },
      data: {
        status: spec.rejected ? 'REJECTED' : 'APPROVED',
        decidedById: decider,
        decidedAt: decided,
        decisionChannel: channel,
        decisionNote,
        approvedTotalCents: spec.rejected ? null : totals.totalCents,
        version: 2,
        updatedAt: decided,
      },
    });
    await tx.repairNote.create({
      data: {
        repairJobId: job.id,
        type: 'CUSTOMER_VISIBLE',
        body: 'We found the fault. Your quotation is ready for approval.',
        authorId: tech,
        createdAt: at(3),
      },
    });

    if (!spec.rejected) {
      for (const line of used) {
        const part = parts.get(line.sku!);
        if (!part) continue;
        await datedMovement(tx, {
          partId: part.id,
          type: 'REPAIR_CONSUMPTION',
          quantity: line.quantity,
          repairJobId: job.id,
          actorUserId: tech,
          at: repairStarted,
        });
      }
      const hours = template.lines
        .filter((line) => line.kind === 'LABOUR')
        .reduce((sum, line) => sum + line.quantity, 0);
      await tx.labourEntry.create({
        data: {
          repairJobId: job.id,
          userId: tech,
          minutes: Math.max(15, Math.round(hours * 60) - 30),
          description: 'Repair and testing',
          workDate: new Date(`${completed.toISOString().slice(0, 10)}T00:00:00Z`),
          createdAt: completed,
        },
      });
    }

    await tx.assetEvent.create({
      data: {
        assetId: asset.id,
        type: 'STATUS_CHANGED',
        fromStatus: 'IN_REPAIR',
        toStatus: 'ACTIVE',
        note: `Repair ${job.reference} ${spec.rejected ? 'returned unrepaired' : 'closed: device handed back'}`,
        actorUserId: people.admin,
        repairJobId: job.id,
        createdAt: finished,
      },
    });
  }
  return JOBS.length;
}
