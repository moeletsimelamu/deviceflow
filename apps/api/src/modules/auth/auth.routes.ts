import { Router } from 'express';
import { rateLimit } from 'express-rate-limit';
import { loginSchema, type ApiErrorBody, type SessionUser } from '@deviceflow/shared';
import { env } from '../../config/env.js';
import { parse } from '../../lib/validation.js';
import { requireAuth } from '../../http/middleware/auth.js';
import { actorOf, requestContext } from '../../http/request-context.js';
import * as authService from './auth.service.js';
import { SESSION_COOKIE, sessionCookieOptions } from './session.service.js';

/**
 * Failed logins are limited per client IP (successful ones do not count).
 * The store is in-memory, which is correct for a single API instance; a
 * multi-instance deployment needs a shared store (documented in SECURITY.md).
 */
function createLoginLimiter() {
  return rateLimit({
    windowMs: 15 * 60_000,
    limit: env.LOGIN_RATE_LIMIT_MAX,
    skipSuccessfulRequests: true,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    handler: (req, res) => {
      const body: ApiErrorBody = {
        error: {
          code: 'RATE_LIMITED',
          message: 'Too many failed sign-in attempts. Try again in a few minutes.',
          requestId: String(req.id),
        },
      };
      res.status(429).json(body);
    },
  });
}

/** A factory so every app instance (e.g. each test app) gets its own limiter state. */
export function createAuthRouter() {
  const authRouter = Router();

  authRouter.post('/login', createLoginLimiter(), async (req, res) => {
    const input = parse(loginSchema, req.body);
    const { token, user } = await authService.login(
      input,
      { userAgent: req.get('user-agent') ?? null },
      requestContext(req),
    );
    res.cookie(SESSION_COOKIE, token, sessionCookieOptions());
    res.json({ user } satisfies { user: SessionUser });
  });

  authRouter.post('/logout', requireAuth, async (req, res) => {
    await authService.logout(actorOf(req), requestContext(req));
    const { maxAge: _maxAge, ...clearOptions } = sessionCookieOptions();
    res.clearCookie(SESSION_COOKIE, clearOptions);
    res.status(204).end();
  });

  authRouter.get('/me', requireAuth, (req, res) => {
    const actor = actorOf(req);
    const user: SessionUser = {
      id: actor.userId,
      email: actor.email,
      fullName: actor.fullName,
      role: actor.role,
      customerAccountId: actor.customerAccountId,
    };
    res.json({ user });
  });

  return authRouter;
}
