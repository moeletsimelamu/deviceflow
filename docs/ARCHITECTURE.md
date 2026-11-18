# Architecture

This document describes how DeviceFlow is built and why. Business rules and the
roadmap are in [PHASE-1-DISCOVERY.md](PHASE-1-DISCOVERY.md).

## System overview

```
Browser ──► web (nginx: SPA + reverse proxy) ──/api──► api (Express) ──► PostgreSQL
            same origin, so no CORS                    Prisma 7 + pg driver adapter
```

In development, Vite (port 5173) plays nginx's role and proxies `/api` to the API on
port 3000. In both setups the browser only ever talks to one origin. That keeps
cookie-based sessions simple and means CORS is never enabled.

## Monorepo

npm workspaces, with three packages:

| Package           | Responsibility                                                                           |
| ----------------- | ---------------------------------------------------------------------------------------- |
| `packages/shared` | Zod request/response schemas, roles, permissions, error codes. Used by both API and web. |
| `apps/api`        | HTTP API, business rules, persistence, audit.                                            |
| `apps/web`        | Single-page app: the staff application and the customer portal.                          |

`@deviceflow/shared` exports a custom `source` condition that points at its
TypeScript source. Vite, Vitest, `tsc` (`customConditions`) and Node in dev
(`--conditions=source`) use it, so a change to a shared schema takes effect
everywhere without a build step. Production builds use the compiled `dist`.

## API layering

```
route (HTTP)  →  service (business rules)  →  Prisma (persistence)
```

- **Routes** (`*.routes.ts`) are the controllers. They validate input with the
  shared Zod schemas (`parse()`), call one service function and shape the response.
  They contain no business rules.
- **Services** (`*.service.ts`) hold the rules: permission scoping, invariants,
  transactions and audit writes. They receive an explicit `Actor` and
  `RequestContext`, so they can be reasoned about and tested without HTTP.
- **No repository layer.** Prisma is already a typed data-access layer, and wrapping
  it again would add indirection without benefit.

Modules live in `apps/api/src/modules/<name>/`. Cross-cutting code is in `src/http`
(middleware) and `src/lib` (errors, validation, audit, crypto, pagination).

### Request lifecycle

1. `pino-http` assigns a request ID. A well-formed incoming `X-Request-Id` is reused,
   for example from nginx. The ID is echoed in the response header and in every
   error body.
2. `helmet` sets security headers. `express.json` parses the body, with a 100 kB limit.
3. Under `/api/v1`: `csrfProtection`, then `authenticate`, which resolves the session
   cookie to an `Actor`, then `Cache-Control: no-store`.
4. A route-level `requirePermission(...)` runs, then the handler.
5. Express 5 forwards rejected promises to `errorHandler`, which maps `AppError`,
   body-parser and Prisma errors to the standard error shape. Anything else becomes a
   logged 500 with a generic message.

### Error format

```json
{
  "error": {
    "code": "EMAIL_TAKEN",
    "message": "…",
    "details": [{ "path": "email", "message": "…" }],
    "requestId": "…"
  }
}
```

Codes are listed in `packages/shared/src/errors.ts`. Clients branch on `code`,
never on `message`.

### Transactions and concurrency

Repair jobs use pessimistic locking per job (A15) on top of optimistic `version`
checks, because several rules depend on related rows (quotations, labour) that a
version on the job row alone would not protect.

- Any change that touches several rows runs in `prisma.$transaction(async (tx) => …)`.
  This includes the change and its audit entry.
- Editable records carry a `version` column. Updates use
  `updateMany({ where: { id, version } })`, and if no row is updated the API
  returns `409 CONFLICT`. A stale form therefore cannot silently overwrite a newer
  change.

## Frontend

- **Routing:** React Router 8 in data/library mode (`createBrowserRouter`). Two
  shells: the staff app at `/` and the customer portal at `/portal`. Route guards
  (`RequireStaff`, `RequireCustomer`, `RequirePermission`) send each kind of user to
  their own area and hide pages they cannot use. They exist for user experience only;
  the API enforces every rule.
- **Server state:** TanStack Query. Query keys are defined per feature, mutations
  invalidate the affected lists, 4xx responses are not retried, and any 401 clears
  the session so the router returns to sign-in.
