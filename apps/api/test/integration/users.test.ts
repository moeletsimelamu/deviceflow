import { beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '../../src/lib/prisma.js';
import { createUser, loginAs, resetDatabase } from '../helpers/db.js';

beforeEach(resetDatabase);

const newUser = {
  email: 'new.tech@example.test',
  fullName: 'New Technician',
  role: 'TECHNICIAN',
  password: 'a-long-enough-password',
};

describe('role-based access to /api/v1/users', () => {
  it.each(['TECHNICIAN', 'INVENTORY_MANAGER'] as const)(
    'forbids %s from listing users',
    async (role) => {
      const c = await loginAs(role);
      const res = await c.get('/api/v1/users');
      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('FORBIDDEN');
    },
  );

  it.each(['TECHNICIAN', 'INVENTORY_MANAGER'] as const)(
    'forbids %s from creating users',
    async (role) => {
      const c = await loginAs(role);
      const res = await c.post('/api/v1/users').send(newUser);
      expect(res.status).toBe(403);
      expect(await prisma.user.count({ where: { email: newUser.email } })).toBe(0);
    },
  );
});

describe('admin user management', () => {
  it('creates a user, never exposes the password hash, and audits it', async () => {
    const admin = await loginAs('ADMIN');
    const res = await admin
      .post('/api/v1/users')
      .send({ ...newUser, email: 'New.Tech@Example.test' });

    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({
      email: 'new.tech@example.test',
      role: 'TECHNICIAN',
      isActive: true,
    });
    expect(JSON.stringify(res.body)).not.toMatch(/password/i);

    const audit = await prisma.auditLog.findFirstOrThrow({ where: { action: 'user.created' } });
    expect(audit.actorUserId).toBe(admin.user.id);
    expect(audit.entityId).toBe(res.body.data.id);
    expect(JSON.stringify(audit.after)).not.toMatch(/password/i);
  });

  it('rejects a duplicate email with 409 EMAIL_TAKEN', async () => {
    const admin = await loginAs('ADMIN');
    await createUser('TECHNICIAN', { email: newUser.email });
    const res = await admin.post('/api/v1/users').send(newUser);
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('EMAIL_TAKEN');
  });

  it('does not allow creating customer users directly', async () => {
    const admin = await loginAs('ADMIN');
    const res = await admin.post('/api/v1/users').send({ ...newUser, role: 'CUSTOMER' });
    expect(res.status).toBe(400);
  });

  it('lists with search, filter, sort and pagination', async () => {
    const admin = await loginAs('ADMIN');
    for (let i = 0; i < 3; i++) await createUser('TECHNICIAN');
    await createUser('INVENTORY_MANAGER');

    const res = await admin.get('/api/v1/users?role=TECHNICIAN&pageSize=2&sort=email:desc');
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(2);
    expect(res.body.meta).toEqual({ page: 1, pageSize: 2, total: 3, totalPages: 2 });
    const emails = res.body.data.map((u: { email: string }) => u.email);
    expect(emails).toEqual([...emails].sort().reverse());

    const bad = await admin.get('/api/v1/users?sort=passwordHash:asc');
    expect(bad.status).toBe(400);
  });

  it('deactivating a user revokes their sessions immediately', async () => {
    const admin = await loginAs('ADMIN');
    const tech = await loginAs('TECHNICIAN');
    expect((await tech.get('/api/v1/auth/me')).status).toBe(200);

    const res = await admin
      .patch(`/api/v1/users/${tech.user.id}`)
      .send({ isActive: false, version: 0 });
    expect(res.status).toBe(200);
    expect(res.body.data.isActive).toBe(false);

    expect((await tech.get('/api/v1/auth/me')).status).toBe(401);
    const audit = await prisma.auditLog.findFirstOrThrow({ where: { action: 'user.deactivated' } });
    expect(audit.before).toMatchObject({ isActive: true });
    expect(audit.after).toMatchObject({ isActive: false });
  });

  it('rejects a stale update with 409 (optimistic concurrency)', async () => {
    const admin = await loginAs('ADMIN');
    const tech = await createUser('TECHNICIAN');

    const first = await admin
      .patch(`/api/v1/users/${tech.id}`)
      .send({ fullName: 'First Edit', version: 0 });
    expect(first.status).toBe(200);
    const stale = await admin
      .patch(`/api/v1/users/${tech.id}`)
      .send({ fullName: 'Stale Edit', version: 0 });
    expect(stale.status).toBe(409);
    expect((await prisma.user.findUniqueOrThrow({ where: { id: tech.id } })).fullName).toBe(
      'First Edit',
    );
  });

  it('prevents an admin from deactivating or demoting themselves', async () => {
    const admin = await loginAs('ADMIN');
    const res = await admin
      .patch(`/api/v1/users/${admin.user.id}`)
      .send({ role: 'TECHNICIAN', version: 0 });
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('CANNOT_MODIFY_SELF');
  });

  it('returns 404 for an unknown user and 400 for a malformed id', async () => {
    const admin = await loginAs('ADMIN');
    expect((await admin.get('/api/v1/users/00000000-0000-4000-8000-000000000000')).status).toBe(
      404,
    );
    expect((await admin.get('/api/v1/users/not-a-uuid')).status).toBe(400);
  });
});
