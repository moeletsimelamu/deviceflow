import type { Router } from 'express';
import { beforeAll, describe, expect, it } from 'vitest';
import type { Role } from '@deviceflow/shared';
import { documentedOperations } from '../../src/http/openapi.js';
import { app, client, createCustomerAccount, loginAs, resetDatabase } from '../helpers/db.js';

/*
 * Authorisation matrix (Phase 7).
 *
 * Every API operation, called by every kind of caller: signed out, administrator,
 * technician, inventory manager and customer. The expected access is written out
 * by hand below, one line per operation, instead of being worked out from
 * ROLE_PERMISSIONS, so a wrong permission on a route or a wrong grant in roles.ts
 * makes this test fail rather than agree with itself.
 *
 *   - A caller who may not use the operation gets 401 (signed out) or 403.
 *   - A caller who may use it gets past the permission check. Ids are random, so
 *     the answer is usually 404 or 400, but never 401 or 403.
 *
 * Record-level rules (a technician's own jobs, a customer's own account) are
 * tested in each module's own tests; this file is about the permission layer.
 */

type Access = 'public' | 'signed-in' | string;

const A = 'ADMIN';
const T = 'TECHNICIAN';
const I = 'INVENTORY_MANAGER';
const C = 'CUSTOMER';

/** Operation → who may call it ('public', 'signed-in', or the roles, space-separated). */
const MATRIX: Record<string, Access> = {
  'POST /auth/login': 'public',
  'POST /auth/logout': 'signed-in',
  'GET /auth/me': 'signed-in',

  'GET /users': A,
  'GET /users/{id}': A,
  'POST /users': A,
  'PATCH /users/{id}': A,

  'GET /settings': `${A} ${T} ${I}`,
  'PATCH /settings': A,

  'GET /customers': A,
  'GET /customers/lookup': A,
  'GET /customers/{id}': A,
  'POST /customers': A,
  'PATCH /customers/{id}': A,
  'GET /customers/{id}/contacts': A,
  'POST /customers/{id}/contacts': A,
  'PATCH /customers/{id}/contacts/{contactId}': A,
  'DELETE /customers/{id}/contacts/{contactId}': A,
  'GET /customers/{id}/users': A,
  'POST /customers/{id}/users': A,

  'GET /assets': `${A} ${T} ${I}`,
  'GET /assets/export.csv': A,
  'GET /assets/{id}': `${A} ${T} ${I}`,
  'GET /assets/{id}/events': `${A} ${T} ${I}`,
  'POST /assets': A,
  'PATCH /assets/{id}': A,
  'POST /assets/{id}/status': A,

  'GET /repairs': `${A} ${T} ${I}`,
  'GET /repairs/technicians': A,
  'POST /repairs': A,
  'GET /repairs/{id}': `${A} ${T} ${I}`,
  'GET /repairs/{id}/history': `${A} ${T} ${I}`,
  'POST /repairs/{id}/assign': A,
  'POST /repairs/{id}/transitions': `${A} ${T}`,
  'GET /repairs/{id}/notes': `${A} ${T}`,
  'POST /repairs/{id}/notes': `${A} ${T}`,
  'GET /repairs/{id}/labour': `${A} ${T}`,
  'POST /repairs/{id}/labour': `${A} ${T}`,
  'DELETE /repairs/{id}/labour/{entryId}': `${A} ${T}`,
  'GET /repairs/{id}/quotes': `${A} ${T}`,
  'POST /repairs/{id}/quotes': `${A} ${T}`,
  'PATCH /repairs/{id}/quotes/{quoteId}': `${A} ${T}`,
  'DELETE /repairs/{id}/quotes/{quoteId}': `${A} ${T}`,
  'POST /repairs/{id}/quotes/{quoteId}/issue': `${A} ${T}`,
  'POST /repairs/{id}/quotes/{quoteId}/approve': A,
  'POST /repairs/{id}/quotes/{quoteId}/reject': A,
  'GET /repairs/{id}/parts': `${A} ${T} ${I}`,
  'POST /repairs/{id}/parts': `${A} ${T}`,
  'POST /repairs/{id}/parts/returns': `${A} ${T}`,

  'GET /inventory/parts': `${A} ${T} ${I}`,
  'POST /inventory/parts': `${A} ${I}`,
  'GET /inventory/parts/{id}': `${A} ${T} ${I}`,
  'PATCH /inventory/parts/{id}': `${A} ${I}`,
  'GET /inventory/parts/{id}/movements': `${A} ${T} ${I}`,
  'POST /inventory/parts/{id}/purchases': `${A} ${I}`,
  'POST /inventory/parts/{id}/adjustments': `${A} ${I}`,
  'GET /inventory/movements': `${A} ${T} ${I}`,

  'GET /reports/operations': A,
  'GET /reports/inventory': `${A} ${I}`,

  'GET /audit': A,

  'GET /portal/account': C,
  'GET /portal/assets': C,
  'GET /portal/assets/{id}': C,
  'GET /portal/assets/{id}/history': C,
  'GET /portal/repairs': C,
  'POST /portal/repairs': C,
  'GET /portal/repairs/{id}': C,
  'GET /portal/repairs/{id}/timeline': C,
  'GET /portal/repairs/{id}/quotes': C,
  'POST /portal/repairs/{id}/cancel': C,
  'POST /portal/repairs/{id}/quotes/{quoteId}/approve': C,
  'POST /portal/repairs/{id}/quotes/{quoteId}/reject': C,
};

