import { beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '../../src/lib/prisma.js';
import {
  createAsset,
  createCustomerAccount,
  createQuote,
  createRepairJob,
  createUser,
  loginAs,
  resetDatabase,
} from '../helpers/db.js';

beforeEach(resetDatabase);

/** Two customers with a device each; customer A has a job awaiting approval with internal notes. */
async function setup() {
  const admin = await loginAs('ADMIN');
  const tech = await createUser('TECHNICIAN');
  const accountA = await createCustomerAccount({ name: 'A School' });
  const accountB = await createCustomerAccount({ name: 'B School' });
  const assetA = await createAsset(admin.user.id, { customerAccountId: accountA.id });
  const assetB = await createAsset(admin.user.id, { customerAccountId: accountB.id });
  const jobA = await createRepairJob({
    createdById: admin.user.id,
    customerAccountId: accountA.id,
    status: 'AWAITING_APPROVAL',
    technicianId: tech.id,
  });
  const jobB = await createRepairJob({
    createdById: admin.user.id,
    customerAccountId: accountB.id,
    status: 'AWAITING_APPROVAL',
    technicianId: tech.id,
  });
  const quoteA = await createQuote(jobA.id, admin.user.id, { issue: true });
  const quoteB = await createQuote(jobB.id, admin.user.id, { issue: true });
  const customerA = await loginAs('CUSTOMER', { customerAccountId: accountA.id });
  return { admin, tech, accountA, accountB, assetA, assetB, jobA, jobB, quoteA, quoteB, customerA };
}

describe('portal repair requests', () => {
  it('lets a customer request a repair for their own active device', async () => {
    const { customerA, assetA } = await setup();
    const res = await customerA
      .post('/api/v1/portal/repairs')
      .send({ assetId: assetA.id, faultDescription: 'Keyboard keys stick' });
    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({
      status: 'SUBMITTED',
      device: { id: assetA.id },
      faultDescription: 'Keyboard keys stick',
    });
    const job = await prisma.repairJob.findUniqueOrThrow({ where: { id: res.body.data.id } });
    expect(job).toMatchObject({ source: 'PORTAL', submittedById: customerA.user.id });
    expect((await prisma.asset.findUniqueOrThrow({ where: { id: assetA.id } })).status).toBe(
      'IN_REPAIR',
    );
  });

  it('reports another customer’s device, or company stock, as not found', async () => {
    const { customerA, assetB, admin } = await setup();
    const stock = await createAsset(admin.user.id);
    for (const assetId of [assetB.id, stock.id, crypto.randomUUID()]) {
      const res = await customerA
        .post('/api/v1/portal/repairs')
        .send({ assetId, faultDescription: 'Broken screen' });
      expect(res.status).toBe(404);
    }
    expect(await prisma.repairJob.count({ where: { source: 'PORTAL' } })).toBe(0);
  });
});

describe('portal repair isolation', () => {
  it('lists only the customer’s own repairs', async () => {
    const { customerA, jobA, accountB } = await setup();
    const res = await customerA.get(`/api/v1/portal/repairs?customer=${accountB.id}`);
    expect(res.body.data.map((r: { id: string }) => r.id)).toEqual([jobA.id]);
  });

  it('returns 404 for every view and action on another customer’s repair', async () => {
    const { customerA, jobB, quoteB } = await setup();
    for (const path of ['', '/timeline', '/quotes']) {
      expect((await customerA.get(`/api/v1/portal/repairs/${jobB.id}${path}`)).status, path).toBe(
        404,
      );
    }
    const approve = await customerA
      .post(`/api/v1/portal/repairs/${jobB.id}/quotes/${quoteB.id}/approve`)
      .send({ version: quoteB.version });
    const reject = await customerA
      .post(`/api/v1/portal/repairs/${jobB.id}/quotes/${quoteB.id}/reject`)
      .send({ version: quoteB.version });
    const cancel = await customerA
      .post(`/api/v1/portal/repairs/${jobB.id}/cancel`)
      .send({ reason: 'Not mine', version: 0 });
    expect([approve.status, reject.status, cancel.status]).toEqual([404, 404, 404]);
    expect((await prisma.quotation.findUniqueOrThrow({ where: { id: quoteB.id } })).status).toBe(
      'ISSUED',
    );
  });

  it('cannot approve another customer’s quotation through its own job id', async () => {
    const { customerA, jobA, quoteB } = await setup();
    const res = await customerA
      .post(`/api/v1/portal/repairs/${jobA.id}/quotes/${quoteB.id}/approve`)
      .send({ version: quoteB.version });
    expect(res.status).toBe(404);
  });

  it('gives staff 403 on portal repair endpoints', async () => {
    const { admin } = await setup();
    expect((await admin.get('/api/v1/portal/repairs')).status).toBe(403);
  });
});

describe('what customers see', () => {
  it('shows status changes and customer messages, never internal notes, reasons or staff', async () => {
    const { customerA, jobA, admin, tech } = await setup();
    await prisma.repairNote.createMany({
      data: [
        {
          repairJobId: jobA.id,
          type: 'INTERNAL',
          body: 'INTERNAL: customer dropped it',
          authorId: tech.id,
        },
        {
          repairJobId: jobA.id,
          type: 'DIAGNOSTIC',
          body: 'INTERNAL: liquid damage',
          authorId: tech.id,
        },
        {
          repairJobId: jobA.id,
          type: 'CUSTOMER_VISIBLE',
          body: 'Your quote is ready',
          authorId: tech.id,
        },
      ],
    });
    await prisma.repairStatusHistory.create({
      data: {
        repairJobId: jobA.id,
        fromStatus: 'DIAGNOSING',
        toStatus: 'AWAITING_APPROVAL',
        note: 'INTERNAL: priced high',
        actorUserId: admin.user.id,
      },
    });
    const [detail, timeline, quotes] = await Promise.all([
      customerA.get(`/api/v1/portal/repairs/${jobA.id}`),
      customerA.get(`/api/v1/portal/repairs/${jobA.id}/timeline`),
      customerA.get(`/api/v1/portal/repairs/${jobA.id}/quotes`),
    ]);
    const body = JSON.stringify([detail.body, timeline.body, quotes.body]);
    expect(body).not.toContain('INTERNAL');
    expect(body).not.toContain(admin.user.id);
    expect(body).not.toContain(tech.id);
    expect(body).not.toContain(admin.user.fullName);
    expect(timeline.body.data.filter((e: { kind: string }) => e.kind === 'message')).toEqual([
      expect.objectContaining({ body: 'Your quote is ready' }),
    ]);
  });

  it('never shows draft quotations', async () => {
    const { customerA, jobA, admin, quoteA } = await setup();
    const draft = await createQuote(jobA.id, admin.user.id, { revision: 2 });
    const quotes = await customerA.get(`/api/v1/portal/repairs/${jobA.id}/quotes`);
    expect(quotes.body.data.map((q: { id: string }) => q.id)).toEqual([quoteA.id]);
    const approveDraft = await customerA
      .post(`/api/v1/portal/repairs/${jobA.id}/quotes/${draft.id}/approve`)
      .send({ version: 0 });
    expect(approveDraft.status).toBe(404);
  });

  it('shows the customer’s own approval with their name, and an on-behalf approval without staff details', async () => {
    const { customerA, jobA, quoteA, admin, accountA, tech } = await setup();
    const approved = await customerA
      .post(`/api/v1/portal/repairs/${jobA.id}/quotes/${quoteA.id}/approve`)
      .send({ version: quoteA.version });
    expect(approved.status).toBe(200);
    expect(approved.body.data).toMatchObject({
      status: 'APPROVED',
      decisionChannel: 'PORTAL',
      onBehalf: false,
      decidedByName: customerA.user.fullName,
    });
    expect((await customerA.get(`/api/v1/portal/repairs/${jobA.id}`)).body.data.status).toBe(
      'APPROVED',
    );

    const job2 = await createRepairJob({
      createdById: admin.user.id,
      customerAccountId: accountA.id,
      status: 'AWAITING_APPROVAL',
      technicianId: tech.id,
    });
    const quote2 = await createQuote(job2.id, admin.user.id, { issue: true });
    await admin.post(`/api/v1/repairs/${job2.id}/quotes/${quote2.id}/approve`).send({
      version: quote2.version,
      channel: 'PHONE',
      note: 'STAFF NOTE: called the principal',
    });
    const seen = (await customerA.get(`/api/v1/portal/repairs/${job2.id}/quotes`)).body.data[0];
    expect(seen).toMatchObject({ status: 'APPROVED', decisionChannel: 'PHONE', onBehalf: true });
    expect(seen.decidedByName).toBeNull();
    expect(seen.decisionNote).toBeNull();
  });

  it('lets a customer reject with a reason', async () => {
    const { customerA, jobA, quoteA } = await setup();
    const res = await customerA
      .post(`/api/v1/portal/repairs/${jobA.id}/quotes/${quoteA.id}/reject`)
      .send({ version: quoteA.version, reason: 'We will replace the device instead' });
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({
      status: 'REJECTED',
      decisionNote: 'We will replace the device instead',
    });
    expect((await prisma.repairJob.findUniqueOrThrow({ where: { id: jobA.id } })).status).toBe(
      'QUOTE_REJECTED',
    );
  });
});

describe('portal cancellation', () => {
  it('lets a customer cancel a request before a technician is assigned', async () => {
    const { customerA, assetA } = await setup();
    const created = (
      await customerA
        .post('/api/v1/portal/repairs')
        .send({ assetId: assetA.id, faultDescription: 'Runs very slowly' })
    ).body.data;
    const missingReason = await customerA
      .post(`/api/v1/portal/repairs/${created.id}/cancel`)
      .send({ version: created.version });
    expect(missingReason.status).toBe(400);
    const res = await customerA
      .post(`/api/v1/portal/repairs/${created.id}/cancel`)
      .send({ reason: 'It works again', version: created.version });
    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe('CANCELLED');
    expect((await prisma.asset.findUniqueOrThrow({ where: { id: assetA.id } })).status).toBe(
      'ACTIVE',
    );
  });

  it('refuses once work has started', async () => {
    const { customerA, jobA } = await setup();
    const res = await customerA
      .post(`/api/v1/portal/repairs/${jobA.id}/cancel`)
      .send({ reason: 'Changed my mind', version: 0 });
    expect(res.status).toBe(403);
    expect(res.body.error.message).toMatch(/contact us/);
  });
});
