import { z } from 'zod';
import type { Role } from '../roles.js';
import { hasAtMostTwoDecimals } from '../money.js';
import { ASSET_CATEGORIES, userRefSchema } from './assets.js';
import { paginationSchema, sortSchema } from './common.js';
import { customerSummarySchema } from './customers.js';
import { hasChanges, latestAllowedDate, optionalText, versionField } from './fields.js';

// --- Statuses --------------------------------------------------------------------

export const REPAIR_STATUSES = [
  'SUBMITTED',
  'ASSIGNED',
  'DIAGNOSING',
  'AWAITING_APPROVAL',
  'APPROVED',
  'QUOTE_REJECTED',
  'IN_REPAIR',
  'AWAITING_PARTS',
  'QUALITY_CHECK',
  'COMPLETED',
  'CLOSED',
  'RETURNED_UNREPAIRED',
  'CANCELLED',
] as const;
export type RepairStatus = (typeof REPAIR_STATUSES)[number];

export const REPAIR_STATUS_LABELS: Record<RepairStatus, string> = {
  SUBMITTED: 'Submitted',
  ASSIGNED: 'Assigned',
  DIAGNOSING: 'Diagnosing',
  AWAITING_APPROVAL: 'Awaiting approval',
  APPROVED: 'Approved',
  QUOTE_REJECTED: 'Quote rejected',
  IN_REPAIR: 'In repair',
  AWAITING_PARTS: 'Awaiting parts',
  QUALITY_CHECK: 'Quality check',
  COMPLETED: 'Completed',
  CLOSED: 'Closed',
  RETURNED_UNREPAIRED: 'Returned unrepaired',
  CANCELLED: 'Cancelled',
};

/** Wording for customers in the portal. */
export const PORTAL_REPAIR_STATUS_LABELS: Record<RepairStatus, string> = {
  SUBMITTED: 'Request received',
  ASSIGNED: 'Technician assigned',
  DIAGNOSING: 'Being diagnosed',
  AWAITING_APPROVAL: 'Quote waiting for your approval',
  APPROVED: 'Quote approved',
  QUOTE_REJECTED: 'Quote declined',
  IN_REPAIR: 'Being repaired',
  AWAITING_PARTS: 'Waiting for parts',
  QUALITY_CHECK: 'Final checks',
  COMPLETED: 'Ready for collection',
  CLOSED: 'Collected',
  RETURNED_UNREPAIRED: 'Returned unrepaired',
  CANCELLED: 'Cancelled',
};

/** Finished jobs. The device has been handed back (or the job was dropped). */
export const CLOSED_REPAIR_STATUSES = [
  'CLOSED',
  'RETURNED_UNREPAIRED',
  'CANCELLED',
] as const satisfies readonly RepairStatus[];

export const OPEN_REPAIR_STATUSES = REPAIR_STATUSES.filter(
  (s) => !(CLOSED_REPAIR_STATUSES as readonly string[]).includes(s),
) as RepairStatus[];

export function isRepairOpen(status: RepairStatus): boolean {
  return !(CLOSED_REPAIR_STATUSES as readonly RepairStatus[]).includes(status);
}

/** Statuses in which the technician can be changed (or first assigned, from SUBMITTED). */
export const TECHNICIAN_CHANGE_STATUSES: readonly RepairStatus[] = [
  'SUBMITTED',
  'ASSIGNED',
  'DIAGNOSING',
  'AWAITING_APPROVAL',
  'APPROVED',
  'QUOTE_REJECTED',
  'IN_REPAIR',
  'AWAITING_PARTS',
  'QUALITY_CHECK',
];

/** Statuses in which labour can be recorded or removed. */
export const LABOUR_STATUSES: readonly RepairStatus[] = [
  'DIAGNOSING',
  'AWAITING_APPROVAL',
  'QUOTE_REJECTED',
  'APPROVED',
  'IN_REPAIR',
  'AWAITING_PARTS',
  'QUALITY_CHECK',
];

/**
 * Statuses in which a quotation can be drafted and issued. Issuing while
 * AWAITING_APPROVAL replaces (supersedes) the quotation the customer has.
 */
