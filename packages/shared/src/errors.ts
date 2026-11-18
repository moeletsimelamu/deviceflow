/**
 * Machine-readable error codes returned in `error.code` by the API.
 * Clients branch on these, never on the human-readable message.
 */
export const ERROR_CODES = [
  'VALIDATION_FAILED',
  'MALFORMED_REQUEST',
  'UNAUTHENTICATED',
  'INVALID_CREDENTIALS',
  'FORBIDDEN',
  'CSRF_REJECTED',
  'NOT_FOUND',
  'CONFLICT',
  'EMAIL_TAKEN',
  'CANNOT_MODIFY_SELF',
  'ROLE_NOT_ALLOWED',
  'SERIAL_TAKEN',
  'INVALID_TRANSITION',
  'CUSTOMER_ARCHIVED',
  'CUSTOMER_REQUIRED',
  'EXPORT_TOO_LARGE',
  'REPAIR_ALREADY_OPEN',
  'ASSET_NOT_REPAIRABLE',
  'ASSET_IN_REPAIR_JOB',
  'TECHNICIAN_INVALID',
  'WRONG_REPAIR_STATUS',
  'LABOUR_REQUIRED',
  'QUOTE_NOT_ISSUED',
  'QUOTE_NOT_EDITABLE',
  'QUOTE_TOTAL_INVALID',
  'IDEMPOTENCY_KEY_REUSED',
  'SKU_TAKEN',
  'INSUFFICIENT_STOCK',
  'PART_ARCHIVED',
  'PART_HAS_STOCK',
  'RETURN_EXCEEDS_USAGE',
  'RATE_LIMITED',
  'PAYLOAD_TOO_LARGE',
  'UNSUPPORTED_MEDIA_TYPE',
  'INTERNAL_ERROR',
] as const;
export type ErrorCode = (typeof ERROR_CODES)[number];

export interface ApiErrorBody {
  error: {
    code: ErrorCode;
    message: string;
    details?: Array<{ path: string; message: string }>;
    requestId?: string;
  };
}
