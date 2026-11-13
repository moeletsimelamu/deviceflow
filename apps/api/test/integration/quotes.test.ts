import { beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '../../src/lib/prisma.js';
import {
  createCustomerAccount,
  createQuote,
  createRepairJob,
  loginAs,
  resetDatabase,
} from '../helpers/db.js';

beforeEach(resetDatabase);

async function setup(status: 'DIAGNOSING' | 'AWAITING_APPROVAL' = 'DIAGNOSING') {
  const admin = await loginAs('ADMIN');
  const tech = await loginAs('TECHNICIAN');
  const account = await createCustomerAccount();
  const customer = await loginAs('CUSTOMER', { customerAccountId: account.id });
  const job = await createRepairJob({
    createdById: admin.user.id,
    customerAccountId: account.id,
    status,
    technicianId: tech.user.id,
  });
  return { admin, tech, account, customer, job };
}

const LINES = [
  { kind: 'LABOUR', description: 'Replace screen', quantity: 1.5, unitPriceCents: 45_000 },
  { kind: 'PART', description: 'Screen assembly', quantity: 1, unitPriceCents: 129_999 },
];

describe('draft quotations', () => {
  it('prices lines in cents with VAT on the subtotal, rounded half-up', async () => {
    const { tech, job } = await setup();
    const res = await tech
      .post(`/api/v1/repairs/${job.id}/quotes`)
      .send({ lines: LINES, customerNote: 'Valid for 14 days' });
    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({
      revision: 1,
      status: 'DRAFT',
      currency: 'ZAR',
      vatRateBasisPoints: 1500,
      subtotalCents: 197_499,
      vatCents: 29_625,
      totalCents: 227_124,
      lines: [
        { position: 1, quantity: 1.5, unitPriceCents: 45_000, lineTotalCents: 67_500 },
        { position: 2, quantity: 1, unitPriceCents: 129_999, lineTotalCents: 129_999 },
      ],
    });
  });

  it('allows one draft at a time, edits it with versioning and discards it', async () => {
    const { tech, job } = await setup();
    const draft = (await tech.post(`/api/v1/repairs/${job.id}/quotes`).send({ lines: LINES })).body
      .data;
    const second = await tech.post(`/api/v1/repairs/${job.id}/quotes`).send({ lines: [] });
    expect(second.status).toBe(409);

    const edited = await tech
      .patch(`/api/v1/repairs/${job.id}/quotes/${draft.id}`)
      .send({ lines: [LINES[0]], version: 0 });
    expect(edited.status).toBe(200);
    expect(edited.body.data).toMatchObject({
      subtotalCents: 67_500,
      totalCents: 77_625,
      version: 1,
    });
    const stale = await tech
      .patch(`/api/v1/repairs/${job.id}/quotes/${draft.id}`)
      .send({ customerNote: 'x', version: 0 });
    expect(stale.status).toBe(409);

    expect((await tech.delete(`/api/v1/repairs/${job.id}/quotes/${draft.id}`)).status).toBe(204);
    expect(await prisma.quotation.count()).toBe(0);
  });

  it('can only be prepared while diagnosing or awaiting approval', async () => {
    const { admin, tech, account } = await setup();
    const job = await createRepairJob({
      createdById: admin.user.id,
      customerAccountId: account.id,
      status: 'QUOTE_REJECTED',
      technicianId: tech.user.id,
    });
    const res = await tech.post(`/api/v1/repairs/${job.id}/quotes`).send({ lines: LINES });
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('WRONG_REPAIR_STATUS');
    expect(res.body.error.message).toMatch(/back to diagnosing/);
  });

  it('refuses a total too large for one quotation', async () => {
    const { tech, job } = await setup();
    const lines = Array.from({ length: 11 }, () => ({
      kind: 'PART',
      description: 'Server',
      quantity: 1,
      unitPriceCents: 100_000_000,
    }));
    const res = await tech.post(`/api/v1/repairs/${job.id}/quotes`).send({ lines });
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('QUOTE_TOTAL_INVALID');
  });
});

describe('issuing', () => {
  it('freezes the quotation, records who issued it and asks the customer for approval', async () => {
    const { tech, job } = await setup();
    const draft = (await tech.post(`/api/v1/repairs/${job.id}/quotes`).send({ lines: LINES })).body
      .data;
    const res = await tech
      .post(`/api/v1/repairs/${job.id}/quotes/${draft.id}/issue`)
      .send({ version: 0 });
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ status: 'ISSUED', issuedBy: { id: tech.user.id } });
    const repair = (await tech.get(`/api/v1/repairs/${job.id}`)).body.data;
    expect(repair.status).toBe('AWAITING_APPROVAL');
    expect(repair.currentQuote).toMatchObject({
      id: draft.id,
      status: 'ISSUED',
      totalCents: 227_124,
    });

    const edit = await tech
      .patch(`/api/v1/repairs/${job.id}/quotes/${draft.id}`)
      .send({ lines: [], version: 1 });
    expect(edit.status).toBe(409);
    expect(edit.body.error.code).toBe('QUOTE_NOT_EDITABLE');
  });

  it('keeps the VAT rate it was issued with when the company rate changes later', async () => {
    const { admin, tech, job } = await setup();
    const draft = (await tech.post(`/api/v1/repairs/${job.id}/quotes`).send({ lines: LINES })).body
      .data;
    await tech.post(`/api/v1/repairs/${job.id}/quotes/${draft.id}/issue`).send({ version: 0 });
    await admin.patch('/api/v1/settings').send({ vatRateBasisPoints: 1600, version: 0 });
    const quote = (await tech.get(`/api/v1/repairs/${job.id}/quotes`)).body.data[0];
    expect(quote).toMatchObject({ vatRateBasisPoints: 1500, totalCents: 227_124 });
  });

  it('needs at least one line and a total above zero', async () => {
    const { tech, job } = await setup();
    const empty = (await tech.post(`/api/v1/repairs/${job.id}/quotes`).send({ lines: [] })).body
      .data;
    const res = await tech
      .post(`/api/v1/repairs/${job.id}/quotes/${empty.id}/issue`)
      .send({ version: 0 });
    expect(res.body.error.code).toBe('QUOTE_TOTAL_INVALID');
    await tech.patch(`/api/v1/repairs/${job.id}/quotes/${empty.id}`).send({
      lines: [{ kind: 'OTHER', description: 'Goodwill', quantity: 1, unitPriceCents: 0 }],
      version: 0,
    });
    const zero = await tech
      .post(`/api/v1/repairs/${job.id}/quotes/${empty.id}/issue`)
      .send({ version: 1 });
    expect(zero.status).toBe(422);
    expect(zero.body.error.code).toBe('QUOTE_TOTAL_INVALID');
  });

  it('supersedes the previous revision when a new one is issued', async () => {
    const { admin, tech, job } = await setup('AWAITING_APPROVAL');
    const first = await createQuote(job.id, admin.user.id, { issue: true });
    const draft = (await tech.post(`/api/v1/repairs/${job.id}/quotes`).send({ lines: LINES })).body
      .data;
    expect(draft.revision).toBe(2);
    await tech.post(`/api/v1/repairs/${job.id}/quotes/${draft.id}/issue`).send({ version: 0 });
    const quotes = (await tech.get(`/api/v1/repairs/${job.id}/quotes`)).body.data;
    expect(quotes.map((q: { revision: number; status: string }) => [q.revision, q.status])).toEqual(
      [
        [2, 'ISSUED'],
        [1, 'SUPERSEDED'],
      ],
    );
    expect(quotes[1].id).toBe(first.id);
  });
});

