import { z } from 'zod';
import * as s from '@deviceflow/shared';

/**
 * OpenAPI 3.1 description of the API, generated from the same Zod schemas that
 * validate requests, so the documentation cannot drift from the validation.
 * Served at GET /api/v1/openapi.json and written to docs/openapi.json by
 * `npm run openapi -w @deviceflow/api` (a test fails if the committed file is stale).
 *
 * Every operation is listed here by hand together with the permission it needs;
 * test/integration/openapi.test.ts checks the list against the mounted routes.
 */

type JsonSchema = Record<string, unknown>;

interface Operation {
  method: 'get' | 'post' | 'patch' | 'delete';
  path: string;
  tag: string;
  summary: string;
  /** Permission required, or "public" / "signed-in". */
  access: s.Permission | 'public' | 'signed-in';
  params?: z.ZodObject;
  query?: z.ZodObject;
  body?: z.ZodType;
  /** Response body: a schema wrapped as { data }, a paginated list, or none (204). */
  response?: { data: z.ZodType } | { page: z.ZodType } | { raw: JsonSchema } | 'none';
  status?: number;
  errors?: number[];
}

const idParams = s.uuidParamSchema;

const OPERATIONS: Operation[] = [
  // Auth
  {
    method: 'post',
    path: '/auth/login',
    tag: 'Auth',
    summary: 'Sign in; sets the session cookie',
    access: 'public',
    body: s.loginSchema,
    response: { raw: { type: 'object', properties: { user: schemaOf(s.sessionUserSchema) } } },
    errors: [400, 401, 429],
  },
  {
    method: 'post',
    path: '/auth/logout',
    tag: 'Auth',
    summary: 'Sign out and revoke the session',
    access: 'signed-in',
    response: 'none',
    status: 204,
  },
  {
    method: 'get',
    path: '/auth/me',
    tag: 'Auth',
    summary: 'The signed-in user',
    access: 'signed-in',
    response: { raw: { type: 'object', properties: { user: schemaOf(s.sessionUserSchema) } } },
  },
  // Users
  {
    method: 'get',
    path: '/users',
    tag: 'Users',
    summary: 'List users',
    access: 'users:read',
    query: s.listUsersQuerySchema,
    response: { page: s.userSchema },
  },
  {
    method: 'get',
    path: '/users/{id}',
    tag: 'Users',
    summary: 'Get a user',
    access: 'users:read',
    params: idParams,
    response: { data: s.userSchema },
    errors: [404],
  },
  {
    method: 'post',
    path: '/users',
    tag: 'Users',
    summary: 'Create a staff user',
    access: 'users:manage',
    body: s.createUserSchema,
    response: { data: s.userSchema },
    status: 201,
    errors: [400, 409],
  },
  {
    method: 'patch',
    path: '/users/{id}',
    tag: 'Users',
    summary: 'Update, deactivate or reactivate a user',
    access: 'users:manage',
    params: idParams,
    body: s.updateUserSchema,
    response: { data: s.userSchema },
    errors: [400, 404, 409, 422],
  },
  // Settings
  {
    method: 'get',
    path: '/settings',
    tag: 'Settings',
    summary: 'Company settings',
    access: 'settings:read',
    response: { data: s.companySettingsSchema },
  },
  {
    method: 'patch',
    path: '/settings',
    tag: 'Settings',
    summary: 'Update company settings',
    access: 'settings:manage',
    body: s.updateCompanySettingsSchema,
    response: { data: s.companySettingsSchema },
    errors: [400, 409],
  },
  // Customers
  {
    method: 'get',
    path: '/customers',
    tag: 'Customers',
    summary: 'List customer accounts',
    access: 'customers:read',
    query: s.listCustomersQuerySchema,
    response: { page: s.customerSchema },
  },
  {
    method: 'get',
    path: '/customers/lookup',
    tag: 'Customers',
    summary: 'Find active customer accounts for a picker (max 20)',
    access: 'customers:read',
    query: z.object({ search: z.string().max(100).optional() }),
    response: { data: z.array(s.customerSummarySchema) },
  },
  {
    method: 'get',
    path: '/customers/{id}',
    tag: 'Customers',
    summary: 'Get a customer account',
    access: 'customers:read',
    params: idParams,
    response: { data: s.customerSchema },
    errors: [404],
  },
  {
    method: 'post',
    path: '/customers',
    tag: 'Customers',
    summary: 'Create a customer account',
    access: 'customers:manage',
    body: s.createCustomerSchema,
    response: { data: s.customerSchema },
    status: 201,
    errors: [400],
  },
  {
    method: 'patch',
    path: '/customers/{id}',
    tag: 'Customers',
    summary: 'Update, archive (isActive=false) or restore a customer account',
    access: 'customers:manage',
    params: idParams,
    body: s.updateCustomerSchema,
    response: { data: s.customerSchema },
    errors: [400, 404, 409],
  },
  {
    method: 'get',
    path: '/customers/{id}/contacts',
    tag: 'Customers',
    summary: "List an account's contacts",
    access: 'customers:read',
    params: idParams,
    response: { data: z.array(s.contactSchema) },
    errors: [404],
  },
  {
    method: 'post',
    path: '/customers/{id}/contacts',
    tag: 'Customers',
    summary: 'Add a contact',
    access: 'customers:manage',
    params: idParams,
    body: s.createContactSchema,
    response: { data: s.contactSchema },
    status: 201,
    errors: [400, 404],
  },
  {
    method: 'patch',
    path: '/customers/{id}/contacts/{contactId}',
    tag: 'Customers',
    summary: 'Update a contact',
    access: 'customers:manage',
    params: s.contactParamsSchema,
    body: s.updateContactSchema,
    response: { data: s.contactSchema },
    errors: [400, 404, 409],
  },
  {
    method: 'delete',
    path: '/customers/{id}/contacts/{contactId}',
    tag: 'Customers',
    summary: 'Remove a contact',
    access: 'customers:manage',
    params: s.contactParamsSchema,
    response: 'none',
    status: 204,
    errors: [404],
  },
  {
    method: 'get',
    path: '/customers/{id}/users',
    tag: 'Customers',
    summary: "List an account's portal users",
    access: 'users:read',
    params: idParams,
    response: { data: z.array(s.userSchema) },
    errors: [404],
  },
  {
    method: 'post',
    path: '/customers/{id}/users',
    tag: 'Customers',
    summary: 'Create a portal user for an account',
    access: 'users:manage',
    params: idParams,
    body: s.createCustomerUserSchema,
    response: { data: s.userSchema },
    status: 201,
    errors: [400, 404, 409, 422],
  },
  // Assets
  {
    method: 'get',
    path: '/assets',
    tag: 'Assets',
    summary: 'List assets',
    access: 'assets:read',
    query: s.listAssetsQuerySchema,
    response: { page: s.assetSchema },
  },
  {
    method: 'get',
    path: '/assets/export.csv',
    tag: 'Assets',
    summary: `Export the filtered asset list as CSV (max ${s.ASSET_EXPORT_LIMIT} rows; audited)`,
    access: 'assets:export',
    query: s.exportAssetsQuerySchema,
    response: { raw: { type: 'string', contentMediaType: 'text/csv' } },
    errors: [400, 422],
  },
  {
    method: 'get',
    path: '/assets/{id}',
    tag: 'Assets',
    summary: 'Get an asset',
    access: 'assets:read',
    params: idParams,
    response: { data: s.assetSchema },
    errors: [404],
  },
  {
    method: 'get',
    path: '/assets/{id}/events',
    tag: 'Assets',
    summary: 'Lifecycle history of an asset (newest first)',
    access: 'assets:read',
    params: idParams,
    response: { data: z.array(s.assetEventSchema) },
    errors: [404],
  },
  {
    method: 'post',
    path: '/assets',
    tag: 'Assets',
    summary: 'Register an asset',
    access: 'assets:manage',
    body: s.createAssetSchema,
    response: { data: s.assetSchema },
    status: 201,
    errors: [400, 409, 422],
  },
  {
    method: 'patch',
    path: '/assets/{id}',
    tag: 'Assets',
    summary: 'Update asset details or reassign it to a customer',
    access: 'assets:manage',
    params: idParams,
    body: s.updateAssetSchema,
    response: { data: s.assetSchema },
    errors: [400, 404, 409, 422],
  },
  {
    method: 'post',
    path: '/assets/{id}/status',
    tag: 'Assets',
    summary: 'Change lifecycle status (allowed transitions only)',
    access: 'assets:manage',
    params: idParams,
    body: s.changeAssetStatusSchema,
    response: { data: s.assetSchema },
    errors: [400, 404, 409, 422],
  },
  // Repairs
  {
    method: 'get',
    path: '/repairs',
    tag: 'Repairs',
    summary: 'List repair jobs (technicians see only jobs assigned to them)',
    access: 'repairs:read',
    query: s.listRepairsQuerySchema,
    response: { page: s.repairSchema },
  },
  {
    method: 'get',
    path: '/repairs/technicians',
    tag: 'Repairs',
    summary: 'Active technicians and their open jobs, for assignment',
    access: 'repairs:manage',
    response: { data: z.array(s.technicianOptionSchema) },
  },
  {
    method: 'post',
    path: '/repairs',
    tag: 'Repairs',
    summary: 'Book a customer device in for repair (accepts Idempotency-Key)',
    access: 'repairs:manage',
    body: s.createRepairSchema,
    response: { data: s.repairSchema },
    status: 201,
    errors: [400, 404, 409, 422],
  },
  {
    method: 'get',
    path: '/repairs/{id}',
    tag: 'Repairs',
    summary: 'Get a repair job',
    access: 'repairs:read',
    params: idParams,
    response: { data: s.repairSchema },
    errors: [404],
  },
  {
    method: 'get',
    path: '/repairs/{id}/history',
    tag: 'Repairs',
    summary: 'Status history, newest first',
    access: 'repairs:read',
    params: idParams,
    response: { data: z.array(s.repairHistoryEntrySchema) },
    errors: [404],
  },
  {
    method: 'post',
    path: '/repairs/{id}/assign',
    tag: 'Repairs',
    summary: 'Assign or reassign the technician (accepts Idempotency-Key)',
    access: 'repairs:manage',
    params: idParams,
    body: s.assignRepairSchema,
    response: { data: s.repairSchema },
    errors: [400, 404, 409, 422],
  },
  {
    method: 'post',
    path: '/repairs/{id}/transitions',
    tag: 'Repairs',
    summary: 'Move the job to another status, if the state machine allows it for the caller',
    access: 'repairs:work',
    params: idParams,
    body: s.repairTransitionSchema,
    response: { data: s.repairSchema },
    errors: [400, 404, 409, 422],
  },
  {
    method: 'get',
    path: '/repairs/{id}/notes',
    tag: 'Repairs',
    summary: 'Notes, newest first',
    access: 'repairs:read_details',
    params: idParams,
    response: { data: z.array(s.repairNoteSchema) },
    errors: [404],
  },
  {
    method: 'post',
    path: '/repairs/{id}/notes',
    tag: 'Repairs',
    summary: 'Add a note (CUSTOMER_VISIBLE notes appear in the portal)',
    access: 'repairs:work',
    params: idParams,
    body: s.addRepairNoteSchema,
    response: { data: s.repairNoteSchema },
    status: 201,
    errors: [400, 404],
  },
  {
    method: 'get',
    path: '/repairs/{id}/labour',
    tag: 'Repairs',
    summary: 'Labour entries',
    access: 'repairs:read_details',
    params: idParams,
    response: { data: z.array(s.labourEntrySchema) },
    errors: [404],
  },
  {
    method: 'post',
    path: '/repairs/{id}/labour',
    tag: 'Repairs',
    summary: 'Record time spent on the job',
    access: 'repairs:work',
    params: idParams,
    body: s.addLabourSchema,
    response: { data: s.labourEntrySchema },
    status: 201,
    errors: [400, 404, 422],
  },
  {
    method: 'delete',
    path: '/repairs/{id}/labour/{entryId}',
    tag: 'Repairs',
    summary: 'Remove a labour entry (technicians: their own only)',
    access: 'repairs:work',
    params: s.repairLabourParamsSchema,
    response: 'none',
    status: 204,
    errors: [404, 422],
  },
  {
    method: 'get',
    path: '/repairs/{id}/quotes',
    tag: 'Quotations',
    summary: 'All quotation revisions, newest first (including the draft)',
    access: 'repairs:read_details',
    params: idParams,
    response: { data: z.array(s.quotationSchema) },
    errors: [404],
  },
  {
    method: 'post',
    path: '/repairs/{id}/quotes',
    tag: 'Quotations',
    summary: 'Start a draft quotation (the next revision)',
    access: 'repairs:work',
    params: idParams,
    body: s.createQuoteSchema,
    response: { data: s.quotationSchema },
    status: 201,
    errors: [400, 404, 409, 422],
  },
  {
    method: 'patch',
    path: '/repairs/{id}/quotes/{quoteId}',
    tag: 'Quotations',
    summary: 'Edit a draft quotation (replaces its lines)',
    access: 'repairs:work',
    params: s.repairQuoteParamsSchema,
    body: s.updateQuoteSchema,
    response: { data: s.quotationSchema },
    errors: [400, 404, 409, 422],
  },
  {
    method: 'delete',
    path: '/repairs/{id}/quotes/{quoteId}',
    tag: 'Quotations',
    summary: 'Discard a draft quotation',
    access: 'repairs:work',
    params: s.repairQuoteParamsSchema,
    response: 'none',
    status: 204,
    errors: [404, 409],
  },
  {
    method: 'post',
    path: '/repairs/{id}/quotes/{quoteId}/issue',
    tag: 'Quotations',
    summary: 'Issue a draft to the customer; freezes it and supersedes the previous one',
    access: 'repairs:work',
    params: s.repairQuoteParamsSchema,
    body: s.quoteVersionSchema,
    response: { data: s.quotationSchema },
    errors: [400, 404, 409, 422],
  },
  {
    method: 'post',
    path: '/repairs/{id}/quotes/{quoteId}/approve',
    tag: 'Quotations',
    summary: 'Record the customer’s approval on their behalf (channel and note required)',
    access: 'repairs:manage',
    params: s.repairQuoteParamsSchema,
    body: s.staffQuoteDecisionSchema,
    response: { data: s.quotationSchema },
    errors: [400, 404, 409],
  },
  {
    method: 'post',
    path: '/repairs/{id}/quotes/{quoteId}/reject',
    tag: 'Quotations',
    summary: 'Record the customer’s rejection on their behalf (channel and note required)',
    access: 'repairs:manage',
    params: s.repairQuoteParamsSchema,
    body: s.staffQuoteDecisionSchema,
    response: { data: s.quotationSchema },
    errors: [400, 404, 409],
  },
  // Parts on repair jobs
  {
    method: 'get',
    path: '/repairs/{id}/parts',
    tag: 'Repairs',
    summary: 'Parts used on the job (net of returns) and every use and return',
    access: 'repairs:read',
    params: idParams,
    response: { data: s.repairPartsSchema },
    errors: [404],
  },
  {
    method: 'post',
    path: '/repairs/{id}/parts',
    tag: 'Repairs',
    summary: 'Use parts on the job: takes them out of stock (accepts Idempotency-Key)',
    access: 'repairs:work',
    params: idParams,
    body: s.useRepairPartSchema,
    response: { data: s.stockMovementSchema },
    status: 201,
    errors: [400, 404, 409, 422],
  },
  {
    method: 'post',
    path: '/repairs/{id}/parts/returns',
    tag: 'Repairs',
    summary: 'Return unused parts from the job to stock (accepts Idempotency-Key)',
    access: 'repairs:work',
    params: idParams,
    body: s.returnRepairPartSchema,
    response: { data: s.stockMovementSchema },
    status: 201,
    errors: [400, 404, 422],
  },
  // Inventory
  {
    method: 'get',
    path: '/inventory/parts',
    tag: 'Inventory',
    summary: 'List parts with their stock levels',
    access: 'inventory:read',
    query: s.listPartsQuerySchema,
    response: { page: s.partSchema },
  },
  {
    method: 'post',
    path: '/inventory/parts',
    tag: 'Inventory',
    summary: 'Add a part (with no stock) (accepts Idempotency-Key)',
    access: 'inventory:manage',
    body: s.createPartSchema,
    response: { data: s.partSchema },
    status: 201,
    errors: [400, 409],
  },
  {
    method: 'get',
    path: '/inventory/parts/{id}',
    tag: 'Inventory',
    summary: 'Get a part',
    access: 'inventory:read',
    params: idParams,
    response: { data: s.partSchema },
    errors: [404],
  },
  {
    method: 'patch',
    path: '/inventory/parts/{id}',
    tag: 'Inventory',
    summary: 'Edit a part, or archive (isActive=false, needs zero stock) or restore it',
    access: 'inventory:manage',
    params: idParams,
    body: s.updatePartSchema,
    response: { data: s.partSchema },
    errors: [400, 404, 409, 422],
  },
  {
    method: 'get',
    path: '/inventory/parts/{id}/movements',
    tag: 'Inventory',
    summary: "A part's stock ledger, newest first",
    access: 'inventory:read',
    params: idParams,
    query: s.listMovementsQuerySchema.omit({ part: true }),
    response: { page: s.stockMovementSchema },
    errors: [404],
  },
  {
    method: 'post',
    path: '/inventory/parts/{id}/purchases',
    tag: 'Inventory',
    summary: 'Receive purchased stock; updates the average cost (accepts Idempotency-Key)',
    access: 'inventory:manage',
    params: idParams,
    body: s.recordPurchaseSchema,
    response: { data: s.stockMovementSchema },
    status: 201,
    errors: [400, 404, 422],
  },
  {
    method: 'post',
    path: '/inventory/parts/{id}/adjustments',
    tag: 'Inventory',
    summary: 'Adjust stock up or down with a reason (accepts Idempotency-Key)',
    access: 'inventory:manage',
    params: idParams,
    body: s.recordAdjustmentSchema,
    response: { data: s.stockMovementSchema },
    status: 201,
    errors: [400, 404, 409, 422],
  },
  {
    method: 'get',
    path: '/inventory/movements',
    tag: 'Inventory',
    summary: 'The stock ledger for all parts, newest first',
    access: 'inventory:read',
    query: s.listMovementsQuerySchema,
    response: { page: s.stockMovementSchema },
  },
  // Reports
  {
    method: 'get',
    path: '/reports/operations',
    tag: 'Reports',
    summary:
      'Devices, jobs, turnaround, billed revenue, status distribution, technician workload and trend for a date range (default: last 30 days, UTC)',
    access: 'reports:operations',
    query: s.reportQuerySchema,
    response: { data: s.operationsReportSchema },
    errors: [400],
  },
  {
    method: 'get',
    path: '/reports/inventory',
    tag: 'Reports',
    summary: 'Parts consumption and receipts for a date range, plus stock value and low stock now',
    access: 'reports:inventory',
    query: s.reportQuerySchema,
    response: { data: s.inventoryReportSchema },
    errors: [400],
  },
  // Audit
  {
    method: 'get',
    path: '/audit',
    tag: 'Activity',
    summary: 'Activity (audit) log, newest first',
    access: 'audit:read',
    query: s.listAuditQuerySchema,
    response: { page: s.auditEntrySchema },
  },
  // Portal
  {
    method: 'get',
    path: '/portal/account',
    tag: 'Customer portal',
    summary: "The signed-in customer's account",
    access: 'portal:use',
    response: { data: s.portalAccountSchema },
  },
  {
    method: 'get',
    path: '/portal/assets',
    tag: 'Customer portal',
    summary: "The customer's own devices",
    access: 'portal:use',
    query: s.portalListAssetsQuerySchema,
    response: { page: s.portalAssetSchema },
  },
  {
    method: 'get',
    path: '/portal/assets/{id}',
    tag: 'Customer portal',
    summary: 'One of the customer’s own devices (404 for any other)',
    access: 'portal:use',
    params: idParams,
    response: { data: s.portalAssetSchema },
    errors: [404],
  },
  {
    method: 'get',
    path: '/portal/assets/{id}/history',
    tag: 'Customer portal',
    summary: 'Status history of one of the customer’s own devices',
    access: 'portal:use',
    params: idParams,
    response: { data: z.array(s.portalAssetEventSchema) },
    errors: [404],
  },
  {
    method: 'get',
    path: '/portal/repairs',
    tag: 'Customer portal',
    summary: "The customer's own repairs",
    access: 'portal:use',
    query: s.portalListRepairsQuerySchema,
    response: { page: s.portalRepairSchema },
  },
  {
    method: 'post',
    path: '/portal/repairs',
    tag: 'Customer portal',
    summary: 'Request a repair for one of the customer’s own devices (accepts Idempotency-Key)',
    access: 'portal:use',
    body: s.portalCreateRepairSchema,
    response: { data: s.portalRepairSchema },
    status: 201,
    errors: [400, 404, 409, 422],
  },
  {
    method: 'get',
    path: '/portal/repairs/{id}',
    tag: 'Customer portal',
    summary: 'One of the customer’s own repairs (404 for any other)',
    access: 'portal:use',
    params: idParams,
    response: { data: s.portalRepairSchema },
    errors: [404],
  },
  {
    method: 'get',
    path: '/portal/repairs/{id}/timeline',
    tag: 'Customer portal',
    summary: 'Status changes and messages for the customer, newest first',
    access: 'portal:use',
    params: idParams,
    response: { data: z.array(s.portalRepairTimelineEntrySchema) },
    errors: [404],
  },
  {
    method: 'get',
    path: '/portal/repairs/{id}/quotes',
    tag: 'Customer portal',
    summary: 'Issued quotations and their outcomes (never drafts)',
    access: 'portal:use',
    params: idParams,
    response: { data: z.array(s.portalQuotationSchema) },
    errors: [404],
  },
  {
    method: 'post',
    path: '/portal/repairs/{id}/cancel',
    tag: 'Customer portal',
    summary: 'Cancel a request before a technician is assigned',
    access: 'portal:use',
    params: idParams,
    body: s.portalCancelRepairSchema,
    response: { data: s.portalRepairSchema },
    errors: [400, 404, 409],
  },
  {
    method: 'post',
    path: '/portal/repairs/{id}/quotes/{quoteId}/approve',
    tag: 'Customer portal',
    summary: 'Approve the issued quotation (accepts Idempotency-Key)',
    access: 'portal:use',
    params: s.repairQuoteParamsSchema,
    body: s.quoteVersionSchema,
    response: { data: s.portalQuotationSchema },
    errors: [400, 404, 409],
  },
  {
    method: 'post',
    path: '/portal/repairs/{id}/quotes/{quoteId}/reject',
    tag: 'Customer portal',
    summary: 'Reject the issued quotation (accepts Idempotency-Key)',
    access: 'portal:use',
    params: s.repairQuoteParamsSchema,
    body: s.portalRejectQuoteSchema,
    response: { data: s.portalQuotationSchema },
    errors: [400, 404, 409],
  },
];

