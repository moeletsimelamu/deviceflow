import type { RequestHandler } from 'express';
import { env } from '../../config/env.js';
import { AppError } from '../../lib/errors.js';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);
export const CLIENT_HEADER = 'x-requested-with';

/**
 * CSRF defence for cookie-authenticated, state-changing requests:
 *  1. The session cookie is SameSite=Lax (blocks most cross-site sends).
 *  2. A custom header is required. Browsers cannot attach custom headers to a
 *     cross-site form post, and cross-origin fetch would need a CORS preflight,
 *     which this API never approves (no CORS is enabled).
 *  3. If the browser sent an Origin header, it must be on the allow-list.
 */
export const csrfProtection: RequestHandler = (req, _res, next) => {
  if (SAFE_METHODS.has(req.method)) return next();

  if (!req.get(CLIENT_HEADER)) {
    throw new AppError(403, 'CSRF_REJECTED', 'Missing required request header');
  }

  const origin = req.get('origin');
  if (origin && !env.ALLOWED_ORIGINS.includes(origin)) {
    throw new AppError(403, 'CSRF_REJECTED', 'Request origin is not allowed');
  }

  next();
};
