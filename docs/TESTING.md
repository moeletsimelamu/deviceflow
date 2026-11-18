# Testing

| Suite                          | Location                        | Runner                           | Needs database                                    |
| ------------------------------ | ------------------------------- | -------------------------------- | ------------------------------------------------- |
| Shared unit tests              | `packages/shared/src/*.test.ts` | Vitest                           | No                                                |
| API unit and integration tests | `apps/api/test/**`              | Vitest + Supertest               | **Yes**, the real Postgres test database          |
| Web component tests            | `apps/web/src/**/*.test.tsx`    | Vitest + Testing Library (jsdom) | No                                                |
| End-to-end                     | `e2e/tests/*.spec.ts`           | Playwright + axe-core (Chromium) | Its own database (`<db>_e2e`), or a running stack |

## Running

```bash
docker compose up -d db     # integration tests need Postgres
npm test                    # every workspace
npm test -w @deviceflow/api # one workspace
```

### End-to-end tests

```bash
docker compose up -d db                              # Postgres, as above
npx playwright install chromium                      # once: Playwright's browser
npm run test:e2e                                     # whole suite
npm run test:e2e -- definition-of-done               # one file
npx playwright show-report e2e/playwright-report     # report, with traces of failures
```

By default Playwright starts its **own** API (port 3100) and web app (port 4173) against
a separate database named after yours with `_e2e` added (`deviceflow_e2e`). Before every
run that database is dropped, migrated and loaded with the demo data, and the demo users
get a random password made for the run. Your development database and your
`SEED_DEFAULT_PASSWORD` are never used. `e2e/scripts/prepare-db.ts` refuses any database
whose name does not end in `_e2e`.

To test the production images (nginx, the built web app, the compiled API) instead,
start the separate e2e copy of the Docker stack and point the tests at it. This is
what CI does:

```bash
export SEED_DEFAULT_PASSWORD=...   # any value of 12+ characters, for this stack only
docker compose -p deviceflow-e2e -f docker-compose.yml -f docker/compose.e2e.yml up -d --build --wait
docker compose -p deviceflow-e2e -f docker-compose.yml -f docker/compose.e2e.yml --profile demo run --rm seed
E2E_BASE_URL=http://localhost:8081 npm run test:e2e
docker compose -p deviceflow-e2e -f docker-compose.yml -f docker/compose.e2e.yml down -v
```

`docker/compose.e2e.yml` gives that stack its own project name, volume and ports
(8081 and 5433), so your own demo stack on 8080 is untouched. The security-header
tests run only in this mode, because only it has nginx in front.

## API integration tests

- They run against **real PostgreSQL**, never a mocked Prisma client, so constraints,
  triggers, transactions and SQL behaviour are all exercised.
- `test/helpers/global-setup.ts` runs `prisma migrate deploy` against
  `TEST_DATABASE_URL` once per run.
- Each test starts from `resetDatabase()` (TRUNCATE plus resetting the settings row).
- Test files run one at a time (`fileParallelism: false`) because they share one
  database.
- Safety: `vitest.config.ts` refuses to run if `TEST_DATABASE_URL` is missing or
  equals `DATABASE_URL`.

## What is covered

| Area                | Tests                                                                                                                                                                                                                                                         |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Authentication      | Cookie flags; only the token hash is stored; same error for unknown email, wrong password and inactive user; validation details; rate limiting; logout revokes the session; idle expiry; login and logout audited                                             |
| CSRF                | Missing client header rejected; foreign `Origin` rejected                                                                                                                                                                                                     |
| Authorisation       | Technician and inventory manager get `403` on user listing and creation                                                                                                                                                                                       |
| User administration | Create (normalised email, no hash in the response, audited); duplicate email `409`; customer role rejected; search, filter, sort allow-list and pagination; deactivation revokes sessions; stale version `409`; self-demotion blocked; `404`/`400` on bad IDs |
| Platform            | Health checks; 404 shape; malformed JSON; request-ID propagation; security headers                                                                                                                                                                            |
| Database guarantees | Audit log cannot be updated or deleted; settings table has one row                                                                                                                                                                                            |
| Shared schemas      | Email normalisation, password policy, sort allow-list, page-size cap, permissions                                                                                                                                                                             |
| Web                 | Login validation before network; API error shown; CSRF header and same-origin credentials sent; `ApiError` mapping; network failure                                                                                                                           |

