# Project history

DeviceFlow was built in phases. Each phase ended with a report (what was built, the
decisions taken, real test output and the risks left open) and an approval before the
next one started. The plan for every phase is the roadmap in
[PHASE-1-DISCOVERY.md](PHASE-1-DISCOVERY.md#6-roadmap); this page records what each
phase actually delivered.

The decision numbers (A1, A2, …) refer to the decision log in
[ARCHITECTURE.md](ARCHITECTURE.md#decision-log). Test counts are the suites as they
stood at the end of each phase.

| Phase                                              | Dates (2026)    | Shared | API | Web | End to end |
| -------------------------------------------------- | --------------- | -----: | --: | --: | ---------: |
| [1 Discovery](#phase-1-discovery)                  | 11–12 Nov       |      – |   – |   – |          – |
| [2 Foundation](#phase-2-foundation)                | 12 Nov          |     12 |  33 |   6 |          – |
| [3 Assets & customers](#phase-3-assets--customers) | 12 Nov          |     21 |  88 |  13 |          – |
| [4 Repairs](#phase-4-repairs)                      | 12 Nov          |     32 | 373 |  18 |          – |
| [5 Inventory](#phase-5-inventory)                  | 13 Nov          |     38 | 420 |  23 |          – |
| [6 Reporting](#phase-6-reporting)                  | 13 Nov          |     43 | 429 |  30 |          – |
| [7 Quality](#phase-7-quality)                      | 17–18 Nov       |     43 | 504 |  33 |         20 |
| [8 Deployment](#phase-8-deployment)                | Not started yet |        |     |     |            |

Every suite passed at the end of its phase. Phases 1 to 6 were published to GitHub
together on 13 November 2026 as a single commit ("initial release of DeviceFlow
through Phase 6"), which is why the GitHub history starts there; from Phase 7 on,
every change arrived through a pull request with CI.

## Phase 1: Discovery

Requirements, business rules and the plan, before any code.

- Checked the machine and the current versions of every tool and library on the npm
  registry, and chose exact versions (see [ARCHITECTURE.md](ARCHITECTURE.md#versions)).
- Wrote down the roles and what each may do, the repair state machine, how
  quotations, stock and assets behave, protection against duplicate submissions, and
  what the audit log records.
- Proposed the architecture: an npm workspaces monorepo with a shared package, a
  layered Express API, a React single-page app, and PostgreSQL in Docker.
- **Decisions taken with the owner:** Docker Desktop for the database everywhere
  (D1); administrators may record a quotation decision on the customer's behalf, with
  a channel and a note (D2); ZAR with 15% VAT, frozen on each issued quotation (D3);
  several customer users per organisation (D4).

## Phase 2: Foundation

The skeleton every later phase builds on.

- Monorepo with TypeScript, ESLint and Prettier; environment validation; structured
  logging; one error format for the whole API.
- Prisma schema and first migration; sign-in, sign-out and sessions; role-based
  permissions; staff user administration; company settings; the audit log; the demo
  seed.
- The design system (tokens, components) and the staff app shell; Docker images, the
  Compose stack and the first CI workflow.
- **Key decisions:** server-side sessions in PostgreSQL instead of JWTs, so sign-out
  and deactivation take effect at once (A1); one origin for the app and the API, so
  there is no CORS to get wrong (A2); request schemas shared by the API and the web
  app (A3); `version` columns to catch lost updates (A4); audit rows written in the
  same transaction as the change they describe (A5).

## Phase 3: Assets & customers

- Customer accounts with contacts; customer portal users tied to exactly one account.
- The asset register: generated asset tags, serial numbers unique per manufacturer,
  a lifecycle with only allowed status moves, reassignment, search, filters, sorting
  and pagination, and an audited CSV export.
- The activity log, and the first version of the customer portal (a customer's own
  devices and their history).
- A generated OpenAPI description of the API.
- **Key decisions:** separate portal endpoints that take the account from the session
  (A9); a business history table for assets next to the audit log (A10); serial
  uniqueness enforced by a database index rather than a check in code, which can race
  (A11); OpenAPI generated from the same schemas that validate requests (A12); the CSV
  export read from one consistent snapshot (A14).

## Phase 4: Repairs

The core workflow.

- Repair jobs booked in by staff or requested in the portal; assignment; diagnosis
  notes; labour; quotations with revisions; approval or rejection by the customer in
  the portal, or by an administrator on the customer's behalf.
- The full status workflow, enforced by one state machine shared by the API and the
  web app, with a status history that cannot be edited.
- Protection against double submissions (idempotency keys) and against two people
  changing the same job at once.
- **Key decisions:** every change to a job locks its row first (A15); one function
  changes a job's status, so the history and the device's status can never disagree
  (A16); idempotency keys stored in the same transaction as the change (A17); money in
  integer cents and quantities in hundredths, with VAT rounded once per quotation
  (A19); database triggers that freeze a quotation once it is issued (A20).
- **Found in the browser check:** the status column was cut off on phones, the portal
  navigation wrapped, and repair tables scrolled inside the asset and customer pages.
  All three were fixed before the phase closed.

## Phase 5: Inventory

- Parts with reorder levels and shelf locations; deliveries at a weighted average
  cost; adjustments that need a reason; archiving.
- An append-only stock ledger with the balance after every movement.
- Parts used on repair jobs, and unused units returned; low-stock alerts on the
  dashboard and the Inventory page.
- **Key decisions:** a stock decrease is a single conditional `UPDATE`, so stock can
  never go below zero, even when two people take the last unit at once (A21); the
  stock figure and the ledger are checked against each other at commit (A22); the
  ledger is the record of parts used on repairs (A23); inventory managers can read
  only the repair jobs that used parts (A25). A test proves the concurrent case.

## Phase 6: Reporting

- A Reports page with a date range: billed revenue, jobs booked in and completed,
  turnaround, open jobs by status, technician workload, parts consumption, stock
  received, stock value and low stock.
- Stat tiles for the headline figures, accessible charts with keyboard tooltips, and a
  table view for every chart.
- **Key decisions:** reports computed live from the transactional tables (A26); every
  figure on the page read from one consistent snapshot (A27); report days counted in
  UTC (A28); charts drawn without a chart library (A29). Report figures are checked
  against seeded fixtures in tests.

## Phase 7: Quality

A review of the whole application rather than new features. Full details are in
[SECURITY.md](SECURITY.md) and [TESTING.md](TESTING.md).

- **Authorisation matrix:** every one of the 72 API operations called signed out and
  as every role, against a hand-written table of who may call it (A30).
- **Error handling:** malformed URLs and corrupt or unsupported request bodies now
  return `400` or `415` instead of `500` (A31); a crash in one page keeps the app
  usable.
- **Security headers and dependencies:** each header sent once behind nginx (the API's
  conflicting `X-Frame-Options` copy is dropped); a dependency audit with every
  advisory triaged.
- **Accessibility:** every screen passes axe-core's WCAG 2.2 AA rules (A33), plus
  keyboard tests.
- **Playwright end-to-end tests** of the whole definition of done, from booking a
  device in to the revenue report, on their own database or against the Docker images
  in CI (A32).
- **Bugs the new tests found:** reloading a device page behind nginx returned a 404,
  because the built files and the device pages shared the `/assets/` address (built
  files moved to `/static/`); the portal's repair form listed only the first 20
  devices; and `db:reset` passed a flag Prisma 7 no longer accepts.

## After Phase 7

- **[#1](https://github.com/moeletsimelamu/deviceflow/pull/1) Phase 7 quality pass:**
  the first pull request, and the first green run of the end-to-end CI job.
- **[#2](https://github.com/moeletsimelamu/deviceflow/pull/2) Present the project on
  GitHub:** the README rewritten for visitors with screenshots, the licence, and an
  "Open repairs" panel on the dashboard in place of the build-out checklist.
- **[#3](https://github.com/moeletsimelamu/deviceflow/pull/3) Demo history:** the demo
  seed adds about five months of finished jobs, so the reports and the portal look like
  a workshop that has been running for a while.

## Phase 8: Deployment

Not started yet, on hold by choice. The plan (production configuration, secrets,
image publishing, backups and deployment to a chosen host) is in
[DEPLOYMENT.md](DEPLOYMENT.md#to-do-in-phase-8), and the hosting target is still to
be chosen.
