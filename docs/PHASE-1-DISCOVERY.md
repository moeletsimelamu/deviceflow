# DeviceFlow — Phase 1: Discovery

Status: **Draft for approval** · Date: 2026-11-11

This document records the environment findings, the interpreted requirements, the
ambiguities that need a decision, the proposed architecture and the delivery
roadmap. Nothing has been implemented yet. After approval, its content is split into
`ARCHITECTURE.md`, `DATABASE.md`, `SECURITY.md` and `DESIGN.md` during Phase 2.

---

## 1. Environment findings

Checked on the development machine (Windows 11 Home):

| Tool                    | Found             | Impact                                                                                 |
| ----------------------- | ----------------- | -------------------------------------------------------------------------------------- |
| Node.js                 | 22.14.0           | OK. Node 22 is LTS (maintenance until April 2027). Prisma 7 needs ≥ 22.12.             |
| npm                     | 10.9.2            | OK. We use **npm workspaces** (pnpm/yarn are not installed, and npm is enough).        |
| Git                     | 2.54.0            | OK. No repository exists yet.                                                          |
| Docker / Docker Compose | **Not installed** | **Blocker for Phase 2.** Docker Desktop on Windows Home also needs WSL 2.              |
| WSL                     | **Not installed** | Required by Docker Desktop.                                                            |
| PostgreSQL              | **Not installed** | We need either Docker or a native install for local development and integration tests. |
| GitHub CLI (`gh`)       | Not installed     | Optional. GitHub Actions does not need it locally.                                     |

### Package versions (looked up on the npm registry today)

