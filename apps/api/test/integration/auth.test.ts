import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../../src/http/app.js';
import { prisma } from '../../src/lib/prisma.js';
import { app, client, createUser, loginAs, resetDatabase, TEST_PASSWORD } from '../helpers/db.js';

beforeEach(resetDatabase);

describe('POST /api/v1/auth/login', () => {
  it('opens a session with an httpOnly cookie and returns the user', async () => {
    const user = await createUser('ADMIN', { email: 'admin@example.test' });
    const c = client();

    const res = await c
      .post('/api/v1/auth/login')
      .send({ email: ' ADMIN@example.test ', password: TEST_PASSWORD });

    expect(res.status).toBe(200);
    expect(res.body.user).toEqual({
      id: user.id,
      email: user.email,
      fullName: user.fullName,
      role: 'ADMIN',
      customerAccountId: null,
    });
    expect(res.body.user.passwordHash).toBeUndefined();
    const cookie = String(res.headers['set-cookie']);
    expect(cookie).toMatch(/df_session=/);
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/SameSite=Lax/i);

    const me = await c.get('/api/v1/auth/me');
    expect(me.status).toBe(200);
    expect(me.body.user.id).toBe(user.id);
  });

  it('stores only a hash of the session token', async () => {
    const { agent } = await loginAs('TECHNICIAN');
    const session = await prisma.session.findFirstOrThrow();
    const cookies = (await agent.get('/api/v1/auth/me')).request.cookies as unknown as string;
    expect(session.tokenHash).toHaveLength(64);
    expect(String(cookies)).not.toContain(session.tokenHash);
  });

  it('gives the same error for an unknown email, a wrong password and a deactivated user', async () => {
    await createUser('ADMIN', { email: 'known@example.test' });
    await createUser('ADMIN', { email: 'inactive@example.test', isActive: false });
    const c = client();

    const responses = await Promise.all([
      c.post('/api/v1/auth/login').send({ email: 'nobody@example.test', password: TEST_PASSWORD }),
      c
        .post('/api/v1/auth/login')
        .send({ email: 'known@example.test', password: 'wrong-password' }),
      c
        .post('/api/v1/auth/login')
        .send({ email: 'inactive@example.test', password: TEST_PASSWORD }),
    ]);

    for (const res of responses) {
      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe('INVALID_CREDENTIALS');
      expect(res.body.error.message).toBe('Email or password is incorrect');
    }
  });

  it('rejects malformed input with field details', async () => {
    const res = await client().post('/api/v1/auth/login').send({ email: 'not-an-email' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_FAILED');
    expect(res.body.error.details.map((d: { path: string }) => d.path)).toEqual(
      expect.arrayContaining(['email', 'password']),
    );
    expect(res.body.error.requestId).toBeTruthy();
  });

  it('rate-limits repeated failed attempts', async () => {
    // A separate app instance so the exhausted limit does not affect other tests.
    const agent = request.agent(createApp());
    const c = {
      post: (url: string) =>
        agent
          .post(url)
          .set('X-Requested-With', 'DeviceFlow')
          .set('Origin', 'http://localhost:5173'),
    };
    // LOGIN_RATE_LIMIT_MAX is 5 in the test environment.
    for (let i = 0; i < 5; i++) {
      await c.post('/api/v1/auth/login').send({ email: 'x@example.test', password: 'wrong' });
    }
    const res = await c
      .post('/api/v1/auth/login')
      .send({ email: 'x@example.test', password: 'wrong' });
    expect(res.status).toBe(429);
    expect(res.body.error.code).toBe('RATE_LIMITED');
  });
});

describe('sessions', () => {
  it('rejects requests without a session', async () => {
    const res = await request(app).get('/api/v1/auth/me');
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('UNAUTHENTICATED');
  });

  it('logout revokes the session server-side', async () => {
    const c = await loginAs('ADMIN');
    expect((await c.post('/api/v1/auth/logout')).status).toBe(204);
    expect((await c.get('/api/v1/auth/me')).status).toBe(401);
    expect(await prisma.session.count()).toBe(0);
  });

  it('expires a session that has been idle too long', async () => {
    const c = await loginAs('ADMIN');
    await prisma.session.updateMany({
      data: { lastSeenAt: new Date(Date.now() - 24 * 3_600_000) },
    });
    expect((await c.get('/api/v1/auth/me')).status).toBe(401);
  });

  it('writes audit entries for login and logout', async () => {
    const c = await loginAs('ADMIN');
    await c.post('/api/v1/auth/logout');
    const actions = (await prisma.auditLog.findMany({ orderBy: { createdAt: 'asc' } })).map(
      (a) => a.action,
    );
    expect(actions).toEqual(['auth.login', 'auth.logout']);
  });
});

describe('CSRF protection', () => {
  it('rejects state-changing requests without the client header', async () => {
    const res = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: 'a@example.test', password: TEST_PASSWORD });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('CSRF_REJECTED');
  });

  it('rejects requests from an origin that is not allowed', async () => {
    const res = await request(app)
      .post('/api/v1/auth/login')
      .set('X-Requested-With', 'DeviceFlow')
      .set('Origin', 'https://evil.example')
      .send({ email: 'a@example.test', password: TEST_PASSWORD });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('CSRF_REJECTED');
  });
});
