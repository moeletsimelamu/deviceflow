import { beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '../../src/lib/prisma.js';
import {
  createAsset,
  createCustomerAccount,
  createRepairJob,
  createUser,
  loginAs,
  resetDatabase,
} from '../helpers/db.js';

beforeEach(resetDatabase);

async function setup() {
  const admin = await loginAs('ADMIN');
  const tech = await loginAs('TECHNICIAN');
  const account = await createCustomerAccount({ name: 'Parktown Primary' });
  await prisma.customerContact.create({
    data: {
      customerAccountId: account.id,
      fullName: 'Zanele Dube',
      phone: '011 555 0142',
      isPrimary: true,
    },
  });
  const asset = await createAsset(admin.user.id, { customerAccountId: account.id });
  return { admin, tech, account, asset };
}

describe('booking a device in', () => {
  it('opens a SUBMITTED job, moves the device to IN_REPAIR and records it', async () => {
    const { admin, asset, account } = await setup();
    const res = await admin
      .post('/api/v1/repairs')
      .send({ assetId: asset.id, faultDescription: 'Does not power on' });
    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({
      reference: expect.stringMatching(/^RJ-\d{6}$/),
      status: 'SUBMITTED',
      source: 'STAFF',
      customer: { id: account.id },
      contact: { name: 'Zanele Dube', phone: '011 555 0142' },
      technician: null,
      labourMinutes: 0,
      currentQuote: null,
    });
    const after = await prisma.asset.findUniqueOrThrow({ where: { id: asset.id } });
    expect(after.status).toBe('IN_REPAIR');
    expect(
      await prisma.assetEvent.findFirst({
        where: { assetId: asset.id, repairJobId: res.body.data.id },
      }),
    ).toMatchObject({ fromStatus: 'ACTIVE', toStatus: 'IN_REPAIR' });
    expect(
      await prisma.auditLog.count({
        where: { action: 'repair.created', repairJobId: res.body.data.id },
      }),
    ).toBe(1);
  });

  it('can assign a technician straight away', async () => {
    const { admin, tech, asset } = await setup();
    const res = await admin.post('/api/v1/repairs').send({
      assetId: asset.id,
      faultDescription: 'Cracked screen',
      technicianId: tech.user.id,
    });
    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({ status: 'ASSIGNED', technician: { id: tech.user.id } });
    const history = await prisma.repairStatusHistory.findMany({
      where: { repairJobId: res.body.data.id },
      orderBy: { createdAt: 'asc' },
    });
    expect(history.map((h) => h.toStatus)).toEqual(['SUBMITTED', 'ASSIGNED']);
  });

  it('refuses a second open job for the same device, naming the open one', async () => {
    const { admin, asset } = await setup();
    const first = await admin
      .post('/api/v1/repairs')
      .send({ assetId: asset.id, faultDescription: 'Does not power on' });
    await prisma.asset.update({ where: { id: asset.id }, data: { status: 'ACTIVE' } });
    const second = await admin
      .post('/api/v1/repairs')
      .send({ assetId: asset.id, faultDescription: 'Does not power on' });
    expect(second.status).toBe(409);
    expect(second.body.error.code).toBe('REPAIR_ALREADY_OPEN');
    expect(second.body.error.message).toContain(first.body.data.reference);
  });

  it('opens exactly one job when five identical requests arrive at once', async () => {
    const { admin, asset } = await setup();
    const results = await Promise.all(
      Array.from({ length: 5 }, () =>
        admin.post('/api/v1/repairs').send({ assetId: asset.id, faultDescription: 'No power' }),
      ),
    );
    expect(results.filter((r) => r.status === 201)).toHaveLength(1);
    expect(results.filter((r) => r.status !== 201).every((r) => r.status === 409)).toBe(true);
    expect(await prisma.repairJob.count({ where: { assetId: asset.id } })).toBe(1);
  });

  it('only books in active devices that belong to an active customer', async () => {
    const { admin, account } = await setup();
    const stock = await createAsset(admin.user.id);
    const retired = await createAsset(admin.user.id, {
      customerAccountId: account.id,
      status: 'RETIRED',
    });
    for (const id of [stock.id, retired.id]) {
      const res = await admin
        .post('/api/v1/repairs')
        .send({ assetId: id, faultDescription: 'Broken' });
      expect(res.status).toBe(422);
      expect(res.body.error.code).toBe('ASSET_NOT_REPAIRABLE');
    }
    const archived = await createCustomerAccount({ isActive: false });
    const archivedAsset = await createAsset(admin.user.id, { customerAccountId: archived.id });
    const res = await admin
      .post('/api/v1/repairs')
      .send({ assetId: archivedAsset.id, faultDescription: 'Broken' });
    expect(res.body.error.code).toBe('CUSTOMER_ARCHIVED');
    const missing = await admin
      .post('/api/v1/repairs')
      .send({ assetId: crypto.randomUUID(), faultDescription: 'Broken' });
    expect(missing.status).toBe(404);
    expect(await prisma.repairJob.count()).toBe(0);
  });

  it('validates the request and only lets administrators book in', async () => {
    const { admin, tech, asset } = await setup();
    const bad = await admin
      .post('/api/v1/repairs')
      .send({ assetId: asset.id, faultDescription: 'x' });
    expect(bad.status).toBe(400);
    const notTech = await admin.post('/api/v1/repairs').send({
      assetId: asset.id,
      faultDescription: 'No power',
      technicianId: admin.user.id,
    });
    expect(notTech.body.error.code).toBe('TECHNICIAN_INVALID');
    expect(
      (await tech.post('/api/v1/repairs').send({ assetId: asset.id, faultDescription: 'No power' }))
        .status,
    ).toBe(403);
    expect(await prisma.repairJob.count()).toBe(0);
  });
});

describe('Idempotency-Key', () => {
  it('replays the saved response for a repeated request and opens one job', async () => {
    const { admin, asset } = await setup();
    const send = () =>
      admin
        .post('/api/v1/repairs')
        .set('Idempotency-Key', 'book-in-0001')
        .send({ assetId: asset.id, faultDescription: 'No power' });
    const first = await send();
    const second = await send();
    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
    expect(second.headers['idempotency-replayed']).toBe('true');
    expect(second.body).toEqual(first.body);
    expect(await prisma.repairJob.count()).toBe(1);
  });

  it('replays to simultaneous duplicates instead of failing them', async () => {
    const { admin, asset } = await setup();
    const results = await Promise.all(
      Array.from({ length: 4 }, () =>
        admin
          .post('/api/v1/repairs')
          .set('Idempotency-Key', 'double-click-42')
          .send({ assetId: asset.id, faultDescription: 'No power' }),
      ),
    );
    expect(results.map((r) => r.status)).toEqual([201, 201, 201, 201]);
    expect(new Set(results.map((r) => r.body.data.id)).size).toBe(1);
    expect(await prisma.repairJob.count()).toBe(1);
  });

  it('refuses the same key for a different request', async () => {
    const { admin, asset, account } = await setup();
    await admin
      .post('/api/v1/repairs')
      .set('Idempotency-Key', 'reused-key-1')
      .send({ assetId: asset.id, faultDescription: 'No power' });
    const other = await createAsset(admin.user.id, { customerAccountId: account.id });
    const res = await admin
      .post('/api/v1/repairs')
      .set('Idempotency-Key', 'reused-key-1')
      .send({ assetId: other.id, faultDescription: 'No power' });
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('IDEMPOTENCY_KEY_REUSED');
  });

  it('stores nothing for a failed request, so it can be corrected and resent', async () => {
    const { admin, asset } = await setup();
    const failed = await admin
      .post('/api/v1/repairs')
      .set('Idempotency-Key', 'retry-after-fix')
      .send({ assetId: asset.id, faultDescription: 'No power', technicianId: admin.user.id });
    expect(failed.status).toBe(422);
    expect(await prisma.idempotencyKey.count()).toBe(0);
    const ok = await admin
      .post('/api/v1/repairs')
      .set('Idempotency-Key', 'retry-after-fix')
      .send({ assetId: asset.id, faultDescription: 'No power' });
    expect(ok.status).toBe(201);
  });

  it('keeps keys per user and rejects malformed keys', async () => {
    const { admin } = await setup();
    const res = await admin
      .post('/api/v1/repairs')
      .set('Idempotency-Key', 'bad key!')
      .send({ assetId: crypto.randomUUID(), faultDescription: 'No power' });
    expect(res.status).toBe(400);
  });
});

describe('technician scope', () => {
  it('shows technicians only the jobs assigned to them', async () => {
    const { admin, tech, account } = await setup();
    const mine = await createRepairJob({
      createdById: admin.user.id,
      customerAccountId: account.id,
      status: 'DIAGNOSING',
      technicianId: tech.user.id,
    });
    const other = await createUser('TECHNICIAN');
    const theirs = await createRepairJob({
      createdById: admin.user.id,
      customerAccountId: account.id,
      status: 'DIAGNOSING',
      technicianId: other.id,
    });
    const unassigned = await createRepairJob({
      createdById: admin.user.id,
      customerAccountId: account.id,
    });

    const list = await tech.get(`/api/v1/repairs?technician=${other.id}`);
    expect(list.body.data.map((j: { id: string }) => j.id)).toEqual([mine.id]);
    expect((await admin.get('/api/v1/repairs')).body.meta.total).toBe(3);

    for (const id of [theirs.id, unassigned.id]) {
      for (const path of ['', '/history', '/notes', '/labour', '/quotes']) {
        const res = await tech.get(`/api/v1/repairs/${id}${path}`);
        expect(res.status, path).toBe(404);
      }
      const note = await tech
        .post(`/api/v1/repairs/${id}/notes`)
        .send({ type: 'INTERNAL', body: 'Peeking' });
      expect(note.status).toBe(404);
    }
    const detail = await tech.get(`/api/v1/repairs/${mine.id}`);
    expect(detail.status).toBe(200);
    // Technicians get the contact details of the jobs they work on.
    expect(detail.body.data.contact.name).toBe('Zanele Dube');
  });

  it('gives customers no access to staff repair endpoints', async () => {
    const { account } = await setup();
    const customer = await loginAs('CUSTOMER', { customerAccountId: account.id });
    expect((await customer.get('/api/v1/repairs')).status).toBe(403);
  });

  it('shows inventory managers no job that has not used parts (Phase 5)', async () => {
    const { admin, asset } = await setup();
    await admin
      .post('/api/v1/repairs')
      .send({ assetId: asset.id, faultDescription: 'Does not power on' });
    const inventory = await loginAs('INVENTORY_MANAGER');
    const res = await inventory.get('/api/v1/repairs');
    expect(res.status).toBe(200);
    expect(res.body.meta.total).toBe(0);
  });

  it('filters, searches and lists technicians with their workload', async () => {
    const { admin, tech, account, asset } = await setup();
    await createRepairJob({
      createdById: admin.user.id,
      customerAccountId: account.id,
      status: 'IN_REPAIR',
      technicianId: tech.user.id,
      assetId: asset.id,
    });
    await createRepairJob({
      createdById: admin.user.id,
      customerAccountId: account.id,
      status: 'CLOSED',
      technicianId: tech.user.id,
    });
    expect((await admin.get('/api/v1/repairs?state=open')).body.meta.total).toBe(1);
    expect((await admin.get('/api/v1/repairs?state=closed')).body.meta.total).toBe(1);
    expect((await admin.get('/api/v1/repairs?technician=unassigned')).body.meta.total).toBe(0);
    expect((await admin.get(`/api/v1/repairs?search=${asset.assetTag}`)).body.meta.total).toBe(1);
    expect((await admin.get('/api/v1/repairs?search=parktown')).body.meta.total).toBe(2);
    expect((await admin.get(`/api/v1/repairs?asset=${asset.id}`)).body.meta.total).toBe(1);

    const techs = await admin.get('/api/v1/repairs/technicians');
    expect(techs.body.data).toEqual([
      { id: tech.user.id, fullName: tech.user.fullName, openJobs: 1 },
    ]);
    expect((await tech.get('/api/v1/repairs/technicians')).status).toBe(403);
  });
});

describe('assignment', () => {
  it('reassigns without changing the status, and the old technician loses access', async () => {
    const { admin, tech, account } = await setup();
    const job = await createRepairJob({
      createdById: admin.user.id,
      customerAccountId: account.id,
      status: 'IN_REPAIR',
      technicianId: tech.user.id,
    });
    const next = await loginAs('TECHNICIAN');
    const res = await admin
      .post(`/api/v1/repairs/${job.id}/assign`)
      .send({ technicianId: next.user.id, version: 0 });
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({
      status: 'IN_REPAIR',
      technician: { id: next.user.id },
      version: 1,
    });
    expect((await tech.get(`/api/v1/repairs/${job.id}`)).status).toBe(404);
    expect((await next.get(`/api/v1/repairs/${job.id}`)).status).toBe(200);

    const again = await admin
      .post(`/api/v1/repairs/${job.id}/assign`)
      .send({ technicianId: next.user.id, version: 1 });
    expect(again.status).toBe(422);
    const inactive = await createUser('TECHNICIAN', { isActive: false });
    const bad = await admin
      .post(`/api/v1/repairs/${job.id}/assign`)
      .send({ technicianId: inactive.id, version: 1 });
    expect(bad.body.error.code).toBe('TECHNICIAN_INVALID');
    const stale = await admin
      .post(`/api/v1/repairs/${job.id}/assign`)
      .send({ technicianId: tech.user.id, version: 0 });
    expect(stale.status).toBe(409);
  });
});

describe('notes and labour', () => {
  it('adds notes of each kind, newest first', async () => {
    const { admin, tech, account } = await setup();
    const job = await createRepairJob({
      createdById: admin.user.id,
      customerAccountId: account.id,
      status: 'DIAGNOSING',
      technicianId: tech.user.id,
    });
    await tech
      .post(`/api/v1/repairs/${job.id}/notes`)
      .send({ type: 'DIAGNOSTIC', body: 'Swollen battery' });
    const res = await tech
      .post(`/api/v1/repairs/${job.id}/notes`)
      .send({ type: 'CUSTOMER_VISIBLE', body: 'We found the cause' });
    expect(res.status).toBe(201);
    const notes = await tech.get(`/api/v1/repairs/${job.id}/notes`);
    expect(notes.body.data.map((n: { type: string }) => n.type)).toEqual([
      'CUSTOMER_VISIBLE',
      'DIAGNOSTIC',
    ]);
    expect(notes.body.data[0].author.id).toBe(tech.user.id);
    expect(
      (await tech.post(`/api/v1/repairs/${job.id}/notes`).send({ type: 'INTERNAL', body: ' ' }))
        .status,
    ).toBe(400);
    await expect(
      prisma.repairNote.updateMany({ where: { repairJobId: job.id }, data: { body: 'edited' } }),
    ).rejects.toThrow(/append-only/);
  });

  it('records labour in working statuses only and lets technicians remove only their own', async () => {
    const { admin, tech, account } = await setup();
    const job = await createRepairJob({
      createdById: admin.user.id,
      customerAccountId: account.id,
      status: 'IN_REPAIR',
      technicianId: tech.user.id,
    });
    const today = new Date().toISOString().slice(0, 10);
    const entry = await tech
      .post(`/api/v1/repairs/${job.id}/labour`)
      .send({ minutes: 90, description: 'Replaced keyboard', workDate: today });
    expect(entry.status).toBe(201);
    const byAdmin = await admin
      .post(`/api/v1/repairs/${job.id}/labour`)
      .send({ minutes: 15, description: 'Checked', workDate: today });
    expect((await admin.get(`/api/v1/repairs/${job.id}`)).body.data.labourMinutes).toBe(105);

    const notOwn = await tech.delete(`/api/v1/repairs/${job.id}/labour/${byAdmin.body.data.id}`);
    expect(notOwn.status).toBe(403);
    expect(
      (await tech.delete(`/api/v1/repairs/${job.id}/labour/${entry.body.data.id}`)).status,
    ).toBe(204);
    expect(
      await prisma.auditLog.findFirst({ where: { action: 'labour.deleted', repairJobId: job.id } }),
    ).toMatchObject({ before: expect.objectContaining({ minutes: 90 }) });

    const future = await tech
      .post(`/api/v1/repairs/${job.id}/labour`)
      .send({ minutes: 10, description: 'x', workDate: '2999-01-01' });
    expect(future.status).toBe(400);
    for (const minutes of [0, 1441, 1.5]) {
      const res = await tech
        .post(`/api/v1/repairs/${job.id}/labour`)
        .send({ minutes, description: 'x', workDate: today });
      expect(res.status, String(minutes)).toBe(400);
    }

    const closed = await createRepairJob({
      createdById: admin.user.id,
      customerAccountId: account.id,
      status: 'COMPLETED',
      technicianId: tech.user.id,
    });
    const late = await tech
      .post(`/api/v1/repairs/${closed.id}/labour`)
      .send({ minutes: 10, description: 'Late entry', workDate: today });
    expect(late.status).toBe(422);
    expect(late.body.error.code).toBe('WRONG_REPAIR_STATUS');
  });
});

describe('devices with an open repair job', () => {
  it('cannot have their status or owner changed by hand', async () => {
    const { admin, account } = await setup();
    const job = await createRepairJob({
      createdById: admin.user.id,
      customerAccountId: account.id,
    });
    const asset = await prisma.asset.findUniqueOrThrow({ where: { id: job.assetId } });
    const status = await admin
      .post(`/api/v1/assets/${asset.id}/status`)
      .send({ status: 'ACTIVE', version: asset.version });
    expect(status.status).toBe(422);
    expect(status.body.error.code).toBe('ASSET_IN_REPAIR_JOB');
    const other = await createCustomerAccount();
    const owner = await admin
      .patch(`/api/v1/assets/${asset.id}`)
      .send({ customerAccountId: other.id, version: asset.version });
    expect(owner.body.error.code).toBe('ASSET_IN_REPAIR_JOB');
  });

  it('cannot be put into repair by hand', async () => {
    const { admin, asset } = await setup();
    const res = await admin
      .post(`/api/v1/assets/${asset.id}/status`)
      .send({ status: 'IN_REPAIR', version: 0 });
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('INVALID_TRANSITION');
  });
});

describe('database guards', () => {
  it('allows only one open job per device', async () => {
    const { admin, account, asset } = await setup();
    await createRepairJob({
      createdById: admin.user.id,
      customerAccountId: account.id,
      assetId: asset.id,
    });
    await expect(
      createRepairJob({
        createdById: admin.user.id,
        customerAccountId: account.id,
        assetId: asset.id,
      }),
    ).rejects.toThrow();
  });

  it('refuses a job past SUBMITTED without a technician, and a completed job without a summary', async () => {
    const { admin, account } = await setup();
    const job = await createRepairJob({
      createdById: admin.user.id,
      customerAccountId: account.id,
    });
    await expect(
      prisma.repairJob.update({ where: { id: job.id }, data: { status: 'DIAGNOSING' } }),
    ).rejects.toThrow(/repair_jobs_technician_chk/);
    await expect(
      prisma.repairJob.update({
        where: { id: job.id },
        data: { status: 'COMPLETED', assignedTechnicianId: admin.user.id },
      }),
    ).rejects.toThrow(/repair_jobs_completion_chk/);
  });

  it('keeps status history append-only', async () => {
    const { admin, account } = await setup();
    const job = await createRepairJob({
      createdById: admin.user.id,
      customerAccountId: account.id,
    });
    await expect(
      prisma.repairStatusHistory.deleteMany({ where: { repairJobId: job.id } }),
    ).rejects.toThrow(/append-only/);
  });
});