describe('approval', () => {
  it('cannot approve a superseded quotation', async () => {
    const { admin, tech, customer, job } = await setup('AWAITING_APPROVAL');
    const old = await createQuote(job.id, admin.user.id, { issue: true });
    const draft = (await tech.post(`/api/v1/repairs/${job.id}/quotes`).send({ lines: LINES })).body
      .data;
    await tech.post(`/api/v1/repairs/${job.id}/quotes/${draft.id}/issue`).send({ version: 0 });

    // The customer still has the old revision open in a tab.
    const res = await customer
      .post(`/api/v1/portal/repairs/${job.id}/quotes/${old.id}/approve`)
      .send({ version: old.version });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('QUOTE_NOT_ISSUED');
    expect(res.body.error.message).toMatch(/newer revision/);
    expect((await prisma.repairJob.findUniqueOrThrow({ where: { id: job.id } })).status).toBe(
      'AWAITING_APPROVAL',
    );
  });

  it('cannot approve twice (double click)', async () => {
    const { admin, customer, job } = await setup('AWAITING_APPROVAL');
    const quote = await createQuote(job.id, admin.user.id, { issue: true });
    const url = `/api/v1/portal/repairs/${job.id}/quotes/${quote.id}/approve`;
    const first = await customer.post(url).send({ version: quote.version });
    const second = await customer.post(url).send({ version: quote.version });
    expect(first.status).toBe(200);
    expect(second.status).toBe(409);
    expect(second.body.error.code).toBe('QUOTE_NOT_ISSUED');
    expect(
      await prisma.repairStatusHistory.count({
        where: { repairJobId: job.id, toStatus: 'APPROVED' },
      }),
    ).toBe(1);
  });

  it('approves exactly once when the customer and an administrator approve at the same moment', async () => {
    const { admin, customer, job } = await setup('AWAITING_APPROVAL');
    const quote = await createQuote(job.id, admin.user.id, { issue: true });
    const results = await Promise.all([
      ...Array.from({ length: 3 }, () =>
        customer
          .post(`/api/v1/portal/repairs/${job.id}/quotes/${quote.id}/approve`)
          .send({ version: quote.version }),
      ),
      ...Array.from({ length: 2 }, () =>
        admin
          .post(`/api/v1/repairs/${job.id}/quotes/${quote.id}/approve`)
          .send({ version: quote.version, channel: 'PHONE', note: 'Approved by phone' }),
      ),
    ]);
    expect(results.filter((r) => r.status === 200)).toHaveLength(1);
    expect(results.filter((r) => r.status === 409)).toHaveLength(4);
    expect(await prisma.auditLog.count({ where: { action: 'quote.approved' } })).toBe(1);
  });

  it('refuses a stale version', async () => {
    const { admin, customer, job } = await setup('AWAITING_APPROVAL');
    const quote = await createQuote(job.id, admin.user.id, { issue: true });
    const res = await customer
      .post(`/api/v1/portal/repairs/${job.id}/quotes/${quote.id}/approve`)
      .send({ version: quote.version + 5 });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('CONFLICT');
  });

  it('stores who approved, how, and the exact total approved', async () => {
    const { admin, job } = await setup('AWAITING_APPROVAL');
    const quote = await createQuote(job.id, admin.user.id, { issue: true });
    const missing = await admin
      .post(`/api/v1/repairs/${job.id}/quotes/${quote.id}/approve`)
      .send({ version: quote.version });
    expect(missing.status).toBe(400);
    const portalChannel = await admin
      .post(`/api/v1/repairs/${job.id}/quotes/${quote.id}/approve`)
      .send({ version: quote.version, channel: 'PORTAL', note: 'x' });
    expect(portalChannel.status).toBe(400);

    const res = await admin.post(`/api/v1/repairs/${job.id}/quotes/${quote.id}/approve`).send({
      version: quote.version,
      channel: 'IN_PERSON',
      note: 'Signed at the counter by Z. Dube',
    });
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({
      status: 'APPROVED',
      decisionChannel: 'IN_PERSON',
      onBehalf: true,
      decidedBy: { id: admin.user.id },
      approvedTotalCents: 115_000,
    });
    const history = await prisma.repairStatusHistory.findFirst({
      where: { repairJobId: job.id, toStatus: 'APPROVED' },
    });
    expect(history?.note).toMatch(/on behalf of the customer \(In person\)/);
    const audit = await prisma.auditLog.findFirst({ where: { action: 'quote.approved' } });
    expect(audit?.after).toMatchObject({
      onBehalf: true,
      channel: 'IN_PERSON',
      totalCents: 115_000,
    });
  });

  it('is not open to technicians', async () => {
    const { admin, tech, job } = await setup('AWAITING_APPROVAL');
    const quote = await createQuote(job.id, admin.user.id, { issue: true });
    const res = await tech
      .post(`/api/v1/repairs/${job.id}/quotes/${quote.id}/approve`)
      .send({ version: quote.version, channel: 'PHONE', note: 'I approve' });
    expect(res.status).toBe(403);
  });

  it('replays an approval sent twice with the same Idempotency-Key', async () => {
    const { admin, customer, job } = await setup('AWAITING_APPROVAL');
    const quote = await createQuote(job.id, admin.user.id, { issue: true });
    const send = () =>
      customer
        .post(`/api/v1/portal/repairs/${job.id}/quotes/${quote.id}/approve`)
        .set('Idempotency-Key', 'approve-click-1')
        .send({ version: quote.version });
    const [a, b] = [await send(), await send()];
    expect([a.status, b.status]).toEqual([200, 200]);
    expect(b.headers['idempotency-replayed']).toBe('true');
    expect(b.body).toEqual(a.body);
  });
});

