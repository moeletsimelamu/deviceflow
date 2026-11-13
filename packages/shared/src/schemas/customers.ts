import { z } from 'zod';
import { emailSchema, newPasswordSchema } from './auth.js';
import { paginationSchema, sortSchema } from './common.js';
import { hasChanges, optionalEmail, optionalPhone, optionalText, versionField } from './fields.js';

export const CUSTOMER_TYPES = ['INDIVIDUAL', 'ORGANISATION'] as const;
export type CustomerType = (typeof CUSTOMER_TYPES)[number];

export const CUSTOMER_TYPE_LABELS: Record<CustomerType, string> = {
  INDIVIDUAL: 'Individual',
  ORGANISATION: 'Organisation',
};

const customerFields = {
  type: z.enum(CUSTOMER_TYPES),
  name: z.string().trim().min(1, 'Enter a name').max(160),
  email: optionalEmail,
  phone: optionalPhone,
  vatNumber: optionalText(32),
  addressLine1: optionalText(160),
  addressLine2: optionalText(160),
  city: optionalText(80),
  region: optionalText(80),
  postalCode: optionalText(16),
  notes: optionalText(2000),
};

export const createCustomerSchema = z.object(customerFields);
export type CreateCustomerInput = z.infer<typeof createCustomerSchema>;

/** `isActive: false` archives the account; `true` restores it. */
export const updateCustomerSchema = z
  .object(customerFields)
  .partial()
  .extend({ isActive: z.boolean().optional(), version: versionField })
  .refine(hasChanges, { message: 'Provide at least one field to change' });
export type UpdateCustomerInput = z.infer<typeof updateCustomerSchema>;

export const CUSTOMER_SORT_FIELDS = ['name', 'accountNumber', 'createdAt'] as const;

export const listCustomersQuerySchema = paginationSchema.extend({
  search: z.string().trim().max(100).optional(),
  type: z.enum(CUSTOMER_TYPES).optional(),
  isActive: z.stringbool().optional(),
  sort: sortSchema(CUSTOMER_SORT_FIELDS, 'name:asc'),
});
export type ListCustomersQuery = z.infer<typeof listCustomersQuerySchema>;

/** The minimum other records show about a customer (e.g. an asset's owner). */
export const customerSummarySchema = z.object({
  id: z.uuid(),
  accountNumber: z.string(),
  name: z.string(),
  type: z.enum(CUSTOMER_TYPES),
  isActive: z.boolean(),
});
export type CustomerSummary = z.infer<typeof customerSummarySchema>;

export const customerSchema = customerSummarySchema.extend({
  email: z.string().nullable(),
  phone: z.string().nullable(),
  vatNumber: z.string().nullable(),
  addressLine1: z.string().nullable(),
  addressLine2: z.string().nullable(),
  city: z.string().nullable(),
  region: z.string().nullable(),
  postalCode: z.string().nullable(),
  notes: z.string().nullable(),
  assetCount: z.number().int(),
  createdAt: z.string(),
  updatedAt: z.string(),
  version: z.number().int(),
});
export type Customer = z.infer<typeof customerSchema>;

// --- Contacts ----------------------------------------------------------------

const contactFields = {
  fullName: z.string().trim().min(1, 'Enter a name').max(120),
  email: optionalEmail,
  phone: optionalPhone,
  jobTitle: optionalText(120),
};

/** Making a contact primary demotes the account's previous primary contact. */
export const createContactSchema = z.object({
  ...contactFields,
  isPrimary: z.boolean().default(false),
});
export type CreateContactInput = z.infer<typeof createContactSchema>;

export const updateContactSchema = z
  .object(contactFields)
  .partial()
  .extend({ isPrimary: z.boolean().optional(), version: versionField })
  .refine(hasChanges, { message: 'Provide at least one field to change' });
export type UpdateContactInput = z.infer<typeof updateContactSchema>;

export const contactSchema = z.object({
  id: z.uuid(),
  customerAccountId: z.uuid(),
  fullName: z.string(),
  email: z.string().nullable(),
  phone: z.string().nullable(),
  jobTitle: z.string().nullable(),
  isPrimary: z.boolean(),
  createdAt: z.string(),
  updatedAt: z.string(),
  version: z.number().int(),
});
export type Contact = z.infer<typeof contactSchema>;

export const contactParamsSchema = z.object({ id: z.uuid(), contactId: z.uuid() });

// --- Portal users ------------------------------------------------------------

/** A sign-in for the customer portal, always tied to one customer account (decision D4). */
export const createCustomerUserSchema = z.object({
  email: emailSchema,
  fullName: z.string().trim().min(1, 'Enter a name').max(120),
  password: newPasswordSchema,
});
export type CreateCustomerUserInput = z.infer<typeof createCustomerUserSchema>;
