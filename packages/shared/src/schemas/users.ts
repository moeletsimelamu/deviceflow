import { z } from 'zod';
import { ROLES } from '../roles.js';
import { emailSchema, newPasswordSchema } from './auth.js';
import { paginationSchema, sortSchema } from './common.js';

const fullNameSchema = z.string().trim().min(1, 'Enter a name').max(120);

/**
 * Staff accounts only. Customer logins are created from a customer account
 * (Phase 3) so that every customer user is tied to exactly one account.
 */
export const STAFF_ROLE_OPTIONS = ['ADMIN', 'TECHNICIAN', 'INVENTORY_MANAGER'] as const;

export const createUserSchema = z.object({
  email: emailSchema,
  fullName: fullNameSchema,
  role: z.enum(STAFF_ROLE_OPTIONS),
  password: newPasswordSchema,
});
export type CreateUserInput = z.infer<typeof createUserSchema>;

export const updateUserSchema = z
  .object({
    fullName: fullNameSchema.optional(),
    role: z.enum(STAFF_ROLE_OPTIONS).optional(),
    isActive: z.boolean().optional(),
    version: z.number().int().min(0),
  })
  .refine((v) => v.fullName !== undefined || v.role !== undefined || v.isActive !== undefined, {
    message: 'Provide at least one field to change',
  });
export type UpdateUserInput = z.infer<typeof updateUserSchema>;

export const USER_SORT_FIELDS = ['createdAt', 'email', 'fullName', 'role'] as const;

export const listUsersQuerySchema = paginationSchema.extend({
  search: z.string().trim().max(100).optional(),
  role: z.enum(ROLES).optional(),
  isActive: z.stringbool().optional(),
  sort: sortSchema(USER_SORT_FIELDS, 'fullName:asc'),
});
export type ListUsersQuery = z.infer<typeof listUsersQuerySchema>;

export const userSchema = z.object({
  id: z.uuid(),
  email: z.string(),
  fullName: z.string(),
  role: z.enum(ROLES),
  isActive: z.boolean(),
  /** Set only for customer (portal) users. */
  customerAccountId: z.uuid().nullable(),
  lastLoginAt: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
  version: z.number().int(),
});
export type User = z.infer<typeof userSchema>;
