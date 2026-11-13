import { beforeAll, describe, expect, it } from 'vitest';
import {
  findRepairRule,
  isRepairOpen,
  QUOTE_STATUSES,
  REPAIR_STATUSES,
  REPAIR_TRANSITIONS,
  TECHNICIAN_CHANGE_STATUSES,
  type RepairStatus,
} from '@deviceflow/shared';
import { prisma } from '../../src/lib/prisma.js';
import {
  createCustomerAccount,
  createQuote,
  createRepairJob,
  loginAs,
  resetDatabase,
} from '../helpers/db.js';

/*
 * Phase 4 exit criterion: every valid and every invalid transition is covered.
 * All 13 x 13 status pairs go through the generic endpoint; the moves that
 * happen through domain actions (assign, issue, approve) are checked from every
 * status as well.
 */

type Client = Awaited<ReturnType<typeof loginAs>>;
let admin: Client;
let tech: Client;
let otherTech: Client;
let inventory: Client;
let customer: Client;
let accountId: string;

beforeAll(async () => {
  await resetDatabase();
  admin = await loginAs('ADMIN');
  tech = await loginAs('TECHNICIAN');
  otherTech = await loginAs('TECHNICIAN');
  inventory = await loginAs('INVENTORY_MANAGER');
  const account = await createCustomerAccount();
  accountId = account.id;
  customer = await loginAs('CUSTOMER', { customerAccountId: account.id });
});

/** A job in `status`, assigned to `tech` (except SUBMITTED/CANCELLED), with one labour entry. */
function jobAt(status: RepairStatus, options: { labour?: boolean } = {}) {
  const unassigned = status === 'SUBMITTED' || status === 'CANCELLED';
  return createRepairJob({
    createdById: admin.user.id,
    customerAccountId: accountId,
    status,
    technicianId: unassigned ? null : tech.user.id,
    labour: options.labour ?? !unassigned,
  });
}

const FULL_BODY = { note: 'Recorded for the test', completionSummary: 'Replaced the cable' };

async function statusOf(id: string) {
  return prisma.repairJob.findUniqueOrThrow({
    where: { id },
    select: { status: true, version: true },
  });
}

const GENERIC_VIAS = new Set(['transition', 'cancel']);
const PAIRS = REPAIR_STATUSES.flatMap((from) => REPAIR_STATUSES.map((to) => ({ from, to })));

describe('POST /repairs/:id/transitions — all 169 status pairs', () => {
  it.each(PAIRS)('$from -> $to', async ({ from, to }) => {
    const job = await jobAt(from);
    const rule = findRepairRule(from, to);
    const valid = !!rule && GENERIC_VIAS.has(rule.via);
    // Use an actor the rule allows; for moves that are not allowed, an administrator.
    const as = valid && !rule.actors.includes('ADMIN') ? tech : admin;

    const res = await as
      .post(`/api/v1/repairs/${job.id}/transitions`)
      .send({ to, ...FULL_BODY, version: 0 });

    if (valid) {
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      expect(res.body.data).toMatchObject({ status: to, version: 1 });
      const history = await prisma.repairStatusHistory.findFirst({
        where: { repairJobId: job.id, fromStatus: from, toStatus: to },
      });
      expect(history?.note).toBe(FULL_BODY.note);
      const audit = await prisma.auditLog.count({
        where: {
          repairJobId: job.id,
          action: to === 'CANCELLED' ? 'repair.cancelled' : 'repair.status_changed',
        },
      });
      expect(audit).toBe(1);
      const asset = await prisma.asset.findUniqueOrThrow({ where: { id: job.assetId } });
      expect(asset.status).toBe(isRepairOpen(to) ? 'IN_REPAIR' : 'ACTIVE');
    } else {
      expect(res.status, JSON.stringify(res.body)).toBe(422);
      expect(res.body.error.code).toBe('INVALID_TRANSITION');
      expect(await statusOf(job.id)).toEqual({ status: from, version: 0 });
    }
  });
});

