import type { Role } from '@deviceflow/shared';

/** The authenticated user performing a request. Services receive this explicitly. */
export interface Actor {
  userId: string;
  role: Role;
  email: string;
  fullName: string;
  /** Set only for customer users; every portal query is scoped to it. */
  customerAccountId: string | null;
  sessionId: string;
}

/** Request metadata recorded in audit entries. */
export interface RequestContext {
  requestId: string;
  ipAddress: string | null;
}
