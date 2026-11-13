import { readFileSync } from 'node:fs';
import { beforeEach, describe, expect, it } from 'vitest';
import { documentedOperations } from '../../src/http/openapi.js';
import { OPENAPI_FILE, renderOpenApiFile } from '../../src/http/openapi-file.js';
import {
  client,
  createAsset,
  createCustomerAccount,
  loginAs,
  resetDatabase,
} from '../helpers/db.js';

beforeEach(resetDatabase);

describe('activity log', () => {
  it('is administrator-only', async () => {
    for (const role of ['TECHNICIAN', 'INVENTORY_MANAGER'] as const) {
      const c = await loginAs(role);
      expect((await c.get('/api/v1/audit')).status).toBe(403);
    }
  });

  it('lists entries newest first with actor names, filtered by asset or customer', async () => {
    const admin = await loginAs('ADMIN');
    const account = await createCustomerAccount();
    const created = await admin.post('/api/v1/assets').send({
      category: 'TABLET',
      manufacturer: 'Apple',
      model: 'iPad (10th generation)',
      serialNumber: 'DMPXK1',
      customerAccountId: account.id,
      status: 'ACTIVE',
    });
    const assetId = created.body.data.id;
    await admin
      .post(`/api/v1/assets/${assetId}/status`)
      .send({ status: 'RETIRED', reason: 'Replaced by a newer model', version: 0 });

    const forAsset = await admin.get(`/api/v1/audit?assetId=${assetId}`);
    expect(forAsset.status).toBe(200);
    expect(forAsset.body.data.map((e: { action: string }) => e.action)).toEqual([
      'asset.status_changed',
      'asset.created',
    ]);
    expect(forAsset.body.data[0].actor).toMatchObject({ id: admin.user.id });

    const forCustomer = await admin.get(`/api/v1/audit?customerAccountId=${account.id}`);
    expect(forCustomer.body.meta.total).toBe(2);

    const byPrefix = await admin.get('/api/v1/audit?action=auth.');
    expect(byPrefix.body.data.every((e: { action: string }) => e.action.startsWith('auth.'))).toBe(
      true,
    );

    const today = new Date().toISOString().slice(0, 10);
    const inRange = await admin.get(`/api/v1/audit?from=${today}&to=${today}`);
    expect(inRange.body.meta.total).toBeGreaterThanOrEqual(3);
    const past = await admin.get('/api/v1/audit?from=2000-01-01&to=2000-01-02');
    expect(past.body.meta.total).toBe(0);
  });
});

describe('API documentation', () => {
  it('serves an OpenAPI 3.1 document without sign-in', async () => {
    const res = await client().get('/api/v1/openapi.json');
    expect(res.status).toBe(200);
    expect(res.body.openapi).toBe('3.1.0');
    expect(res.body.paths['/assets/{id}/status'].post.description).toContain('assets:manage');
  });

  it('documents only routes that exist', async () => {
    // A signed-out request to a real route fails auth or validation, never "No route".
    const c = client();
    for (const op of documentedOperations()) {
      const [method, path] = op.split(' ') as [string, string];
      const url = '/api/v1' + path.replace(/\{[^}]+\}/g, crypto.randomUUID());
      const req =
        method === 'GET'
          ? c.get(url)
          : method === 'POST'
            ? c.post(url)
            : method === 'PATCH'
              ? c.patch(url)
              : c.delete(url);
      const res = await req.send({});
      expect(res.body?.error?.message ?? '', op).not.toMatch(/^No route/);
    }
  });

  it('docs/openapi.json is up to date (run `npm run openapi -w @deviceflow/api`)', () => {
    expect(readFileSync(OPENAPI_FILE, 'utf8').replace(/\r\n/g, '\n')).toBe(renderOpenApiFile());
  });
});

describe('asset events for staff', () => {
  it('include who made each change', async () => {
    const admin = await loginAs('ADMIN');
    const asset = await createAsset(admin.user.id);
    const tech = await loginAs('TECHNICIAN');
    const res = await tech.get(`/api/v1/assets/${asset.id}/events`);
    expect(res.status).toBe(200);
    expect(res.body.data[0]).toMatchObject({ type: 'REGISTERED', actor: { id: admin.user.id } });
  });
});