export const QUOTE_STATUSES: readonly RepairStatus[] = ['DIAGNOSING', 'AWAITING_APPROVAL'];

// --- State machine ----------------------------------------------------------------

/**
 * Who may perform a move. Row-level scope still applies first: a technician
 * only ever sees jobs assigned to them, and a customer only their own account's.
 */
export type RepairActor = 'ADMIN' | 'ASSIGNED_TECHNICIAN' | 'CUSTOMER';

/**
 * How a move happens. Only "transition" moves go through the generic
 * transitions endpoint; the others happen as part of a domain action, so for
 * example a job can never be marked APPROVED without a quotation being approved.
 */
export type RepairAction =
  'transition' | 'assign' | 'issue_quote' | 'approve_quote' | 'reject_quote' | 'cancel';

/** What a move needs: a note, a completion summary, or at least one labour entry. */
export type RepairRequirement = 'note' | 'completionSummary' | 'labour';

export interface RepairTransitionRule {
  from: RepairStatus;
  to: RepairStatus;
  via: RepairAction;
  actors: readonly RepairActor[];
  requires: readonly RepairRequirement[];
}

function rule(
  from: RepairStatus,
  to: RepairStatus,
  via: RepairAction,
  actors: readonly RepairActor[],
  requires: readonly RepairRequirement[] = [],
): RepairTransitionRule {
  return { from, to, via, actors, requires };
}

/** Jobs can be cancelled only before a quotation has been approved. */
export const CANCELLABLE_REPAIR_STATUSES: readonly RepairStatus[] = [
  'SUBMITTED',
  'ASSIGNED',
  'DIAGNOSING',
  'AWAITING_APPROVAL',
  'QUOTE_REJECTED',
];

/** The repair state machine (Phase 1, §3.1). The API rejects every move not listed. */
export const REPAIR_TRANSITIONS: readonly RepairTransitionRule[] = [
  rule('SUBMITTED', 'ASSIGNED', 'assign', ['ADMIN']),
  rule('ASSIGNED', 'DIAGNOSING', 'transition', ['ASSIGNED_TECHNICIAN', 'ADMIN']),
  rule('DIAGNOSING', 'AWAITING_APPROVAL', 'issue_quote', ['ASSIGNED_TECHNICIAN', 'ADMIN']),
  rule('AWAITING_APPROVAL', 'APPROVED', 'approve_quote', ['CUSTOMER', 'ADMIN']),
  rule('AWAITING_APPROVAL', 'QUOTE_REJECTED', 'reject_quote', ['CUSTOMER', 'ADMIN']),
  rule('QUOTE_REJECTED', 'DIAGNOSING', 'transition', ['ASSIGNED_TECHNICIAN', 'ADMIN']),
  rule('QUOTE_REJECTED', 'RETURNED_UNREPAIRED', 'transition', ['ADMIN']),
  rule('APPROVED', 'IN_REPAIR', 'transition', ['ASSIGNED_TECHNICIAN']),
  rule('IN_REPAIR', 'AWAITING_PARTS', 'transition', ['ASSIGNED_TECHNICIAN'], ['note']),
  rule('AWAITING_PARTS', 'IN_REPAIR', 'transition', ['ASSIGNED_TECHNICIAN'], ['note']),
  rule('IN_REPAIR', 'QUALITY_CHECK', 'transition', ['ASSIGNED_TECHNICIAN'], ['labour']),
  rule(
    'QUALITY_CHECK',
    'COMPLETED',
    'transition',
    ['ASSIGNED_TECHNICIAN', 'ADMIN'],
    ['completionSummary'],
  ),
  rule('QUALITY_CHECK', 'IN_REPAIR', 'transition', ['ASSIGNED_TECHNICIAN', 'ADMIN'], ['note']),
  rule('COMPLETED', 'CLOSED', 'transition', ['ADMIN']),
  ...CANCELLABLE_REPAIR_STATUSES.map((from) =>
    rule(from, 'CANCELLED', 'cancel', from === 'SUBMITTED' ? ['ADMIN', 'CUSTOMER'] : ['ADMIN'], [
      'note',
    ]),
  ),
];