### Phase 3 additions

| Area               | Tests                                                                                                                                                                                                                                                                                                                                                                         |
| ------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Customer isolation | A customer sees only their own devices; another customer's device, an unowned stock device and a random id all return `404` on detail and history; query-string parameters cannot widen the scope; staff get `403` on the portal and customers get `403` on staff endpoints                                                                                                   |
| Portal privacy     | No staff notes, reasons or staff ids in portal responses; history starts at assignment, so a previous owner is hidden                                                                                                                                                                                                                                                         |
| Duplicate serials  | Same serial typed differently (`" 7xk2 9p3 "` vs `7XK29P3`, `Dell` vs `DELL`) is rejected with `409 SERIAL_TAKEN` naming the existing tag; nothing is left behind; same serial from another manufacturer is allowed; many assets without a serial are allowed; **five simultaneous registrations of one device produce exactly one asset**; an edit cannot create a duplicate |
| Asset lifecycle    | A full valid path (stock → active → repair → active → retired → disposed) with history rows; four invalid transitions rejected with `422 INVALID_TRANSITION` and no change; `ACTIVE` needs a customer; retiring needs a reason; two simultaneous status changes from the same version: one succeeds, one gets `409`                                                           |
| Assets             | Tag format, serial normalisation, history and audit on create; archived/unknown customers refused; date rules on create and against stored values on edit; reassignment history; stale version `409`; search by serial, customer name; filters; sort; pagination                                                                                                              |
| CSV export         | Filtered rows only, quoting, formula neutralisation, byte order mark, file name, audit entry; technicians and inventory managers get `403`                                                                                                                                                                                                                                    |
| Customers          | Sequential account numbers, email normalisation, validation, search by contact name and account number, concurrency, archive signs portal users out and blocks sign-in, restore allows it again                                                                                                                                                                               |
| Contacts           | One primary contact (also enforced by the database), contact ids scoped to their account, deletion audited with the removed details                                                                                                                                                                                                                                           |
| Portal users       | Created tied to the account and can sign in; refused for archived accounts and duplicate emails; the database refuses a customer without an account                                                                                                                                                                                                                           |
| Activity           | Admin-only; filters by asset, customer, action prefix and date range                                                                                                                                                                                                                                                                                                          |
| API documentation  | `openapi.json` served without sign-in; every documented operation is a real route; the committed `docs/openapi.json` is current                                                                                                                                                                                                                                               |
| Database           | Asset history cannot be updated or deleted; an `ACTIVE` asset without a customer is refused                                                                                                                                                                                                                                                                                   |
| Web                | Status dialog offers only allowed transitions, requires a reason to retire, sends the version it was shown, blocks making an unassigned asset active, explains final statuses; activity change summaries                                                                                                                                                                      |

### Phase 4 additions