describe('who may make each move', () => {
  const rules = REPAIR_TRANSITIONS.filter((r) => GENERIC_VIAS.has(r.via));

  it.each(rules)('$from -> $to is refused for everyone else', async (rule) => {
    const job = await jobAt(rule.from);
    const send = (c: Client) =>
      c
        .post(`/api/v1/repairs/${job.id}/transitions`)
        .send({ to: rule.to, ...FULL_BODY, version: 0 });

    if (!rule.actors.includes('ADMIN')) {
      const res = await send(admin);
      expect(res.status).toBe(403);
      expect(res.body.error.message).toMatch(/assigned technician/);
    }
    if (!rule.actors.includes('ASSIGNED_TECHNICIAN')) {
      // A SUBMITTED job has no technician yet, so it is outside every technician's scope.
      expect((await send(tech)).status).toBe(rule.from === 'SUBMITTED' ? 404 : 403);
    }
    // Another technician cannot even see the job.
    expect((await send(otherTech)).status).toBe(404);
    // Inventory managers (read-only on repairs) and customers cannot change staff repairs.
    expect((await send(inventory)).status).toBe(403);
    expect((await send(customer)).status).toBe(403);

    expect(await statusOf(job.id)).toEqual({ status: rule.from, version: 0 });
  });
});