export function findRepairRule(
  from: RepairStatus,
  to: RepairStatus,
): RepairTransitionRule | undefined {
  return REPAIR_TRANSITIONS.find((r) => r.from === from && r.to === to);
}

export interface RepairActorUser {
  id: string;
  role: Role;
  customerAccountId?: string | null;
}

export interface RepairActorJob {
  assignedTechnicianId: string | null;
  customerAccountId: string;
}

/** The capacities in which a user acts on a job. */
export function repairActorsFor(user: RepairActorUser, job: RepairActorJob): RepairActor[] {
  const actors: RepairActor[] = [];
  if (user.role === 'ADMIN') actors.push('ADMIN');
  if (user.role === 'TECHNICIAN' && job.assignedTechnicianId === user.id) {
    actors.push('ASSIGNED_TECHNICIAN');
  }
  if (user.role === 'CUSTOMER' && user.customerAccountId === job.customerAccountId) {
    actors.push('CUSTOMER');
  }
  return actors;
}

export function canActAs(
  rule: Pick<RepairTransitionRule, 'actors'>,
  actors: readonly RepairActor[],
): boolean {
  return rule.actors.some((a) => actors.includes(a));
}

/**
 * Moves the user could make through the transitions endpoint (or cancel). The
 * web app uses this to decide which buttons to show; the API re-checks everything.
 */
export function availableRepairMoves(
  job: RepairActorJob & { status: RepairStatus },
  user: RepairActorUser,
): RepairTransitionRule[] {
  const actors = repairActorsFor(user, job);
  return REPAIR_TRANSITIONS.filter(
    (r) =>
      r.from === job.status &&
      (r.via === 'transition' || r.via === 'cancel') &&
      canActAs(r, actors),
  );
}

// --- Labels -------------------------------------------------------------------------

export const REPAIR_SOURCES = ['STAFF', 'PORTAL'] as const;
export type RepairSource = (typeof REPAIR_SOURCES)[number];
export const REPAIR_SOURCE_LABELS: Record<RepairSource, string> = {
  STAFF: 'Booked in by staff',
  PORTAL: 'Requested in the portal',
};

export const REPAIR_NOTE_TYPES = [
  'FAULT',
  'DIAGNOSTIC',
  'REPAIR',
  'INTERNAL',
  'CUSTOMER_VISIBLE',
] as const;
export type RepairNoteType = (typeof REPAIR_NOTE_TYPES)[number];
export const REPAIR_NOTE_TYPE_LABELS: Record<RepairNoteType, string> = {
  FAULT: 'Fault',
  DIAGNOSTIC: 'Diagnosis',
  REPAIR: 'Repair work',
  INTERNAL: 'Internal',
  CUSTOMER_VISIBLE: 'Message to customer',
};

export const QUOTATION_STATUSES = [
  'DRAFT',
  'ISSUED',
  'APPROVED',
  'REJECTED',
  'SUPERSEDED',
  'WITHDRAWN',
] as const;
export type QuotationStatus = (typeof QUOTATION_STATUSES)[number];
export const QUOTATION_STATUS_LABELS: Record<QuotationStatus, string> = {
  DRAFT: 'Draft',
  ISSUED: 'Issued',
  APPROVED: 'Approved',
  REJECTED: 'Rejected',
  SUPERSEDED: 'Superseded',
  WITHDRAWN: 'Withdrawn',
};

export const QUOTE_LINE_KINDS = ['LABOUR', 'PART', 'OTHER'] as const;
export type QuoteLineKind = (typeof QUOTE_LINE_KINDS)[number];
export const QUOTE_LINE_KIND_LABELS: Record<QuoteLineKind, string> = {
  LABOUR: 'Labour',
  PART: 'Part',
  OTHER: 'Other',
};

export const DECISION_CHANNELS = ['PORTAL', 'PHONE', 'IN_PERSON', 'EMAIL'] as const;
export type DecisionChannel = (typeof DECISION_CHANNELS)[number];
export const DECISION_CHANNEL_LABELS: Record<DecisionChannel, string> = {
  PORTAL: 'Customer portal',
  PHONE: 'Phone',
  IN_PERSON: 'In person',
  EMAIL: 'Email',
};

