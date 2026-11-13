import type { ErrorRequestHandler, RequestHandler } from 'express';
import type { ApiErrorBody } from '@deviceflow/shared';
import { AppError } from '../../lib/errors.js';
import { Prisma } from '../../lib/prisma.js';
import { logger } from '../../config/logger.js';

export const notFoundHandler: RequestHandler = (req) => {
  throw new AppError(404, 'NOT_FOUND', `No route for ${req.method} ${req.path}`);
};

function toAppError(err: unknown): AppError | null {
  if (err instanceof AppError) return err;

  // body-parser errors carry a `type` and an HTTP status.
  if (typeof err === 'object' && err !== null && 'type' in err) {
    const type = (err as { type?: string }).type;
    if (type === 'entity.parse.failed') {
      return new AppError(400, 'MALFORMED_REQUEST', 'Request body is not valid JSON');
    }
    if (type === 'entity.too.large') {
      return new AppError(413, 'PAYLOAD_TOO_LARGE', 'Request body is too large');
    }
  }

  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    if (err.code === 'P2002')
      return new AppError(409, 'CONFLICT', 'A record with these details already exists');
    if (err.code === 'P2025') return new AppError(404, 'NOT_FOUND', 'Record not found');
  }

  return null;
}

/**
 * Converts every error into the standard response shape. Expected errors are
 * logged at `info`/`warn`; unexpected ones at `error` with the stack, and the
 * client gets a generic message plus the request ID to quote to support.
 */
export const errorHandler: ErrorRequestHandler = (err, req, res, _next) => {
  const appError = toAppError(err);
  const requestId = String(req.id);

  if (appError) {
    req.log?.[appError.status >= 500 ? 'error' : 'info'](
      { code: appError.code, status: appError.status },
      appError.message,
    );
    const body: ApiErrorBody = {
      error: {
        code: appError.code,
        message: appError.message,
        ...(appError.details ? { details: appError.details } : {}),
        requestId,
      },
    };
    res.status(appError.status).json(body);
    return;
  }

  (req.log ?? logger).error({ err }, 'Unhandled error');
  const body: ApiErrorBody = {
    error: {
      code: 'INTERNAL_ERROR',
      message: 'Something went wrong. Please try again.',
      requestId,
    },
  };
  res.status(500).json(body);
};
