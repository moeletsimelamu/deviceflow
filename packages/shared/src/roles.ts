/**
 * Roles and permissions.
 *
 * The API enforces these on every request; the web app only uses them to decide
 * what to show. Keep this list in sync with the `Role` enum in schema.prisma
 * (a unit test in the API checks that they match).
 */
export const ROLES = ['ADMIN', 'TECHNICIAN', 'INVENTORY_MANAGER', 'CUSTOMER'] as const;
export type Role = (typeof ROLES)[number];

export const ROLE_LABELS: Record<Role, string> = {
  ADMIN: 'Administrator',
  TECHNICIAN: 'Technician',
  INVENTORY_MANAGER: 'Inventory manager',
  CUSTOMER: 'Customer',
};

/** Staff roles use the staff application; customers use the portal. */
export const STAFF_ROLES = [
  'ADMIN',
  'TECHNICIAN',
  'INVENTORY_MANAGER',
] as const satisfies readonly Role[];

/**
 * Permissions implemented so far. Later phases add repair, inventory and
 * reporting permissions here.
 *
 * Phase 3 scope decisions:
 *  - Customer records (contact details, notes, portal users) are administrator-only.
 *    Technicians get customer contact details through their assigned repair jobs (Phase 4).
 *  - Every staff role can read the asset register, which shows only the owning
 *    account's name and number. Registering and changing assets is administrator-only.
 *  - CSV export is a bulk extraction of records, so it is a separate permission.
 *  - Customers never use staff endpoints; `portal:use` covers the portal, where every
 *    query is scoped to the user's own account.
 *
 * Phase 4 (repairs):
 *  - `repairs:read` and `repairs:work` (notes, labour, quotations, status moves) are
 *    held by administrators and technicians. Technicians are further limited, in the
 *    service layer, to jobs assigned to them; any other job is "not found".
 *  - `repairs:manage` (book in, assign, close, cancel, record a customer's decision
 *    on their behalf) is administrator-only.
 *  - Which role may make each status move is in the state machine
 *    (packages/shared/src/schemas/repairs.ts), checked on top of these permissions.
 *
 * Phase 5 (inventory):
 *  - `inventory:read` (parts, stock levels and the stock ledger) is held by
 *    administrators, inventory managers and technicians, who need to see what is
 *    in stock to use parts on their jobs.
 *  - `inventory:manage` (add and edit parts, receive stock, adjust stock) is held by
 *    administrators and inventory managers.
 *  - Using parts on a job, and returning them, is repair work (`repairs:work`), done by
 *    the assigned technician or an administrator.
 *  - Inventory managers now have `repairs:read`, limited in the service layer to jobs
 *    that have used parts, without the customer's contact details. The job's notes,
 *    labour and quotations need `repairs:read_details`, which they do not have.
 *
 * Phase 6 (reporting):
 *  - `reports:operations` (devices, jobs, turnaround, billed revenue, technician
 *    workload, status distribution) is administrator-only: Phase 1 rules out revenue
 *    reports for technicians, and inventory managers have no access to prices charged.
 *  - `reports:inventory` (parts consumption, receipts, stock value, low stock) is held
 *    by administrators and inventory managers.
 */
export const PERMISSIONS = [
  'users:read',
  'users:manage',
  'settings:read',
  'settings:manage',
  'audit:read',
  'customers:read',
  'customers:manage',
  'assets:read',
  'assets:manage',
  'assets:export',
  'repairs:read',
  'repairs:read_details',
  'repairs:work',
  'repairs:manage',
  'inventory:read',
  'inventory:manage',
  'reports:operations',
  'reports:inventory',
  'portal:use',
] as const;
export type Permission = (typeof PERMISSIONS)[number];

export const ROLE_PERMISSIONS: Record<Role, readonly Permission[]> = {
  ADMIN: PERMISSIONS.filter((p) => p !== 'portal:use'),
  TECHNICIAN: [
    'settings:read',
    'assets:read',
    'repairs:read',
    'repairs:read_details',
    'repairs:work',
    'inventory:read',
  ],
  INVENTORY_MANAGER: [
    'settings:read',
    'assets:read',
    'repairs:read',
    'inventory:read',
    'inventory:manage',
    'reports:inventory',
  ],
  CUSTOMER: ['portal:use'],
};

export function hasPermission(role: Role, permission: Permission): boolean {
  return ROLE_PERMISSIONS[role].includes(permission);
}

export function isStaffRole(role: Role): boolean {
  return (STAFF_ROLES as readonly Role[]).includes(role);
}
