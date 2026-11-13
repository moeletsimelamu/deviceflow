import { beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '../../src/lib/prisma.js';
import {
  client,
  createCustomerAccount,
  createUser,
  loginAs,
  resetDatabase,
  TEST_PASSWORD,
} from '../helpers/db.js';

beforeEach(resetDatabase);

const school = {
  type: 'ORGANISATION',
  name: 'Northcliff High School',
  email: ' Accounts@Northcliff.example ',
  phone: '+27 11 555 0100',
  city: 'Johannesburg',
  notes: '',
};

describe('customer accounts: access', () => {
  it.each(['TECHNICIAN', 'INVENTORY_MANAGER'] as const)(
    'forbids %s from reading or creating customers',
    async (role) => {
      const c = await loginAs(role);
      expect((await c.get('/api/v1/customers')).status).toBe(403);
      expect((await c.post('/api/v1/customers').send(school)).status).toBe(403);
      expect(await prisma.customerAccount.count()).toBe(0);
    },
  );

  it('forbids customer users from staff customer endpoints', async () => {
    const account = await createCustomerAccount();
    const c = await loginAs('CUSTOMER', { customerAccountId: account.id });
    expect((await c.get(`/api/v1/customers/${account.id}`)).status).toBe(403);
  });
});

describe('customer accounts: administration', () => {
  it('creates an account with a sequential account number, normalised email and audit', async () => {
    const admin = await loginAs('ADMIN');
    const res = await admin.post('/api/v1/customers').send(school);

    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({
      name: 'Northcliff High School',
      type: 'ORGANISATION',
      email: 'accounts@northcliff.example',
      notes: null,
      isActive: true,
      assetCount: 0,
    });
    expect(res.body.data.accountNumber).toMatch(/^CU-\d{6,}$/);

    const second = await admin
      .post('/api/v1/customers')
      .send({ type: 'INDIVIDUAL', name: 'Thandi Nkosi' });
    const n = (v: string) => Number(v.slice(3));
    expect(n(second.body.data.accountNumber)).toBe(n(res.body.data.accountNumber) + 1);

    const audit = await prisma.auditLog.findFirstOrThrow({ where: { action: 'customer.created' } });
    expect(audit.customerAccountId).toBe(res.body.data.id);
  });

  it('validates fields', async () => {
    const admin = await loginAs('ADMIN');
    const res = await admin
      .post('/api/v1/customers')
      .send({ type: 'COMPANY', name: ' ', email: 'nope', phone: 'call me' });
    expect(res.status).toBe(400);
    const paths = res.body.error.details.map((d: { path: string }) => d.path).sort();
    expect(paths).toEqual(['email', 'name', 'phone', 'type']);
  });

  it('searches by name, account number and contact name, and filters by type', async () => {
    const admin = await loginAs('ADMIN');
    const a = await createCustomerAccount({ name: 'Parktown Primary', type: 'ORGANISATION' });
    await createCustomerAccount({ name: 'Sipho Mahlangu', type: 'INDIVIDUAL' });
    await prisma.customerContact.create({
      data: { customerAccountId: a.id, fullName: 'Ms Zanele Dube' },
    });

    const byContact = await admin.get('/api/v1/customers?search=zanele');
    expect(byContact.body.data.map((c: { name: string }) => c.name)).toEqual(['Parktown Primary']);

    const byNumber = await admin.get(`/api/v1/customers?search=${a.accountNumber}`);
    expect(byNumber.body.meta.total).toBe(1);

    const individuals = await admin.get('/api/v1/customers?type=INDIVIDUAL');
    expect(individuals.body.data.map((c: { name: string }) => c.name)).toEqual(['Sipho Mahlangu']);

    const sorted = await admin.get('/api/v1/customers?sort=name:desc');
    expect(sorted.body.data[0].name).toBe('Sipho Mahlangu');

    expect((await admin.get('/api/v1/customers?sort=notes:asc')).status).toBe(400);
  });

  it('updates with optimistic concurrency', async () => {
    const admin = await loginAs('ADMIN');
    const account = await createCustomerAccount();
    const ok = await admin
      .patch(`/api/v1/customers/${account.id}`)
      .send({ phone: '011 555 0199', version: 0 });
    expect(ok.status).toBe(200);
    expect(ok.body.data).toMatchObject({ phone: '011 555 0199', version: 1 });

    const stale = await admin
      .patch(`/api/v1/customers/${account.id}`)
      .send({ phone: '011 555 0000', version: 0 });
    expect(stale.status).toBe(409);
    expect(stale.body.error.code).toBe('CONFLICT');
  });

  it('archiving signs out the account’s portal users and blocks sign-in; restoring allows it', async () => {
    const admin = await loginAs('ADMIN');
    const account = await createCustomerAccount();
    const customer = await loginAs('CUSTOMER', { customerAccountId: account.id });
    expect((await customer.get('/api/v1/portal/account')).status).toBe(200);

    const archived = await admin
      .patch(`/api/v1/customers/${account.id}`)
      .send({ isActive: false, version: 0 });
    expect(archived.status).toBe(200);
    expect(archived.body.data.isActive).toBe(false);

    expect((await customer.get('/api/v1/portal/account')).status).toBe(401);
    const relogin = await client()
      .post('/api/v1/auth/login')
      .send({ email: customer.user.email, password: TEST_PASSWORD });
    expect(relogin.status).toBe(401);
    expect(relogin.body.error.code).toBe('INVALID_CREDENTIALS');

    await admin.patch(`/api/v1/customers/${account.id}`).send({ isActive: true, version: 1 });
    const again = await client()
      .post('/api/v1/auth/login')
      .send({ email: customer.user.email, password: TEST_PASSWORD });
    expect(again.status).toBe(200);
    expect(again.body.user.customerAccountId).toBe(account.id);

    const actions = (
      await prisma.auditLog.findMany({
        where: { customerAccountId: account.id },
        orderBy: { createdAt: 'asc' },
      })
    ).map((a) => a.action);
    expect(actions).toEqual(['customer.archived', 'customer.restored']);
  });

  it('returns 404 for an unknown id and 400 for a malformed one', async () => {
    const admin = await loginAs('ADMIN');
    expect((await admin.get(`/api/v1/customers/${crypto.randomUUID()}`)).status).toBe(404);
    expect((await admin.get('/api/v1/customers/not-a-uuid')).status).toBe(400);
  });
});

describe('customer contacts', () => {
  it('keeps exactly one primary contact', async () => {
    const admin = await loginAs('ADMIN');
    const account = await createCustomerAccount();
    const url = `/api/v1/customers/${account.id}/contacts`;

    const first = await admin.post(url).send({ fullName: 'Zanele Dube', isPrimary: true });
    expect(first.status).toBe(201);
    const second = await admin
      .post(url)
      .send({ fullName: 'Pieter Botha', email: 'PIETER@school.example', isPrimary: true });
    expect(second.body.data.email).toBe('pieter@school.example');

    const list = await admin.get(url);
    expect(
      list.body.data.map((c: { fullName: string; isPrimary: boolean }) => [
        c.fullName,
        c.isPrimary,
      ]),
    ).toEqual([
      ['Pieter Botha', true],
      ['Zanele Dube', false],
    ]);

    // The database also refuses two primaries, whatever the code does.
    await expect(
      prisma.customerContact.updateMany({
        where: { id: first.body.data.id },
        data: { isPrimary: true },
      }),
    ).rejects.toThrow();
  });

  it('updates and deletes a contact, scoped to its account', async () => {
    const admin = await loginAs('ADMIN');
    const account = await createCustomerAccount();
    const other = await createCustomerAccount();
    const created = await admin
      .post(`/api/v1/customers/${account.id}/contacts`)
      .send({ fullName: 'Zanele Dube' });
    const contactId = created.body.data.id;

    // The contact exists, but not under this account: 404.
    const wrongAccount = await admin
      .patch(`/api/v1/customers/${other.id}/contacts/${contactId}`)
      .send({ jobTitle: 'Principal', version: 0 });
    expect(wrongAccount.status).toBe(404);

    const updated = await admin
      .patch(`/api/v1/customers/${account.id}/contacts/${contactId}`)
      .send({ jobTitle: 'Principal', version: 0 });
    expect(updated.body.data).toMatchObject({ jobTitle: 'Principal', version: 1 });

    const removed = await admin.delete(`/api/v1/customers/${account.id}/contacts/${contactId}`);
    expect(removed.status).toBe(204);
    expect(await prisma.customerContact.count()).toBe(0);

    const audit = await prisma.auditLog.findFirstOrThrow({ where: { action: 'contact.deleted' } });
    expect(audit.before).toMatchObject({ fullName: 'Zanele Dube' });
  });
});

describe('customer portal users', () => {
  it('creates a customer user tied to the account, who can then sign in', async () => {
    const admin = await loginAs('ADMIN');
    const account = await createCustomerAccount();
    const res = await admin.post(`/api/v1/customers/${account.id}/users`).send({
      email: 'Parent@Example.test',
      fullName: 'Lindiwe Zulu',
      password: 'a-long-enough-password',
    });
    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({
      email: 'parent@example.test',
      role: 'CUSTOMER',
      customerAccountId: account.id,
    });

    const login = await client()
      .post('/api/v1/auth/login')
      .send({ email: 'parent@example.test', password: 'a-long-enough-password' });
    expect(login.status).toBe(200);
    expect(login.body.user).toMatchObject({ role: 'CUSTOMER', customerAccountId: account.id });

    const list = await admin.get(`/api/v1/customers/${account.id}/users`);
    expect(list.body.data).toHaveLength(1);
  });

  it('refuses portal users for an archived account and duplicate emails', async () => {
    const admin = await loginAs('ADMIN');
    const archived = await createCustomerAccount({ isActive: false });
    const body = {
      email: 'x@example.test',
      fullName: 'X Person',
      password: 'a-long-enough-password',
    };
    const res = await admin.post(`/api/v1/customers/${archived.id}/users`).send(body);
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('CUSTOMER_ARCHIVED');

    const active = await createCustomerAccount();
    await createUser('TECHNICIAN', { email: 'x@example.test' });
    const dup = await admin.post(`/api/v1/customers/${active.id}/users`).send(body);
    expect(dup.status).toBe(409);
    expect(dup.body.error.code).toBe('EMAIL_TAKEN');
  });

  it('the database refuses a customer user without an account, and staff with one', async () => {
    const account = await createCustomerAccount();
    await expect(createUser('CUSTOMER')).rejects.toThrow();
    await expect(createUser('TECHNICIAN', { customerAccountId: account.id })).rejects.toThrow();
  });
});