function schemaOf(schema: z.ZodType, io: 'input' | 'output' = 'output'): JsonSchema {
  const json = z.toJSONSchema(schema, { io, unrepresentable: 'any' }) as JsonSchema;
  delete json.$schema;
  return json;
}

const errorResponse = {
  description: 'Error',
  content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } },
};

const ERROR_DESCRIPTIONS: Record<number, string> = {
  400: 'Validation failed',
  401: 'Not signed in',
  403: 'Missing permission, or CSRF check failed',
  404: 'Not found (also returned for records outside the caller’s scope)',
  409: 'Conflict: stale version or duplicate',
  422: 'Business rule violated',
  429: 'Too many attempts',
};

function parametersOf(location: 'path' | 'query', schema?: z.ZodObject) {
  if (!schema) return [];
  const json = schemaOf(schema, 'input') as {
    properties?: Record<string, JsonSchema>;
    required?: string[];
  };
  return Object.entries(json.properties ?? {}).map(([name, property]) => ({
    name,
    in: location,
    required: location === 'path' || (json.required ?? []).includes(name),
    schema: property,
  }));
}

function responseSchema(response: Operation['response']): JsonSchema | undefined {
  if (!response || response === 'none') return undefined;
  if ('raw' in response) return response.raw;
  if ('data' in response) {
    return { type: 'object', required: ['data'], properties: { data: schemaOf(response.data) } };
  }
  return {
    type: 'object',
    required: ['data', 'meta'],
    properties: {
      data: { type: 'array', items: schemaOf(response.page) },
      meta: { $ref: '#/components/schemas/PageMeta' },
    },
  };
}

