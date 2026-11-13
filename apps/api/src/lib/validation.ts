import type { z } from 'zod';
import { AppError } from './errors.js';

/**
 * Parses untrusted input with a zod schema and throws a 400 with field-level
 * details on failure. Used by route handlers for body, query and params.
 * (Express 5 makes `req.query` read-only, so we parse into a local value
 * rather than mutating the request.)
 */
export function parse<S extends z.ZodType>(schema: S, input: unknown): z.infer<S> {
  const result = schema.safeParse(input);
  if (!result.success) {
    throw new AppError(
      400,
      'VALIDATION_FAILED',
      'Some fields are invalid',
      result.error.issues.map((issue) => ({
        path: issue.path.join('.'),
        message: issue.message,
      })),
    );
  }
  return result.data;
}
