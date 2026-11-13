import type { Actor } from '../lib/context.js';

declare global {
  namespace Express {
    interface Request {
      /** Set by the `authenticate` middleware when a valid session cookie is present. */
      actor?: Actor;
    }
  }
}

export {};