describe('database guards on quotations', () => {
  it('refuses any change to an issued quotation’s amounts or lines', async () => {
    const { admin, job } = await setup('AWAITING_APPROVAL');
    const quote = await createQuote(job.id, admin.user.id, { issue: true });
    await expect(
      prisma.quotation.update({
        where: { id: quote.id },
        data: { totalCents: 1, subtotalCents: 1, vatCents: 0 },
      }),
    ).rejects.toThrow(/cannot change/);
    await expect(
      prisma.quotationLine.updateMany({
        where: { quotationId: quote.id },
        data: { unitPriceCents: 1 },
      }),
    ).rejects.toThrow(/cannot change/);
    await expect(
      prisma.quotationLine.create({
        data: {
          quotationId: quote.id,
          position: 2,
          kind: 'OTHER',
          description: 'Sneaky extra',
          quantityHundredths: 100,
          unitPriceCents: 100,
          lineTotalCents: 100,
        },
      }),
    ).rejects.toThrow(/draft/);
    await expect(prisma.quotation.delete({ where: { id: quote.id } })).rejects.toThrow(
      /cannot be deleted/,
    );
  });

  it('refuses to change a decided quotation or to approve without the approved total', async () => {
    const { admin, job } = await setup('AWAITING_APPROVAL');
    const quote = await createQuote(job.id, admin.user.id, { issue: true });
    await expect(
      prisma.quotation.update({
        where: { id: quote.id },
        data: {
          status: 'APPROVED',
          decidedById: admin.user.id,
          decidedAt: new Date(),
          decisionChannel: 'PHONE',
        },
      }),
    ).rejects.toThrow(/quotations_approved_chk/);
    await prisma.quotation.update({
      where: { id: quote.id },
      data: {
        status: 'REJECTED',
        decidedById: admin.user.id,
        decidedAt: new Date(),
        decisionChannel: 'PHONE',
      },
    });
    await expect(
      prisma.quotation.update({
        where: { id: quote.id },
        data: { status: 'APPROVED', approvedTotalCents: quote.totalCents },
      }),
    ).rejects.toThrow(/already REJECTED/);
  });

  it('allows one issued quotation per job', async () => {
    const { admin, job } = await setup('AWAITING_APPROVAL');
    await createQuote(job.id, admin.user.id, { issue: true });
    await expect(
      createQuote(job.id, admin.user.id, { issue: true, revision: 2 }),
    ).rejects.toThrow();
  });
});
