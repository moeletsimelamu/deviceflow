import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '../../src/lib/prisma.js';
import { app, client, loginAs, resetDatabase } from '../helpers/db.js';

beforeEach(resetDatabase);

describe('health checks', () => {
  it('reports liveness and database readiness', async () => {
    expect((await request(app).get('/health/live')).body).toEqual({ status: 'ok' });
    expect((await request(app).get('/health/ready')).body).toEqual({
      status: 'ok',
      database: 'ok',
    });
  });
});

describe('error handling', () => {
  it('returns the standard error shape for unknown routes', async () => {
    const res = await request(app).get('/api/v1/nope');
    expect(res.status).toBe(404);
    expect(res.body.error).toMatchObject({ code: 'NOT_FOUND' });
  });

  it('returns 400 for malformed JSON', async () => {
    const res = await client()
      .post('/api/v1/auth/login')
      .set('Content-Type', 'application/json')
      .send('{"email": ');
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('MALFORMED_REQUEST');
  });

  it('propagates a request ID header and echoes it in errors', async () => {
    const res = await request(app).get('/api/v1/auth/me').set('X-Request-Id', 'trace-abc-12345');
    expect(res.headers['x-request-id']).toBe('trace-abc-12345');
    expect(res.body.error.requestId).toBe('trace-abc-12345');
  });

  it('sets security headers and disables caching of API responses', async () => {
    const res = await request(app).get('/api/v1/auth/me');
    expect(res.headers['x-powered-by']).toBeUndefined();
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['cache-control']).toBe('no-store');
  });
});

describe('company settings', () => {
  it('defaults to ZAR with 15% VAT', async () => {
    const tech = await loginAs('TECHNICIAN');
    const res = await tech.get('/api/v1/settings');
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ currency: 'ZAR', vatRateBasisPoints: 1500 });
  });

  it('only administrators can change settings, and changes are audited', async () => {
    const tech = await loginAs('TECHNICIAN');
    expect(
      (await tech.patch('/api/v1/settings').send({ vatRateBasisPoints: 0, version: 0 })).status,
    ).toBe(403);

    const admin = await loginAs('ADMIN');
    const res = await admin
      .patch('/api/v1/settings')
      .send({ companyName: 'Acme Repairs', version: 0 });
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ companyName: 'Acme Repairs', version: 1 });
    expect(await prisma.auditLog.count({ where: { action: 'settings.updated' } })).toBe(1);
  });
});

describe('database guarantees', () => {
  it('audit log rows cannot be updated or deleted', async () => {
    await loginAs('ADMIN'); // writes an auth.login audit row
    await expect(
      prisma.$executeRawUnsafe('UPDATE "audit_logs" SET "action" = \'tampered\''),
    ).rejects.toThrow(/append-only/);
    await expect(prisma.$executeRawUnsafe('DELETE FROM "audit_logs"')).rejects.toThrow(
      /append-only/,
    );
  });

  it('only one company settings row can exist', async () => {
    await expect(
      prisma.$executeRawUnsafe(
        `INSERT INTO "company_settings" ("id","company_name","updated_at") VALUES (2,'x',now())`,
      ),
    ).rejects.toThrow();
  });
});