| Area     | Package                 | Planned version              | Note                                                                                                                                                                                                                       |
| -------- | ----------------------- | ---------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Language | typescript              | 7.0.x (fallback 6.0.3)       | 7.0 is the native-compiler release and the current stable version. Some tools (typescript-eslint, tsx) may not support it fully yet. Phase 2 checks that. If anything breaks, we pin 6.0.3 and write down why.             |
| Frontend | react / react-dom       | 19.3.x                       |                                                                                                                                                                                                                            |
|          | vite                    | 8.3.x                        | 8.3.8 was published today. We pin a patch that is at least two weeks old.                                                                                                                                                  |
|          | react-router            | 8.5.x                        | Used in SPA (library/data) mode, not framework mode.                                                                                                                                                                       |
|          | @tanstack/react-query   | 5.107.x                      |                                                                                                                                                                                                                            |
|          | react-hook-form + zod   | 7.92.x / 4.6.x               |                                                                                                                                                                                                                            |
|          | tailwindcss             | 4.3.x                        | Used only as the layer for our own design tokens (see §7).                                                                                                                                                                 |
|          | @radix-ui/* primitives  | current 1.x                  | Headless and accessible: dialogs, menus, popovers, tabs.                                                                                                                                                                   |
|          | recharts                | 3.10.x                       | Dashboard charts.                                                                                                                                                                                                          |
| Backend  | express                 | 5.3.x                        | Express 5 passes errors from async handlers to the error middleware on its own.                                                                                                                                            |
|          | prisma / @prisma/client | **7.10.1 (pinned together)** | ⚠ The `latest` npm tag for `prisma` currently points at **8.0.0-rc.33**, a release candidate. Running a plain `npm i prisma` would install a pre-release CLI that does not match the 7.10.1 client. We pin exact versions. |
|          | zod                     | 4.6.x                        | Shared validation schemas. Zod 4 can generate JSON Schema itself, which we use for the OpenAPI document.                                                                                                                   |
|          | pino / pino-http        | 10.x                         | Structured JSON logs.                                                                                                                                                                                                      |
|          | argon2                  | 0.45.x                       | Password hashing (argon2id). If the native build fails on Windows, we fall back to bcrypt 6.                                                                                                                               |
|          | helmet                  | 8.x                          | Security headers.                                                                                                                                                                                                          |
| Testing  | vitest                  | 5.1.x (fallback 5.0.x)       | One test runner for the frontend and the backend.                                                                                                                                                                          |
|          | supertest               | 7.3.x                        |                                                                                                                                                                                                                            |
|          | @playwright/test        | 1.65.x                       |                                                                                                                                                                                                                            |
| Database | PostgreSQL              | 17                           | Image `postgres:17-alpine`. Conservative choice, with wide tool support.                                                                                                                                                   |

---

## 2. Requirements as interpreted

### 2.1 Scope assumptions (please correct any that are wrong)

1. **Single tenant.** One service company runs DeviceFlow. It serves many customer accounts. This is not a multi-company SaaS.
2. **Customer accounts** are `INDIVIDUAL` or `ORGANISATION`. An organisation (for example a school) can have several contacts. Customer users belong to exactly one account and see only that account's devices and repairs.
3. **No payments, invoicing or accounting integration in v1.** "Repair revenue" therefore means the **billed value of approved quotations on completed jobs**, not cash received. The UI and the docs will say so.
4. **No email or SMS sending in v1.** Status changes are visible in the portal and in the activity feed. We will not build a fake "email sent" feature. If you want notifications later, a real provider goes in a later phase, and a local mail catcher (Mailpit) can be used for development.
5. **No file attachments in v1** (damage photos, signed forms). They are a good later addition, but they bring storage and malware-scanning decisions.
6. **Money** is stored as integer minor units (cents) with one company currency. The VAT/tax rate lives in company settings.
7. **Seed data** (users, customers, assets, parts) is for development and demos only. It never runs in production, and the seed script refuses to run when `NODE_ENV=production`.

### 2.2 Roles and permission model

Permissions are code-defined strings mapped to roles, for example `assets:create` or
`repairs:transition`. On top of permissions there is **row-level scoping**, applied in
the service layer:

| Role              | Scope rule enforced on the server                                                                                                                                                                           |
| ----------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Administrator     | All records.                                                                                                                                                                                                |
| Technician        | Repair jobs assigned to them, plus read access to the related asset and customer contact. Cannot see revenue reports or other technicians' jobs, except a read-only job board (to be decided; default: no). |
| Inventory Manager | All parts and stock movements. Read access to repair jobs that consume parts. No access to customer contact details beyond the account name.                                                                |
| Customer          | Only records where `customerAccountId` equals their own account. A request for any other ID returns **404, not 403**, so the API does not reveal whether the record exists.                                 |

Hiding buttons in the UI is a convenience only. Every endpoint checks permission and scope.

---

## 3. Core business rules

### 3.1 Repair job state machine

Repair status is a Postgres enum. Status can change **only** through
`POST /repairs/:id/transitions` or through domain actions that call the same state
machine (assign, issue quote, approve quote). Direct status updates are never allowed.

```
                ┌──────────── CANCELLED ◄──────────────┐ (from SUBMITTED … REJECTED)
                │                                       │
SUBMITTED ─► ASSIGNED ─► DIAGNOSING ─► AWAITING_APPROVAL ─► APPROVED ─► IN_REPAIR ⇄ AWAITING_PARTS
                              ▲               │                              │
                              │               ▼                              ▼
                              └──────── QUOTE_REJECTED ──► RETURNED_UNREPAIRED   QUALITY_CHECK
                                 (revise quote)                               │      │ fail
                                                                              ▼      └──► IN_REPAIR
                                                                          COMPLETED ─► CLOSED (collected)
```

| Transition                            | Guard (checked on the server, inside the transaction)                      | Allowed roles                                                                          |
| ------------------------------------- | -------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| SUBMITTED → ASSIGNED                  | A technician with role TECHNICIAN and an active account is set             | Admin                                                                                  |
| ASSIGNED → DIAGNOSING                 | Actor is the assigned technician                                           | Technician (assigned), Admin                                                           |
| DIAGNOSING → AWAITING_APPROVAL        | An **issued** quotation exists with ≥ 1 line and total > 0                 | Technician (assigned), Admin                                                           |
| AWAITING_APPROVAL → APPROVED          | **Only** through the quotation-approval action, never a generic transition | Customer (own account), Admin on the customer's behalf (channel and note required, D2) |
| AWAITING_APPROVAL → QUOTE_REJECTED    | Only through quotation rejection                                           | Same as approval                                                                       |
| QUOTE_REJECTED → DIAGNOSING           | A revised quotation will be issued                                         | Technician, Admin                                                                      |
| QUOTE_REJECTED → RETURNED_UNREPAIRED  | —                                                                          | Admin                                                                                  |
| APPROVED → IN_REPAIR                  | —                                                                          | Technician (assigned)                                                                  |
| IN_REPAIR ⇄ AWAITING_PARTS            | Reason note required                                                       | Technician (assigned)                                                                  |
| IN_REPAIR → QUALITY_CHECK             | ≥ 1 labour entry recorded                                                  | Technician (assigned)                                                                  |
| QUALITY_CHECK → COMPLETED / IN_REPAIR | Completion summary required                                                | Technician, Admin                                                                      |
| COMPLETED → CLOSED                    | Device handed back                                                         | Admin                                                                                  |
| * → CANCELLED                         | Only before APPROVED; reason required                                      | Admin; Customer only from SUBMITTED                                                    |

Every transition writes a `RepairStatusHistory` row and an `AuditLog` row in the same
transaction. It also updates the asset's lifecycle status: the asset becomes
`IN_REPAIR` when the job is submitted and returns to its previous status when the job
is closed, returned unrepaired or cancelled.

### 3.2 Quotations

- A quotation moves through `DRAFT → ISSUED → APPROVED | REJECTED | SUPERSEDED`.
- A repair can have several quotation **revisions**, but only one can be `ISSUED` at a time. Issuing a new revision marks the old one `SUPERSEDED`.
- `ISSUED` quotations are **immutable**. Their lines and totals are frozen, and changes require a new revision.
- Approval is a conditional update: `UPDATE … SET status='APPROVED' WHERE id=$1 AND status='ISSUED' AND version=$2`. If no row is updated, the API returns 409. A double click or a stale tab therefore cannot approve twice, or approve a superseded quote.
- Approval stores `approvedBy`, `approvedAt`, the channel (`PORTAL` or an on-behalf channel) and the exact total that was approved.

### 3.3 Inventory

- `StockMovement` is an **append-only ledger** (`PURCHASE`, `ADJUSTMENT_IN`, `ADJUSTMENT_OUT`, `REPAIR_CONSUMPTION`, `REPAIR_RETURN`). Corrections are new reversing movements and never edits.
- `Part.quantityOnHand` is a stored balance that changes only in the same transaction as a movement. It is protected by a database `CHECK (quantity_on_hand >= 0)` constraint. Prisma cannot declare CHECK constraints, so this one is added as raw SQL in the migration and noted in `DATABASE.md`.
- Stock decreases use `UPDATE parts SET quantity_on_hand = quantity_on_hand - $n WHERE id=$1 AND quantity_on_hand >= $n`. If no row is updated, the API returns 409 "insufficient stock". This prevents negative stock even when two requests arrive at the same moment, and the CHECK constraint is the final backstop.
- Parts can be recorded against a repair only in `IN_REPAIR`, `AWAITING_PARTS` or `QUALITY_CHECK`.
- A low-stock alert fires when `quantityOnHand <= reorderLevel`. It is computed in queries, so no background job is needed.

### 3.4 Assets

- The asset tag is generated as `DF-{YYYY}-{000001}` from a Postgres sequence. It is unique and never reused.
- Serial-number uniqueness is a unique index on `(manufacturer_normalised, serial_number_normalised)`, using trimmed, upper-cased values. The serial can be empty for devices without one, and Postgres allows several NULLs.
- Asset lifecycle status: `IN_STOCK → ACTIVE ⇄ IN_REPAIR → REFURBISHING → RETIRED → DISPOSED`. It uses its own small transition table and writes an `AssetEvent` history row for each change.
- CSV export streams the current filtered list. It applies the same scope rules and is capped and audited.

### 3.5 Duplicate-request protection

- Critical `POST` endpoints accept an `Idempotency-Key` header: creating a repair request, issuing, approving or rejecting a quote, recording part consumption, and stock purchases or adjustments. The frontend sends one key per form submission.
- Keys are stored in an `idempotency_keys` table together with the user, route, request hash and saved response. A repeat with the same key and the same body replays the saved response. The same key with a different body returns 422.
- `RepairJob` and `Quotation` carry a `version` column for optimistic concurrency. A stale update returns 409.

### 3.6 Audit

`AuditLog(actorUserId, action, entityType, entityId, before JSONB, after JSONB,
repairJobId?, assetId?, requestId, ipAddress, createdAt)` is written **inside the same
transaction** as the change it describes. No API can update or delete it. Sensitive
fields such as password hashes and tokens are removed before the snapshot is saved.

---

## 4. Proposed architecture

### 4.1 Repository layout (npm workspaces monorepo)

```
deviceflow/
├─ apps/
│  ├─ api/                 Express + Prisma
│  │  ├─ prisma/           schema.prisma, migrations/, seed.ts
│  │  └─ src/
│  │     ├─ config/        env validation (zod), logger
│  │     ├─ http/          app.ts, middleware (requestId, auth, permit, validate, idempotency, errors)
│  │     ├─ modules/
│  │     │  ├─ auth/       routes.ts · controller.ts · service.ts · schemas.ts
│  │     │  ├─ users/  customers/  assets/  repairs/  quotations/
│  │     │  ├─ inventory/  reports/  audit/  settings/
│  │     └─ lib/           prisma client, transaction helper, pagination, errors
│  └─ web/                 Vite + React
│     └─ src/
│        ├─ app/           router, providers, layouts (StaffShell, PortalShell)
│        ├─ design/        tokens, primitives (Button, Field, Table, StatusBadge…)
│        ├─ features/      assets/, repairs/, inventory/, customers/, reports/, admin/, portal/
│        └─ lib/           api client, query keys, auth context
├─ packages/
│  └─ shared/              zod schemas, enums, state-machine definitions, permission names
├─ e2e/                    Playwright specs (definition-of-done flow)
├─ docker/                 Dockerfiles, nginx.conf
├─ docker-compose.yml      db + api + web (dev)
├─ docker-compose.prod.yml
└─ .github/workflows/ci.yml
```

**Why a shared package:** the request schemas and the state-machine table are defined
once. The API uses them for enforcement. The UI uses them only for hints, such as which
buttons to show and early form validation. The server is still the authority.

### 4.2 Backend layering

`route → controller → service → Prisma`

- **Controllers** are thin. They parse the request (already validated by zod middleware), call one service method and shape the response. They contain no business rules.
- **Services** hold the business rules, permission scoping, state transitions and transactions (`prisma.$transaction` with an interactive callback). They take an explicit `actor` (user id, role, customer account id) so the rules can be tested without HTTP.
- **No repository layer** over Prisma. Prisma already provides that abstraction, and adding another one would be the "unnecessary abstraction" the brief warns about.

### 4.3 Cross-cutting concerns

| Concern        | Approach                                                                                                                                                                                                                                                                                                                             |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Authentication | **Server-side sessions** stored in Postgres, identified by a random 256-bit token in an `httpOnly`, `Secure`, `SameSite=Lax` cookie. Only the SHA-256 hash of the token is stored. Sessions are easy to revoke (logout, deactivated user, role change), which is harder with stateless JWTs, and the token never touches JavaScript. |
| CSRF           | SameSite=Lax cookie, plus an `Origin` check and a required `X-Requested-With` header on state-changing requests.                                                                                                                                                                                                                     |
| Passwords      | argon2id, at least 12 characters, rate limiting and progressive delay on `/auth/login`, and a generic "invalid credentials" message.                                                                                                                                                                                                 |
| Validation     | zod schemas from `packages/shared` validate body, query and params.                                                                                                                                                                                                                                                                  |
| Errors         | One JSON shape: `{ "error": { "code": "QUOTE_NOT_ISSUED", "message": "…", "details": […], "requestId": "…" } }`, with consistent status codes: 400 validation, 401, 403, 404, 409 conflict/state, 422 semantic, 429.                                                                                                                 |
| Pagination     | `?page=&pageSize=&sort=field:asc&filter…`. Responses look like `{ data, meta: { page, pageSize, total } }`. Sort fields come from an allow-list per resource.                                                                                                                                                                        |
| Logging        | pino and pino-http, with a request ID on every log line and response. Cookies, the authorization header and password fields are redacted.                                                                                                                                                                                            |
| Config         | `src/config/env.ts` validates `process.env` with zod at startup and stops the process with a clear message if anything is missing. A `.env.example` is committed and `.env` is gitignored.                                                                                                                                           |
| API docs       | An OpenAPI 3.1 document generated from the zod schemas, served at `/api/docs` in non-production environments, with a hand-written `API.md` for workflows.                                                                                                                                                                            |
| Health         | `/health/live` and `/health/ready` (ready also checks the database).                                                                                                                                                                                                                                                                 |

### 4.4 Data model (first pass; full ERD goes in DATABASE.md)

`User` · `Session` · `CustomerAccount` · `CustomerContact` · `Asset` · `AssetEvent` ·
`RepairJob` · `RepairStatusHistory` · `RepairNote` (type: `FAULT`, `DIAGNOSTIC`, `REPAIR`,
`INTERNAL`, `CUSTOMER_VISIBLE`) · `LabourEntry` · `Quotation` · `QuotationLine` ·
`Part` · `StockMovement` · `RepairPartUsage` (links repair ↔ movement) · `AuditLog` ·
`IdempotencyKey` · `CompanySettings`

Key constraints and indexes:

- Unique: `users.email` (case-insensitive via `citext` or a lower-cased column), `assets.asset_tag`, `(manufacturer_norm, serial_norm)`, `parts.sku`, `repair_jobs.reference` (`RJ-000123`).
- CHECK: `parts.quantity_on_hand >= 0`, `quotation_lines.quantity > 0`, money columns `>= 0`.
- Foreign keys use `ON DELETE RESTRICT`. Business records are never hard-deleted. They are archived or deactivated, which keeps history intact.
- Indexes: `repair_jobs(status)`, `repair_jobs(assigned_technician_id, status)`, `repair_jobs(customer_account_id)`, `assets(customer_account_id)`, `assets(status)`, `stock_movements(part_id, created_at)`, `audit_logs(entity_type, entity_id)`, `audit_logs(repair_job_id)`, plus trigram indexes for asset and customer search if plain `ILIKE` turns out too slow.

### 4.5 Frontend

- One SPA with two shells: a **Staff app** (`/app/*`) and a **Customer portal** (`/portal/*`). The route chosen after login depends on the role. Route guards are for user experience only, because the API is the authority.
- TanStack Query handles server state, with query keys per resource. Mutations invalidate the affected lists. Conflict errors (409) show a clear "this record changed — reload" message.
- Forms use react-hook-form with zod resolvers, built from the same shared schemas.
- Every data view handles four states: loading (skeleton), empty (explanation plus the main action), error (message, request ID and retry), and success.
- Destructive or irreversible actions (cancel a repair, approve or reject a quote, stock write-off) use a confirmation dialog that names the record and its consequence.

### 4.6 Testing strategy

| Layer       | Tool                                                                            | What                                                                                                                                |
| ----------- | ------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| Unit        | Vitest                                                                          | State-machine guards, money and VAT calculations, permission scoping, idempotency hashing.                                          |
| Integration | Vitest + Supertest against a **real Postgres test database** (no mocked Prisma) | Every endpoint: auth, scope (customer A cannot read customer B), invalid transitions, concurrent stock decrements, double approval. |
| Component   | Vitest + Testing Library                                                        | Forms, status badges, guarded actions.                                                                                              |
| End-to-end  | Playwright                                                                      | The 10-step definition-of-done flow from the brief, plus a customer-portal approval flow.                                           |

### 4.7 Delivery and CI

- Multi-stage Dockerfiles. The API runs on a `node:22-alpine` runtime as a non-root user. The web app is a static build served by nginx, which also reverse-proxies `/api`, so the browser sees one origin.
- GitHub Actions runs install → lint → typecheck → unit tests → integration tests (Postgres service container) → build → Playwright against Compose. Images are pushed only from `main`.
- Migrations run with `prisma migrate deploy` as a separate release step, not on app start.

---

## 5. Decisions

### Resolved (2026-11-11)

| #   | Decision                                | Outcome                                                                                                                                                                                                                                                                          |
| --- | --------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| D1  | Local database environment              | **Docker Desktop with the WSL 2 backend.** The owner installs it. Dev, integration tests and CI all use the `postgres:17-alpine` container. Machine checked: x64 CPU, virtualization enabled in firmware, 16 GB RAM.                                                             |
| D2  | Quote approval on the customer's behalf | **Allowed for Administrators, with audit.** It requires a channel (`PHONE`, `IN_PERSON`, `EMAIL`) and a note. It is stored as `approvalChannel` plus `approvedOnBehalfBy`, shown as "Approved on behalf" in the UI and the audit log, and visible to the customer in the portal. |
| D3  | Currency and tax                        | **ZAR with 15% VAT** by default, editable in `CompanySettings`. Quotation lines are stored excluding VAT. VAT is calculated per quotation and rounded half-up to the cent, and the rate is frozen on the quotation when it is issued.                                            |
| D4  | Organisation logins                     | **Multiple customer users per organisation account.** Every user linked to an account sees all of that account's devices and repairs, can submit requests and can approve quotes.                                                                                                |

### Still open (not blocking Phase 2)

5. The **hosting target** for Phase 8 (single VM with Compose, Azure, Render or Fly, and so on). This decides the deployment docs and the production Compose and secrets approach.
6. Should technicians see a **read-only board of all jobs**, or only their own? Default until decided: only their own.

---

## 6. Roadmap

Each phase ends with a report covering what was built, files, decisions, real test
output and risks, then waits for your approval.

| Phase                    | Deliverables                                                                                                                                                                                                                                                                  | Exit criteria                                                                                         |
| ------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| **2 Foundation**         | Git repo, workspaces, TS/ESLint/Prettier config, env validation, logger, error handling, Prisma schema v1 and first migration, auth (login, logout, me, sessions), RBAC middleware, user admin (basic), seed script, Docker Compose, design tokens and app shell, CI skeleton | `docker compose up` starts a working login. Auth and RBAC integration tests pass. CI is green.        |
| **3 Assets & customers** | Customer accounts and contacts CRUD, asset registration, asset tags, serial uniqueness, lifecycle events, search/filter/sort/pagination, CSV export, audit log writes and the activity feed                                                                                   | Scope tests pass (customer isolation). Duplicate-serial test passes.                                  |
| **4 Repairs**            | Repair requests (staff and portal), assignment, notes, diagnostics, labour, quotation revisions, approval and rejection, state machine, idempotency, optimistic locking, portal tracking                                                                                      | Every valid and invalid transition is covered by tests. Double-approval and stale-version tests pass. |
| **5 Inventory**          | Parts, purchases, adjustments, ledger, repair consumption and returns, low-stock alerts                                                                                                                                                                                       | Concurrent-decrement test proves stock cannot go negative.                                            |
| **6 Reporting**          | Dashboard KPIs (devices, open and completed jobs, average turnaround, billed revenue, parts consumption, technician workload, low stock, status distribution), with date-range filters                                                                                        | Report numbers checked against seeded fixtures in tests.                                              |
| **7 Quality**            | Security review (authz matrix tests, headers, rate limits, dependency audit), error-handling review, accessibility pass, Playwright definition-of-done flow                                                                                                                   | All test suites green. Known issues documented.                                                       |
| **8 Deployment**         | Production Compose and images, secrets handling, migration release step, backups note, CI/CD to the chosen host, `DEPLOYMENT.md`                                                                                                                                              | Clean-machine setup by following the README only.                                                     |

### Known risks

- **Docker missing.** Phase 2 cannot reach its exit criteria until decision 1 is made and the tooling is installed.
- **TypeScript 7 ecosystem gaps.** There may be lint or tooling incompatibilities. Mitigation: verify in Phase 2, fall back to 6.0.3 if needed, and document it.
- **Prisma 7 changes.** Prisma 7 requires a driver adapter (`@prisma/adapter-pg`), `prisma.config.ts` and an explicit client output path. We pin exact versions and avoid the `latest` tag, which points at an 8.0 release candidate.
- **argon2 native build on Windows.** The fallback is bcrypt.
- **Scope size.** This is a large application. Keeping v1 free of payments, notifications and attachments is what makes the definition of done reachable.
