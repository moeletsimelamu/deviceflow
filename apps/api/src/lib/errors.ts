import type { ErrorCode } from '@deviceflow/shared';

/**
 * An expected, client-facing error. Services throw these; the error middleware
 * turns them into the standard `{ error: { code, message, … } }` response.
 * Anything that is not an AppError is treated as an unexpected 500.
 */
export class AppError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: ErrorCode,
    message: string,
    public readonly details?: Array<{ path: string; message: string }>,
  ) {
    super(message);
    this.name = 'AppError';
  }
}

export const unauthenticated = (message = 'Sign in to continue') =>
  new AppError(401, 'UNAUTHENTICATED', message);

export const forbidden = (message = 'You do not have permission to do this') =>
  new AppError(403, 'FORBIDDEN', message);

export const notFound = (entity = 'Record') =>
  new AppError(404, 'NOT_FOUND', `${entity} not found`);

export const conflict = (
  message = 'This record was changed by someone else. Reload and try again.',
) => new AppError(409, 'CONFLICT', message);
