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

  it('treats unreadable requests as client errors, not server errors', async () => {
    const admin = await loginAs('ADMIN');
    const cases = [
      // An undecodable %-escape in a path parameter.
      [await admin.get('/api/v1/assets/%E0%A4%A'), 400, 'MALFORMED_REQUEST'],
      [await admin.get('/api/v1/assets/%'), 400, 'MALFORMED_REQUEST'],
      // A body that claims to be compressed but is not.
      [
        await admin
          .post('/api/v1/customers')
          .set('Content-Type', 'application/json')
          .set('Content-Encoding', 'gzip')
          .send('{"name":"A"}'),
        400,
        'MALFORMED_REQUEST',
      ],
      // Encodings the API does not accept.
      [
        await admin
          .post('/api/v1/customers')
          .set('Content-Type', 'application/json')
          .set('Content-Encoding', 'compress')
          .send('{"name":"A"}'),
        415,
        'UNSUPPORTED_MEDIA_TYPE',
      ],
      [
        await admin
          .post('/api/v1/customers')
          .set('Content-Type', 'application/json; charset=latin1')
          .send('{"name":"A"}'),
        415,
        'UNSUPPORTED_MEDIA_TYPE',
      ],
    ] as const;
    for (const [res, status, code] of cases) {
      expect(res.status).toBe(status);
      expect(res.body.error.code).toBe(code);
      // The library's own message (which can quote internals) is not passed on.
      expect(res.body.error.message).not.toMatch(/decode|zlib|incorrect header|charset "/i);
      expect(res.body.error.requestId).toEqual(expect.any(String));
    }
  });

  it('rejects bodies that are not a JSON object, and over-large bodies', async () => {
    const admin = await loginAs('ADMIN');
    for (const body of ['[]', '"text"', '42']) {
      const res = await admin
        .post('/api/v1/customers')
        .set('Content-Type', 'application/json')
        .send(body);
      expect(res.status, body).toBe(400);
    }
    const huge = await admin.post('/api/v1/customers').send({ name: 'x'.repeat(200_000) });
    expect(huge.status).toBe(413);
    expect(huge.body.error.code).toBe('PAYLOAD_TOO_LARGE');
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