/** Channels an administrator can record when deciding on the customer's behalf (D2). */
export const ON_BEHALF_CHANNELS = ['PHONE', 'IN_PERSON', 'EMAIL'] as const;

// --- Requests -----------------------------------------------------------------------

const faultDescription = z
  .string()
  .trim()
  .min(5, 'Describe the fault in a few words')
  .max(2000, 'Must be at most 2000 characters');

export const createRepairSchema = z.object({
  assetId: z.uuid({ message: 'Choose the device' }),
  faultDescription,
  /** Optionally assign straight away. */
  technicianId: z.uuid().nullish(),
});
export type CreateRepairInput = z.infer<typeof createRepairSchema>;

export const assignRepairSchema = z.object({
  technicianId: z.uuid({ message: 'Choose a technician' }),
  version: versionField,
});
export type AssignRepairInput = z.infer<typeof assignRepairSchema>;

export const repairTransitionSchema = z.object({
  to: z.enum(REPAIR_STATUSES),
  note: optionalText(2000),
  completionSummary: optionalText(2000),
  version: versionField,
});
export type RepairTransitionInput = z.infer<typeof repairTransitionSchema>;

export const REPAIR_SORT_FIELDS = ['createdAt', 'updatedAt', 'reference', 'status'] as const;
export const REPAIR_STATES = ['open', 'closed'] as const;

export const listRepairsQuerySchema = paginationSchema.extend({
  search: z.string().trim().max(100).optional(),
  status: z.enum(REPAIR_STATUSES).optional(),
  /** open = not closed, returned or cancelled. */
  state: z.enum(REPAIR_STATES).optional(),
  /** A technician's user id, or "unassigned". Ignored for technicians, who see only their own jobs. */
  technician: z.union([z.uuid(), z.literal('unassigned')]).optional(),
  customer: z.uuid().optional(),
  asset: z.uuid().optional(),
  sort: sortSchema(REPAIR_SORT_FIELDS, 'createdAt:desc'),
});
export type ListRepairsQuery = z.infer<typeof listRepairsQuerySchema>;

export const addRepairNoteSchema = z.object({
  type: z.enum(REPAIR_NOTE_TYPES),
  body: z.string().trim().min(1, 'Write the note').max(4000, 'Must be at most 4000 characters'),
});
export type AddRepairNoteInput = z.infer<typeof addRepairNoteSchema>;

export const addLabourSchema = z.object({
  minutes: z
    .number({ message: 'Enter the time spent' })
    .int('Use whole minutes')
    .min(1, 'At least 1 minute')
    .max(1440, 'At most 24 hours per entry'),
  description: z.string().trim().min(1, 'Describe the work').max(500),
  workDate: z.iso
    .date({ message: 'Enter a valid date' })
    .refine((d) => d <= latestAllowedDate(), 'The date cannot be in the future'),
});
export type AddLabourInput = z.infer<typeof addLabourSchema>;

/** Unit price limit per line: R1 000 000.00. */
export const MAX_UNIT_PRICE_CENTS = 100_000_000;
export const MAX_QUOTE_LINES = 50;

export const quoteLineInputSchema = z.object({
  kind: z.enum(QUOTE_LINE_KINDS),
  description: z.string().trim().min(1, 'Describe the line').max(300),
  /** Hours for labour, units for parts. Up to two decimals. */
  quantity: z
    .number({ message: 'Enter a quantity' })
    .positive('Must be more than 0')
    .max(10_000, 'At most 10 000')
    .refine(hasAtMostTwoDecimals, 'Use at most two decimals'),
  unitPriceCents: z
    .number({ message: 'Enter a price' })
    .int('Use whole cents')
    .min(0, 'Cannot be negative')
    .max(MAX_UNIT_PRICE_CENTS, 'At most R1 000 000 per unit'),
});
export type QuoteLineInput = z.infer<typeof quoteLineInputSchema>;

const quoteLines = z
  .array(quoteLineInputSchema)
  .max(MAX_QUOTE_LINES, `At most ${MAX_QUOTE_LINES} lines`);

export const createQuoteSchema = z.object({
  lines: quoteLines.default([]),
  customerNote: optionalText(2000),
});
export type CreateQuoteInput = z.infer<typeof createQuoteSchema>;