| Area                           | Tests                                                                                                                                                                                                                                                                                                                                                                                                                     |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| State machine (exit criterion) | **All 169 status pairs** through `/transitions`: allowed moves succeed with a history row, an audit row and the right device status; every other pair returns `422 INVALID_TRANSITION` and changes nothing. Every generic move is tried by every other role (admin, assigned technician, another technician, inventory manager, customer) and refused. Assign, issue and approve are each tried from **all 13 statuses**. |
| Move rules                     | Reasons, completion summary and labour required where the table says; stale version `409`; two simultaneous moves from one version: one succeeds                                                                                                                                                                                                                                                                          |
| Booking in                     | Device moves to `IN_REPAIR` with history; immediate assignment; second open job refused naming the first; **five simultaneous bookings produce one job**; stock, retired and archived-customer devices refused                                                                                                                                                                                                            |
| Idempotency                    | Replay with the same key returns the identical response and header; **four simultaneous duplicates all get the same job**; same key with a different body `422`; failed requests store nothing; malformed keys `400`                                                                                                                                                                                                      |
| Technician scope               | Lists and every detail endpoint limited to assigned jobs; reassignment removes access; inventory managers and customers `403`                                                                                                                                                                                                                                                                                             |
| Quotations                     | Cents and half-up VAT; one draft at a time; versioned edits; issue freezes VAT even after the company rate changes; empty and zero quotations refused; new revision supersedes the old                                                                                                                                                                                                                                    |
| Approval (exit criterion)      | **Superseded quotation cannot be approved**; **double approval refused**; **three customer and two admin approvals at once: exactly one succeeds**; stale version `409`; on-behalf approval needs channel and note and stores the approved total; technicians `403`; idempotent replay                                                                                                                                    |
| Portal repairs                 | Request only for own active devices; other customers' repairs `404` on every view and action (including their quote id under one's own job); no internal notes, reasons, staff names or drafts; colleague's name on own approval, channel only for on-behalf; reject with reason; cancel only while submitted                                                                                                             |
| Database guards                | One open job per device; technician and completion CHECKs; issued quotation amounts and lines frozen; decided quotations final; approval without approved total refused; one issued quotation per job; history and notes append-only                                                                                                                                                                                      |
| Devices                        | Manual `IN_REPAIR` refused; status and owner locked while a job is open                                                                                                                                                                                                                                                                                                                                                   |
| Shared unit                    | Money rounding and VAT, quantity parsing, line validation, state-machine shape (no exits from final states, approvals only via actions, cancellation only before approval), actor detection                                                                                                                                                                                                                               |
| Web                            | Quote editor live totals and the exact request body with an Idempotency-Key; invalid lines blocked; move dialog requires a reason and sends the version; quality check blocked without labour; rand input parsing                                                                                                                                                                                                         |

### Phase 5 additions

| Area                              | Tests                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| --------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Concurrent stock (exit criterion) | **12 simultaneous write-offs of 1 unit with 5 in stock: exactly 5 succeed**, 7 get `409 INSUFFICIENT_STOCK`, stock ends at 0, each success recorded a distinct balance (4, 3, 2, 1, 0). **8 repair jobs race for 3 units of one part: exactly 3 succeed.** Multi-unit requests are taken whole or not at all. A mix of deliveries, uses and write-offs at once leaves stock equal to the ledger and never below zero. Two simultaneous deliveries average the cost correctly. |
| Database backstops                | A direct `UPDATE` to negative stock is refused by the CHECK; a stock change without a movement, and a movement without a stock change, cannot commit; the ledger cannot be updated or deleted; wrong-sign movements and reasonless write-offs are refused; an over-return is refused by the trigger even when written directly                                                                                                                                                |
| Parts                             | Created by administrators and inventory managers with the SKU normalised; duplicate SKU (any case) `409 SKU_TAKEN`; SKU and reorder-level validation; versioned edits; archive refused while stock remains, archived parts refuse movements, restore; low and out-of-stock filters, search and sort; audit entries                                                                                                                                                            |
| Purchases and adjustments         | Weighted average cost rounded half-up (including a 1.5-cent case); adjustments need a reason and record the average cost; insufficient stock says how many are left; a repeated delivery with the same Idempotency-Key is applied once; ledger lists newest first, per part and filtered by type and date                                                                                                                                                                     |
| Parts on repair jobs              | Use by the assigned technician records the job, the balance and the cost, with an audit entry carrying the job, device and customer; net-of-returns summary with costs; **tried from all 13 statuses: allowed only in repair, awaiting parts and quality check**; other technicians `404`, inventory managers and customers `403`; archived and unknown parts refused; double-clicked use applied once                                                                        |
| Returns                           | At most the job's net use of that part; another job's parts cannot be returned; returns go back at the job's cost and leave the average unchanged                                                                                                                                                                                                                                                                                                                             |
| Inventory manager scope           | Sees only jobs that used parts, with no contact details; can read parts and history but gets `403` on notes, labour and quotations, and on every change                                                                                                                                                                                                                                                                                                                       |
| Permissions                       | Technicians read stock but get `403` on every stock change; customers have no inventory access                                                                                                                                                                                                                                                                                                                                                                                |
| Shared unit                       | Stock state thresholds, SKU normalisation, whole-unit quantities and whole-cent costs, required adjustment reasons, part-use statuses, inventory permissions                                                                                                                                                                                                                                                                                                                  |
| Web                               | Adjustment form blocks removing more than is in stock and requires a reason, then sends the exact body with an Idempotency-Key; delivery form reads rand amounts into cents and shows the new stock level; using a part requires choosing one first; whole-unit parsing                                                                                                                                                                                                       |

