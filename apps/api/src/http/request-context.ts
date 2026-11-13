import type { Request } from 'express';
import { unauthenticated } from '../lib/errors.js';
import type { Actor, RequestContext } from '../lib/context.js';

export function requestContext(req: Request): RequestContext {
  return { requestId: String(req.id), ipAddress: req.ip ?? null };
}

/** For handlers mounted behind requireAuth/requirePermission. */
export function actorOf(req: Request): Actor {
  if (!req.actor) throw unauthenticated();
  return req.actor;
}