export const updateQuoteSchema = z
  .object({
    lines: quoteLines.optional(),
    customerNote: optionalText(2000),
    version: versionField,
  })
  .refine(hasChanges, { message: 'Provide at least one field to change' });
export type UpdateQuoteInput = z.infer<typeof updateQuoteSchema>;

export const quoteVersionSchema = z.object({ version: versionField });
export type QuoteVersionInput = z.infer<typeof quoteVersionSchema>;

/** An administrator records the customer's decision (D2): channel and note required. */
export const staffQuoteDecisionSchema = z.object({
  version: versionField,
  channel: z.enum(ON_BEHALF_CHANNELS, { message: 'Choose how the customer told you' }),
  note: z
    .string()
    .trim()
    .min(1, 'Record who decided and what they said')
    .max(1000, 'Must be at most 1000 characters'),
});
export type StaffQuoteDecisionInput = z.infer<typeof staffQuoteDecisionSchema>;

export const repairQuoteParamsSchema = z.object({ id: z.uuid(), quoteId: z.uuid() });
export const repairLabourParamsSchema = z.object({ id: z.uuid(), entryId: z.uuid() });

// --- Responses ----------------------------------------------------------------------

export const repairAssetSchema = z.object({
  id: z.uuid(),
  assetTag: z.string(),
  category: z.enum(ASSET_CATEGORIES),
  manufacturer: z.string(),
  model: z.string(),
  serialNumber: z.string().nullable(),
});

/** Who to call about the job: the account's primary contact, or the account itself. */
export const repairContactSchema = z.object({
  name: z.string(),
  jobTitle: z.string().nullable(),
  email: z.string().nullable(),
  phone: z.string().nullable(),
});
export type RepairContact = z.infer<typeof repairContactSchema>;

export const repairQuoteSummarySchema = z.object({
  id: z.uuid(),
  revision: z.number().int(),
  status: z.enum(QUOTATION_STATUSES),
  totalCents: z.number().int(),
  currency: z.string(),
});

export const repairSchema = z.object({
  id: z.uuid(),
  reference: z.string(),
  status: z.enum(REPAIR_STATUSES),
  source: z.enum(REPAIR_SOURCES),
  faultDescription: z.string(),
  asset: repairAssetSchema,
  customer: customerSummarySchema,
  contact: repairContactSchema.nullable(),
  technician: userRefSchema.nullable(),
  submittedBy: userRefSchema,
  completionSummary: z.string().nullable(),
  completedAt: z.string().nullable(),
  closedAt: z.string().nullable(),
  labourMinutes: z.number().int(),
  /** The latest issued, approved or rejected quotation (drafts are not included). */
  currentQuote: repairQuoteSummarySchema.nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
  version: z.number().int(),
});
export type Repair = z.infer<typeof repairSchema>;

export const repairHistoryEntrySchema = z.object({
  id: z.uuid(),
  fromStatus: z.enum(REPAIR_STATUSES).nullable(),
  toStatus: z.enum(REPAIR_STATUSES),
  note: z.string().nullable(),
  actor: userRefSchema,
  createdAt: z.string(),
});
export type RepairHistoryEntry = z.infer<typeof repairHistoryEntrySchema>;

export const repairNoteSchema = z.object({
  id: z.uuid(),
  type: z.enum(REPAIR_NOTE_TYPES),
  body: z.string(),
  author: userRefSchema,
  createdAt: z.string(),
});
export type RepairNote = z.infer<typeof repairNoteSchema>;

export const labourEntrySchema = z.object({
  id: z.uuid(),
  minutes: z.number().int(),
  description: z.string(),
  workDate: z.string(),
  user: userRefSchema,
  createdAt: z.string(),
});
export type LabourEntry = z.infer<typeof labourEntrySchema>;

export const quotationLineSchema = z.object({
  id: z.uuid(),
  position: z.number().int(),
  kind: z.enum(QUOTE_LINE_KINDS),
  description: z.string(),
  quantity: z.number(),
  unitPriceCents: z.number().int(),
  lineTotalCents: z.number().int(),
});
export type QuotationLine = z.infer<typeof quotationLineSchema>;

