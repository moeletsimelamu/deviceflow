import type { RequestHandler } from 'express';
import { hasPermission, type Permission, type Role } from '@deviceflow/shared';
import { forbidden, unauthenticated } from '../../lib/errors.js';
import { resolveSession, SESSION_COOKIE } from '../../modules/auth/session.service.js';

/** Loads the session (if any) and sets `req.actor`. Never rejects on its own. */
export const authenticate: RequestHandler = async (req, _res, next) => {
  const token: unknown = req.cookies?.[SESSION_COOKIE];
  if (typeof token === 'string' && token.length > 0 && token.length < 200) {
    const actor = await resolveSession(token);
    if (actor) req.actor = actor;
  }
  next();
};

export const requireAuth: RequestHandler = (req, _res, next) => {
  if (!req.actor) throw unauthenticated();
  next();
};

/** Requires an authenticated actor whose role grants the permission. */
export function requirePermission(permission: Permission): RequestHandler {
  return (req, _res, next) => {
    if (!req.actor) throw unauthenticated();
    if (!hasPermission(req.actor.role, permission)) throw forbidden();
    next();
  };
}

export function requireRole(...roles: Role[]): RequestHandler {
  return (req, _res, next) => {
    if (!req.actor) throw unauthenticated();
    if (!roles.includes(req.actor.role)) throw forbidden();
    next();
  };
}