describe('move requirements', () => {
  it('needs a reason to wait for parts, to resume, to fail quality check and to cancel', async () => {
    for (const [from, to] of [
      ['IN_REPAIR', 'AWAITING_PARTS'],
      ['AWAITING_PARTS', 'IN_REPAIR'],
      ['QUALITY_CHECK', 'IN_REPAIR'],
      ['DIAGNOSING', 'CANCELLED'],
    ] as const) {
      const job = await jobAt(from);
      const as = findRepairRule(from, to)!.actors.includes('ADMIN') ? admin : tech;
      const res = await as.post(`/api/v1/repairs/${job.id}/transitions`).send({ to, version: 0 });
      expect(res.status, `${from}->${to}`).toBe(422);
      expect(res.body.error.details).toEqual([{ path: 'note', message: expect.any(String) }]);
    }
  });

  it('needs a completion summary to complete', async () => {
    const job = await jobAt('QUALITY_CHECK');
    const res = await tech
      .post(`/api/v1/repairs/${job.id}/transitions`)
      .send({ to: 'COMPLETED', version: 0 });
    expect(res.status).toBe(422);
    expect(res.body.error.details[0].path).toBe('completionSummary');

    const ok = await tech
      .post(`/api/v1/repairs/${job.id}/transitions`)
      .send({ to: 'COMPLETED', completionSummary: 'Replaced the hinge', version: 0 });
    expect(ok.status).toBe(200);
    expect(ok.body.data.completionSummary).toBe('Replaced the hinge');
    expect(ok.body.data.completedAt).not.toBeNull();
  });

  it('needs recorded labour before quality check', async () => {
    const job = await jobAt('IN_REPAIR', { labour: false });
    const res = await tech
      .post(`/api/v1/repairs/${job.id}/transitions`)
      .send({ to: 'QUALITY_CHECK', version: 0 });
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('LABOUR_REQUIRED');
    expect((await statusOf(job.id)).status).toBe('IN_REPAIR');
  });

  it('refuses a stale version with 409 and changes nothing', async () => {
    const job = await jobAt('ASSIGNED');
    const res = await tech
      .post(`/api/v1/repairs/${job.id}/transitions`)
      .send({ to: 'DIAGNOSING', version: 3 });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('CONFLICT');
    expect(await statusOf(job.id)).toEqual({ status: 'ASSIGNED', version: 0 });
  });

  it('lets only one of two simultaneous moves from the same version succeed', async () => {
    const job = await jobAt('IN_REPAIR');
    const results = await Promise.all([
      tech
        .post(`/api/v1/repairs/${job.id}/transitions`)
        .send({ to: 'AWAITING_PARTS', note: 'Need a battery', version: 0 }),
      tech.post(`/api/v1/repairs/${job.id}/transitions`).send({ to: 'QUALITY_CHECK', version: 0 }),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
    expect(await prisma.repairStatusHistory.count({ where: { repairJobId: job.id } })).toBe(2);
  });
});

describe('moves made through domain actions, from every status', () => {
  it.each(REPAIR_STATUSES)('assigning a technician from %s', async (from) => {
    const job = await jobAt(from);
    const res = await admin
      .post(`/api/v1/repairs/${job.id}/assign`)
      .send({ technicianId: otherTech.user.id, version: 0 });
    if (TECHNICIAN_CHANGE_STATUSES.includes(from)) {
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      expect(res.body.data.status).toBe(from === 'SUBMITTED' ? 'ASSIGNED' : from);
      expect(res.body.data.technician.id).toBe(otherTech.user.id);
    } else {
      expect(res.status).toBe(422);
      expect(res.body.error.code).toBe('INVALID_TRANSITION');
      expect(await statusOf(job.id)).toEqual({ status: from, version: 0 });
    }
  });

  it.each(REPAIR_STATUSES)('issuing a quotation from %s', async (from) => {
    const job = await jobAt(from);
    const draft = await createQuote(job.id, admin.user.id);
    const res = await admin
      .post(`/api/v1/repairs/${job.id}/quotes/${draft.id}/issue`)
      .send({ version: 0 });
    if (QUOTE_STATUSES.includes(from)) {
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      expect((await statusOf(job.id)).status).toBe('AWAITING_APPROVAL');
    } else {
      expect(res.status).toBe(422);
      expect(res.body.error.code).toBe('INVALID_TRANSITION');
      expect((await statusOf(job.id)).status).toBe(from);
    }
  });

  it.each(REPAIR_STATUSES)('approving the issued quotation from %s', async (from) => {
    const job = await jobAt(from);
    const quote = await createQuote(job.id, admin.user.id, { issue: true });
    const res = await admin
      .post(`/api/v1/repairs/${job.id}/quotes/${quote.id}/approve`)
      .send({ version: quote.version, channel: 'PHONE', note: 'Principal approved by phone' });
    if (from === 'AWAITING_APPROVAL') {
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      expect((await statusOf(job.id)).status).toBe('APPROVED');
    } else {
      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe('QUOTE_NOT_ISSUED');
      expect((await statusOf(job.id)).status).toBe(from);
    }
  });

  it('rejecting the issued quotation moves the job to QUOTE_REJECTED', async () => {
    const job = await jobAt('AWAITING_APPROVAL');
    const quote = await createQuote(job.id, admin.user.id, { issue: true });
    const res = await admin
      .post(`/api/v1/repairs/${job.id}/quotes/${quote.id}/reject`)
      .send({ version: quote.version, channel: 'EMAIL', note: 'Too expensive, will replace' });
    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe('REJECTED');
    expect((await statusOf(job.id)).status).toBe('QUOTE_REJECTED');
  });
});

describe('the device follows its repair job', () => {
  it.each(['CLOSED', 'RETURNED_UNREPAIRED', 'CANCELLED'] as const)(
    'returns to ACTIVE when the job ends as %s, with a history entry',
    async (to) => {
      const from =
        to === 'CLOSED' ? 'COMPLETED' : to === 'CANCELLED' ? 'SUBMITTED' : 'QUOTE_REJECTED';
      const job = await jobAt(from);
      const res = await admin
        .post(`/api/v1/repairs/${job.id}/transitions`)
        .send({ to, note: 'Done', version: 0 });
      expect(res.status).toBe(200);
      expect(res.body.data.closedAt).not.toBeNull();
      const event = await prisma.assetEvent.findFirst({
        where: { assetId: job.assetId, repairJobId: job.id },
      });
      expect(event).toMatchObject({ fromStatus: 'IN_REPAIR', toStatus: 'ACTIVE' });
    },
  );

  it('withdraws the issued quotation when a job is cancelled', async () => {
    const job = await jobAt('AWAITING_APPROVAL');
    const quote = await createQuote(job.id, admin.user.id, { issue: true });
    const res = await admin
      .post(`/api/v1/repairs/${job.id}/transitions`)
      .send({ to: 'CANCELLED', note: 'Customer bought a new device', version: 0 });
    expect(res.status).toBe(200);
    const after = await prisma.quotation.findUniqueOrThrow({ where: { id: quote.id } });
    expect(after.status).toBe('WITHDRAWN');
  });
});