- **Forms:** react-hook-form with the same Zod schemas the API uses, so validation
  messages match.
- **Structure:** `src/design` holds the design system primitives, `src/features/<area>`
  holds pages, hooks and API calls per area, and `src/app` holds the router, shell and
  guards.

## Versions

| Package      | Version | Note                                                                                                                                                                                                         |
| ------------ | ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Node.js      | 22 LTS  | Runtime images use `node:22-alpine`.                                                                                                                                                                         |
| npm          | 11.21.1 | npm 10.9.x crashes on this dependency tree (`edgesOut` resolver bug). npm 11 also enforces `allowScripts`, so only four reviewed packages may run install scripts: argon2, prisma, @prisma/engines, esbuild. |
| TypeScript   | 6.0.3   | 7.0 is out, but typescript-eslint 8.72 supports only `<6.1`. Revisit when typescript-eslint adds 7.x support.                                                                                                |
| React        | 19.3    |                                                                                                                                                                                                              |
| Vite         | 8.3.5   | Pinned to a release at least two weeks old (8.3.8 was released on the day of setup).                                                                                                                         |
| React Router | 8.5     |                                                                                                                                                                                                              |
| Express      | 5.3     | Native async error propagation.                                                                                                                                                                              |
| Prisma       | 7.10.1  | Pinned exactly. The npm `latest` tag pointed at an 8.0 release candidate. Uses the `prisma-client` generator, `@prisma/adapter-pg` and `prisma.config.ts`.                                                   |
| Zod          | 4.6     |                                                                                                                                                                                                              |
| Vitest       | 5.0.5   |                                                                                                                                                                                                              |
| jsdom        | 29.1.1  | jsdom 30+ needs Node ≥ 22.22.2. 29.x keeps tests working on Node 22.13+.                                                                                                                                     |
| PostgreSQL   | 17      |                                                                                                                                                                                                              |

`vitest` and `jsdom` are declared once at the repository root, which avoids an npm
peer-resolution failure when they are declared in several workspaces.

## Decision log