export const quotationSchema = z.object({
  id: z.uuid(),
  revision: z.number().int(),
  status: z.enum(QUOTATION_STATUSES),
  currency: z.string(),
  vatRateBasisPoints: z.number().int(),
  subtotalCents: z.number().int(),
  vatCents: z.number().int(),
  totalCents: z.number().int(),
  customerNote: z.string().nullable(),
  lines: z.array(quotationLineSchema),
  createdBy: userRefSchema,
  issuedBy: userRefSchema.nullable(),
  issuedAt: z.string().nullable(),
  decidedBy: userRefSchema.nullable(),
  decidedAt: z.string().nullable(),
  decisionChannel: z.enum(DECISION_CHANNELS).nullable(),
  decisionNote: z.string().nullable(),
  /** True when an administrator recorded the decision for the customer. */
  onBehalf: z.boolean(),
  approvedTotalCents: z.number().int().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
  version: z.number().int(),
});
export type Quotation = z.infer<typeof quotationSchema>;

export const technicianOptionSchema = z.object({
  id: z.uuid(),
  fullName: z.string(),
  /** Open jobs assigned to them, not counting completed jobs waiting for collection. */
  openJobs: z.number().int(),
});
export type TechnicianOption = z.infer<typeof technicianOptionSchema>;

// --- Customer portal --------------------------------------------------------------------

export const portalCreateRepairSchema = z.object({
  assetId: z.uuid({ message: 'Choose the device' }),
  faultDescription,
});
export type PortalCreateRepairInput = z.infer<typeof portalCreateRepairSchema>;

export const portalListRepairsQuerySchema = paginationSchema.extend({
  state: z.enum(REPAIR_STATES).optional(),
  asset: z.uuid().optional(),
});
export type PortalListRepairsQuery = z.infer<typeof portalListRepairsQuerySchema>;

export const portalCancelRepairSchema = z.object({
  reason: z
    .string()
    .trim()
    .min(1, 'Tell us why you are cancelling')
    .max(1000, 'Must be at most 1000 characters'),
  version: versionField,
});
export type PortalCancelRepairInput = z.infer<typeof portalCancelRepairSchema>;

export const portalRejectQuoteSchema = z.object({
  version: versionField,
  reason: optionalText(1000),
});
export type PortalRejectQuoteInput = z.infer<typeof portalRejectQuoteSchema>;

export const portalRepairSchema = z.object({
  id: z.uuid(),
  reference: z.string(),
  status: z.enum(REPAIR_STATUSES),
  faultDescription: z.string(),
  completionSummary: z.string().nullable(),
  device: repairAssetSchema.omit({ serialNumber: true }),
  createdAt: z.string(),
  updatedAt: z.string(),
  completedAt: z.string().nullable(),
  closedAt: z.string().nullable(),
  version: z.number().int(),
});
export type PortalRepair = z.infer<typeof portalRepairSchema>;

export const portalRepairTimelineEntrySchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('status'),
    id: z.uuid(),
    fromStatus: z.enum(REPAIR_STATUSES).nullable(),
    toStatus: z.enum(REPAIR_STATUSES),
    createdAt: z.string(),
  }),
  z.object({
    kind: z.literal('message'),
    id: z.uuid(),
    body: z.string(),
    createdAt: z.string(),
  }),
]);
export type PortalRepairTimelineEntry = z.infer<typeof portalRepairTimelineEntrySchema>;

export const portalQuotationSchema = quotationSchema
  .pick({
    id: true,
    revision: true,
    status: true,
    currency: true,
    vatRateBasisPoints: true,
    subtotalCents: true,
    vatCents: true,
    totalCents: true,
    customerNote: true,
    issuedAt: true,
    decidedAt: true,
    decisionChannel: true,
    onBehalf: true,
    version: true,
  })
  .extend({
    lines: z.array(quotationLineSchema.omit({ id: true })),
    /** The colleague who decided in the portal; never a staff member's name. */
    decidedByName: z.string().nullable(),
    /** The customer's own reason, when they rejected in the portal. */
    decisionNote: z.string().nullable(),
  });
export type PortalQuotation = z.infer<typeof portalQuotationSchema>;