### Phase 6 additions

The exit criterion is that report numbers are checked against fixtures.
`test/integration/reports.test.ts` builds a small, fully known world:

- 11 repair jobs in every kind of state, and 4 technicians, one of them deactivated
  and one deactivated with no work
- quotations that are approved, issued and superseded
- labour entries, 2 stock devices, 6 parts, and 12 timed stock movements

Every expected figure is worked out by hand in the test's comments. The range edges
are tested on purpose: events at `00:00:00.000` on the first day and `23:59:59.999` on
the last are counted, and events at `00:00:00.000` the day after are not.

| Area                        | Tests                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Operations (exit criterion) | Devices by status and registered in range; open, opened, completed and abandoned jobs; **turnaround average 42.5 h and median 42 h** from four known durations; **billed revenue R2 000.00 excl. VAT** from four approved quotations (a superseded revision, an issued quotation and a job completed one millisecond after the range are excluded); open jobs by status with zeros; technician workload (completed jobs waiting for collection are not open workload; a deactivated technician with no work is left out) |
| Trend                       | 31 daily buckets with every opening, completion and rand of revenue on the right day, totals matching the headline figures; weekly buckets start on Monday (the first one before `from`); monthly buckets across a year                                                                                                                                                                                                                                                                                                  |
| Inventory (exit criterion)  | Net use in the range: a return in the range of a part used before it cancels out, and a use one millisecond after the range is excluded; receipts; stock value equal to the parts at their average cost; low and out-of-stock counts, archived parts excluded; low-stock list order                                                                                                                                                                                                                                      |
| Edge cases                  | An empty range gives zeros and no turnaround                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| Access                      | Operations reports for administrators only; inventory reports for administrators and inventory managers; technicians and customers `403`                                                                                                                                                                                                                                                                                                                                                                                 |
| Validation                  | Defaults to the last 30 days; `to` alone gives the 30 days ending then; reversed, invalid and over-long ranges (including `from` alone two years back) `400`                                                                                                                                                                                                                                                                                                                                                             |
| Shared unit                 | Inclusive day counts across month and leap-year boundaries, default range, bucket thresholds, range validation, report permissions                                                                                                                                                                                                                                                                                                                                                                                       |
| Web                         | Clean axis steps; every date preset (including January's "last month"); duration wording; chart periods named for screen readers; keyboard focus shows the same tooltip as hover; legend only for two series; chart to table toggle                                                                                                                                                                                                                                                                                      |

### Phase 7 additions

| Area                                | Tests                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| ----------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Authorisation matrix                | `authz-matrix.test.ts` calls **every one of the 72 API operations signed out and as each of the four roles** (360 calls). Who may call each operation is written out by hand, one line per operation, not derived from `roles.ts`, so a wrong grant fails the test. Refusals are `401` or `403` and contain nothing but the error. The matrix must list exactly the documented operations, and the number of mounted routes must equal the documented ones plus the three undocumented ones (the OpenAPI file and two health checks), so a route cannot be added without a matrix line. A deliberately wrong line was tried and the test failed, as it should.                                                                                            |
| Error handling                      | An undecodable `%`-escape in the URL, a corrupt compressed body, an unsupported content encoding and a non-UTF-8 charset return `400` or `415` with the standard error body, not `500`; the library's own message is not passed on. Bodies that are not a JSON object return `400`; over-large bodies `413`. Web: an error page from the proxy (502, 503, 504) says DeviceFlow is not responding; a bug in a page shows a plain message, never the technical one.                                                                                                                                                                                                                                                                                         |
| Definition of done (end to end)     | `definition-of-done.spec.ts` walks the brief's ten steps in the browser, as the people who would do them. The administrator signs in, registers a device for a customer, books it in and assigns a technician. The technician diagnoses, quotes (a labour line and a part line, R2 000.00 excl. VAT) and issues the quotation. **The customer approves it in the portal.** The technician starts the repair, uses an SSD from stock, records time, sends it to quality check and completes it. The test then checks the status history (all 8 entries, in order, each with who made it), the activity log, and that the reports grew by **exactly** one completed job, R2 000.00 billed and one part used, and that the reports page shows those figures. |
| Portal request                      | A customer requests a repair for their own device in the portal; staff find it under Repairs, submitted and unassigned.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| Accessibility                       | `accessibility.spec.ts` scans **every screen** (25 screens and two dialogs, each as the role that uses it, with the seeded data loaded) with axe-core against WCAG 2.2 A and AA. No violation is allowed.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| Keyboard                            | Signing in with the keyboard only; the skip link moves focus past the navigation; focus stays inside an open dialog, Escape closes it and focus returns to the button that opened it; field errors set `aria-invalid` and are read as the field's description.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| What each role can reach            | A technician has no administration links and sees "no access" at `/admin/users`; a customer is kept to the portal at every staff address; a signed-out visitor is sent to sign in.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| Security headers (nginx stack only) | Each security header is sent exactly once on the app page, a client-side route and an API response; `X-Frame-Options: DENY`; a CSP with `frame-ancestors 'none'` and self-only scripts; no server version; API responses `no-store`; hashed assets cached for a year.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |

Step 10 of the definition of done, "run automated tests", is `npm test` and
`npm run test:e2e`.

Phase 2 results: shared 12, API 33, web 6.
Phase 3 results: shared 21, API 88, web 13.
Phase 4 results: shared 32, API 373, web 18.
Phase 5 results: shared 38, API 420, web 23.
Phase 6 results: shared 43, API 429, web 30.
Phase 7 results: shared 43, API 504, web 33; end to end 15 against Playwright's own
servers (the 5 nginx-only tests skipped) and 20 of 20 against the Docker images
behind nginx. All passing.

The nginx run found a bug the development server cannot show: Vite put the built
files under `/assets/`, which is also the address of the device pages
(`/assets/<id>`), so nginx answered a reload of a device page with its own 404.
Built files now live under `/static/`, and a header test loads `/assets/<id>`
directly to keep it fixed.

Two Phase 3 tests changed with the rules: the asset lifecycle test now sends the device
to repair through a repair job, and the activity-log test uses a retirement instead of
a manual `IN_REPAIR`. Both still check the same history and audit entries.

In Phase 5 one repair test changed with the new rule that inventory managers can read
jobs that used parts: it used to expect `403` for them on the repair list, and now
expects an empty list (no job has used parts). The customer half of the test is
unchanged.

## Rules

- A failing test is never disabled to make a build pass.
- Tests never use production data or production credentials.
- New business rules need an integration test that hits the endpoint as each
  relevant role.

## Timing-sensitive tests

The quote editor test types about 40 characters one key at a time. On a busy machine
it once took just over Vitest's default 5 seconds (it passes in about 1 second
normally), so in Phase 6 it was given a 15-second timeout. Its checks are unchanged.