| #   | Decision                                            | Reason                                                                                                                                                                                                                            |
| --- | --------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A1  | Server-side sessions in Postgres, not JWTs          | Revocation is instant (logout, deactivation, role change), and the token never touches JavaScript.                                                                                                                                |
| A2  | Same-origin deployment, no CORS                     | Simplest correct CSRF model with cookies (see SECURITY.md).                                                                                                                                                                       |
| A3  | Shared Zod schemas                                  | One definition of every request contract, used by both API and UI.                                                                                                                                                                |
| A4  | Optimistic concurrency via `version` columns        | Detects lost updates without locking rows.                                                                                                                                                                                        |
| A5  | Audit written in the same transaction               | An audited change cannot commit without its audit row.                                                                                                                                                                            |
| A6  | Customer users created only from customer accounts  | Every customer login belongs to exactly one account (Phase 3). The admin user API accepts staff roles only.                                                                                                                       |
| A7  | Login rate limiter is created per app instance      | Correct isolation in tests. Production runs one API instance; multiple instances need a shared store (SECURITY.md).                                                                                                               |
| A8  | `node --watch --import tsx` for API dev             | `tsx watch` hangs under `concurrently` on Windows.                                                                                                                                                                                |
| A9  | Portal endpoints separate from staff endpoints      | `/portal/*` takes the account from the session and returns narrower DTOs (no staff notes, reasons or staff names). Scoping cannot be forgotten on a staff endpoint, and a staff DTO change cannot leak into the portal.           |
| A10 | Lifecycle history table plus the audit log          | `asset_events` is the business history shown to users (including customers). `audit_logs` is the technical record with before/after snapshots for administrators. Both are append-only.                                           |
| A11 | Serial uniqueness enforced by a unique index        | An application-level "check then insert" has a race. The index on normalised values cannot be bypassed, and the API turns its error into a helpful `409 SERIAL_TAKEN`.                                                            |
| A12 | OpenAPI generated from the Zod schemas              | The description cannot drift from validation. Operations are listed by hand with their permission; tests check the committed file is current and every documented route exists.                                                   |
| A13 | Asset status changes have their own endpoint        | `PATCH` edits details only. Each lifecycle move goes through one place that checks the transition table, requires reasons where needed and writes history.                                                                        |
| A14 | CSV export streamed in a REPEATABLE READ snapshot   | The file is consistent even while assets change. It is capped at 10,000 rows and audited, because an export is a bulk extraction of customer data.                                                                                |
| A15 | Every repair mutation locks the job row first       | `SELECT … FOR UPDATE` serialises all changes to one job, so each rule (state machine, quote status, labour present) is checked against the current row. `version` still detects a user acting on a stale screen.                  |
| A16 | One function changes a job's status                 | `moveJob` applies the move, writes the history row and moves the device in or out of `IN_REPAIR`. Assign, issue, approve and the generic transition all go through it; nothing updates `status` directly.                         |
| A17 | Idempotency key stored in the change's transaction  | Saving the key and its response in the same transaction gives at-most-once without a "pending" state that a crash could leave behind. Duplicates wait on the unique index and then replay.                                        |
| A18 | Services take the transaction client                | Repair services receive `tx`, so the idempotency wrapper (and the seed) can run them inside one transaction.                                                                                                                      |
| A19 | Integer cents and hundredths for quantities         | No floating-point money. VAT once per quotation, half-up, frozen at issue (D3).                                                                                                                                                   |
| A20 | Database triggers freeze issued quotations          | The rule "issued quotations are immutable" holds even for code that bypasses the service (scripts, a future bug).                                                                                                                 |
| A21 | Stock decreases are one conditional `UPDATE`        | `quantity_on_hand >= n` is checked by the statement that changes it, so racing requests cannot overdraw stock and no read-then-write window exists. A CHECK constraint is the backstop. No explicit row lock is needed.           |
| A22 | Stock figure and ledger checked at commit           | Deferred constraint triggers refuse any transaction where a part's stock differs from the sum of its movements, so the stored balance can never drift from the ledger, whatever code writes it.                                   |
| A23 | The ledger is the record of repair part use         | Repair use and returns are stock movements carrying the job id, instead of a separate `RepairPartUsage` table (Phase 1). One record per fact; net use per job is a sum.                                                           |
| A24 | Weighted average cost, changed only by purchases    | Simple, standard valuation computed in the same `UPDATE` as the delivery. Movements keep the unit cost at the time, so reports (Phase 6) can value consumption without recomputing history.                                       |
| A25 | Inventory managers read repairs through a scope     | `staffScope` limits them to jobs with stock movements and the DTO drops the contact; notes, labour and quotations need `repairs:read_details`. Same pattern as the technician scope, enforced in the service.                     |
| A26 | Reports computed live from the transactional tables | At this scale (thousands of jobs) indexed aggregate queries answer in milliseconds, and there is no second copy of the data to fall out of date. A summary table or materialised view is the next step if reports slow down.      |
| A27 | One REPEATABLE READ transaction per report          | Every figure on the page comes from the same snapshot, so totals agree with each other even while jobs and stock change.                                                                                                          |
| A28 | Report days are UTC calendar days                   | Consistent with the activity-log filters and simple to test. A company time-zone setting is the fix if late-evening events landing on the next day matter (decision to check).                                                    |
| A29 | Charts without a chart library                      | Bars, columns and a tooltip in plain React and CSS keep the bundle from growing (Recharts was planned in Phase 1) and follow DESIGN.md's chart rules; every chart has a table view.                                               |
| A30 | Authorisation matrix written by hand                | The expected access for each operation is spelled out in the test instead of being computed from `ROLE_PERMISSIONS`, so the test is an independent statement of intent. A route count ties it to what the server actually mounts. |
| A31 | Library 4xx errors are client errors                | Errors from Express and body-parser that carry a 4xx status keep it (with our own message) instead of becoming `500`. Server errors still log the stack and return a generic message.                                             |
| A32 | End-to-end tests own their database                 | Playwright rebuilds `<db>_e2e` with the demo data and a random password on each run, so tests never depend on, or change, a developer's data. The same suite runs against the Docker images in CI via `E2E_BASE_URL`.             |
| A33 | Accessibility checked by axe on every screen        | Contrast was fixed at the token level (`ink-subtle` darkened) rather than per component, so every use passes. axe finds a share of problems only; keyboard behaviour has its own tests.                                           |
