import { z } from 'zod';
import { ROLES } from '../roles.js';

export const PASSWORD_MIN_LENGTH = 12;
export const PASSWORD_MAX_LENGTH = 128;

export const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .pipe(z.email({ message: 'Enter a valid email address' }).max(254));

export const newPasswordSchema = z
  .string()
  .min(PASSWORD_MIN_LENGTH, `Password must be at least ${PASSWORD_MIN_LENGTH} characters`)
  .max(PASSWORD_MAX_LENGTH, `Password must be at most ${PASSWORD_MAX_LENGTH} characters`);

export const loginSchema = z.object({
  email: emailSchema,
  // Do not apply the new-password policy at login: older passwords must still work.
  password: z.string().min(1, 'Enter your password').max(PASSWORD_MAX_LENGTH),
});
export type LoginInput = z.infer<typeof loginSchema>;

/** The authenticated user as returned by `/auth/me` and `/auth/login`. */
export const sessionUserSchema = z.object({
  id: z.uuid(),
  email: z.string(),
  fullName: z.string(),
  role: z.enum(ROLES),
  /** Set only for customer (portal) users. */
  customerAccountId: z.uuid().nullable(),
});
export type SessionUser = z.infer<typeof sessionUserSchema>;