export function buildOpenApiDocument() {
  const paths: Record<string, Record<string, unknown>> = {};

  for (const op of OPERATIONS) {
    const status = op.status ?? 200;
    const body = responseSchema(op.response);
    const isCsv = op.path.endsWith('.csv');
    const errors = new Set(op.errors ?? []);
    if (op.access !== 'public') errors.add(401);
    if (op.access !== 'public' && op.access !== 'signed-in') errors.add(403);
    if (op.method !== 'get') errors.add(403);

    paths[op.path] ??= {};
    paths[op.path]![op.method] = {
      tags: [op.tag],
      summary: op.summary,
      description:
        op.access === 'public'
          ? 'No sign-in required.'
          : op.access === 'signed-in'
            ? 'Requires a signed-in user.'
            : `Requires the \`${op.access}\` permission.`,
      ...(op.access === 'public' ? { security: [] } : {}),
      parameters: [...parametersOf('path', op.params), ...parametersOf('query', op.query)],
      ...(op.body
        ? {
            requestBody: {
              required: true,
              content: { 'application/json': { schema: schemaOf(op.body, 'input') } },
            },
          }
        : {}),
      responses: {
        [status]: {
          description: status === 204 ? 'No content' : 'Success',
          ...(body
            ? { content: { [isCsv ? 'text/csv' : 'application/json']: { schema: body } } }
            : {}),
        },
        ...Object.fromEntries(
          [...errors]
            .sort()
            .map((code) => [
              code,
              { ...errorResponse, description: ERROR_DESCRIPTIONS[code] ?? 'Error' },
            ]),
        ),
      },
    };
  }

  return {
    openapi: '3.1.0',
    info: {
      title: 'DeviceFlow API',
      version: '1.0.0-phase6',
      description:
        'REST API for DeviceFlow. All paths are relative to /api/v1. Authentication is a session ' +
        'cookie set by POST /auth/login. Every state-changing request must send the header ' +
        '`X-Requested-With: DeviceFlow` (CSRF protection). Errors use one shape: ' +
        '`{ error: { code, message, details?, requestId } }`. Operations marked "accepts ' +
        'Idempotency-Key" can be retried safely: send a unique `Idempotency-Key` header ' +
        '(8-128 letters, digits, - or _) per intended change and a repeat returns the saved ' +
        'response with `Idempotency-Replayed: true`.',
    },
    servers: [{ url: '/api/v1' }],
    security: [{ sessionCookie: [] }],
    tags: [
      'Auth',
      'Users',
      'Settings',
      'Customers',
      'Assets',
      'Repairs',
      'Quotations',
      'Inventory',
      'Reports',
      'Activity',
      'Customer portal',
    ].map((name) => ({ name })),
    paths,
    components: {
      securitySchemes: {
        sessionCookie: {
          type: 'apiKey',
          in: 'cookie',
          name: 'df_session',
          description: 'Named __Host-df_session when COOKIE_SECURE=true.',
        },
      },
      schemas: {
        Error: {
          type: 'object',
          required: ['error'],
          properties: {
            error: {
              type: 'object',
              required: ['code', 'message'],
              properties: {
                code: { type: 'string', enum: [...s.ERROR_CODES] },
                message: { type: 'string' },
                details: {
                  type: 'array',
                  items: {
                    type: 'object',
                    properties: { path: { type: 'string' }, message: { type: 'string' } },
                  },
                },
                requestId: { type: 'string' },
              },
            },
          },
        },
        PageMeta: {
          type: 'object',
          required: ['page', 'pageSize', 'total', 'totalPages'],
          properties: {
            page: { type: 'integer' },
            pageSize: { type: 'integer' },
            total: { type: 'integer' },
            totalPages: { type: 'integer' },
          },
        },
      },
    },
  };
}

/** Method and path of every documented operation, e.g. "GET /assets/{id}". */
export function documentedOperations(): string[] {
  return OPERATIONS.map((op) => `${op.method.toUpperCase()} ${op.path}`);
}