/** Routes that exist but are not API operations in the description. */
const UNDOCUMENTED_ROUTES = [
  'GET /api/v1/openapi.json (the API description itself, public)',
  'GET /health/live (liveness probe, public)',
  'GET /health/ready (readiness probe, public)',
];

const ROLES: Role[] = ['ADMIN', 'TECHNICIAN', 'INVENTORY_MANAGER', 'CUSTOMER'];
type Caller = Role | 'SIGNED_OUT';

function mayCall(access: Access, caller: Caller): boolean {
  if (access === 'public') return true;
  if (caller === 'SIGNED_OUT') return false;
  if (access === 'signed-in') return true;
  return access.split(' ').includes(caller);
}

/** Counts the method handlers mounted in an Express router, recursively. */
function countRoutes(router: Router): number {
  let count = 0;
  for (const layer of router.stack) {
    if (layer.route) {
      // A route with several methods would count once per method.
      const methods = (layer.route as unknown as { methods: Record<string, boolean> }).methods;
      count += Object.keys(methods).filter((m) => m !== '_all').length;
    } else if (
      typeof layer.handle === 'function' &&
      'stack' in layer.handle &&
      Array.isArray((layer.handle as unknown as Router).stack)
    ) {
      count += countRoutes(layer.handle as unknown as Router);
    }
  }
  return count;
}

type Session = ReturnType<typeof client>;
const sessions = new Map<Caller, Session>();

beforeAll(async () => {
  await resetDatabase();
  sessions.set('SIGNED_OUT', client());
  const account = await createCustomerAccount();
  for (const role of ROLES) {
    sessions.set(
      role,
      await loginAs(role, role === 'CUSTOMER' ? { customerAccountId: account.id } : {}),
    );
  }
});

function call(session: Session, operation: string) {
  const [method, path] = operation.split(' ') as [string, string];
  const url = '/api/v1' + path.replace(/\{[^}]+\}/g, () => crypto.randomUUID());
  switch (method) {
    case 'GET':
      return session.get(url);
    case 'POST':
      return session.post(url).send({});
    case 'PATCH':
      return session.patch(url).send({});
    case 'DELETE':
      return session.delete(url);
    default:
      throw new Error(`Unexpected method in ${operation}`);
  }
}

describe('authorisation matrix', () => {
  it('has a line for every documented operation, and no others', () => {
    expect(Object.keys(MATRIX).sort()).toEqual([...documentedOperations()].sort());
  });

  it('covers every route the server mounts', () => {
    // Every documented operation is a real route (audit.test.ts checks this), so if
    // the counts match, no route exists that is missing from the description and
    // therefore from this matrix.
    const mounted = countRoutes((app as unknown as { router: Router }).router);
    expect(mounted).toBe(documentedOperations().length + UNDOCUMENTED_ROUTES.length);
  });

  const callers: Caller[] = ['SIGNED_OUT', ...ROLES];
  for (const operation of Object.keys(MATRIX)) {
    // Sign-in is checked separately: calling it would sign the caller out.
    if (operation === 'POST /auth/login' || operation === 'POST /auth/logout') continue;

    it(operation, async () => {
      const access = MATRIX[operation]!;
      const outcome: Record<string, number> = {};
      const expected: Record<string, number | 'allowed'> = {};
      for (const caller of callers) {
        const res = await call(sessions.get(caller)!, operation);
        const allowed = mayCall(access, caller);
        outcome[caller] = allowed && res.status !== 401 && res.status !== 403 ? -1 : res.status;
        expected[caller] = allowed ? -1 : caller === 'SIGNED_OUT' ? 401 : 403;
        if (!allowed) {
          expect(res.body.error.code, `${caller} ${operation}`).toBe(
            caller === 'SIGNED_OUT' ? 'UNAUTHENTICATED' : 'FORBIDDEN',
          );
          // A refusal says nothing about the record.
          expect(Object.keys(res.body)).toEqual(['error']);
        }
      }
      // -1 stands for "got past the permission check".
      expect(outcome).toEqual(expected);
    });
  }

  it('lets anyone reach sign-in, and only signed-in callers sign out', async () => {
    const res = await client().post('/api/v1/auth/login').send({});
    expect(res.status).toBe(400);
    expect((await client().post('/api/v1/auth/logout').send({})).status).toBe(401);
    const admin = await loginAs('ADMIN');
    expect((await admin.post('/api/v1/auth/logout').send({})).status).toBe(204);
    expect((await admin.get('/api/v1/auth/me')).status).toBe(401);
  });
});
