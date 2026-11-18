# API

Base path: `/api/v1`. JSON only. Authentication is a session cookie set by
`POST /auth/login`.

> **Machine-readable reference:** an OpenAPI 3.1 document generated from the same Zod
> schemas that validate requests. It is served at `GET /api/v1/openapi.json` and
> committed as [`docs/openapi.json`](openapi.json). After changing an endpoint, run
> `npm run openapi -w @deviceflow/api`. A test fails while the committed file is stale,
> and another checks that every documented operation is a real route.

## Conventions

| Topic                   | Rule                                                                                                                                                        |
| ----------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| State-changing requests | Must send `X-Requested-With: DeviceFlow`. If an `Origin` header is present, it must be in `ALLOWED_ORIGINS`. Otherwise the response is `403 CSRF_REJECTED`. |
| Single resources        | Wrapped as `{ "data": {…} }`                                                                                                                                |
| Lists                   | `{ "data": [...], "meta": { "page", "pageSize", "total", "totalPages" } }`                                                                                  |
| Pagination              | `?page=1&pageSize=25` (pageSize at most 100)                                                                                                                |
| Sorting                 | `?sort=field:asc\|desc`. Fields are allow-listed per resource, and anything else returns 400.                                                               |
| Concurrency             | Updates include the record's `version`. A stale version returns `409 CONFLICT`.                                                                             |
| Request IDs             | Every response has `X-Request-Id`. Errors include it as `error.requestId`.                                                                                  |
| Caching                 | API responses are `Cache-Control: no-store`.                                                                                                                |

## Errors

```json
{
  "error": {
    "code": "VALIDATION_FAILED",
    "message": "Some fields are invalid",
    "details": [{ "path": "email", "message": "Enter a valid email address" }],
    "requestId": "8c6d…"
  }
}
```

| Status | Codes                                                                                                                                                                                                                                                                                                                                                                                                                  |
| ------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 400    | `VALIDATION_FAILED`, `MALFORMED_REQUEST` (body is not valid JSON, an undecodable `%`-escape in the URL, a corrupt compressed body)                                                                                                                                                                                                                                                                                     |
| 401    | `UNAUTHENTICATED`, `INVALID_CREDENTIALS`                                                                                                                                                                                                                                                                                                                                                                               |
| 403    | `FORBIDDEN`, `CSRF_REJECTED`                                                                                                                                                                                                                                                                                                                                                                                           |
| 404    | `NOT_FOUND`                                                                                                                                                                                                                                                                                                                                                                                                            |
| 409    | `CONFLICT`, `EMAIL_TAKEN`, `SERIAL_TAKEN`, `REPAIR_ALREADY_OPEN`, `QUOTE_NOT_ISSUED` (approving or rejecting a quotation that is no longer issued), `QUOTE_NOT_EDITABLE`, `SKU_TAKEN`, `INSUFFICIENT_STOCK` (not enough in stock: nothing is taken)                                                                                                                                                                    |
| 413    | `PAYLOAD_TOO_LARGE`                                                                                                                                                                                                                                                                                                                                                                                                    |
| 415    | `UNSUPPORTED_MEDIA_TYPE` (a body that is not UTF-8, or compressed in a way the API does not accept)                                                                                                                                                                                                                                                                                                                    |
| 422    | `CANNOT_MODIFY_SELF`, `ROLE_NOT_ALLOWED`, `INVALID_TRANSITION`, `CUSTOMER_ARCHIVED`, `CUSTOMER_REQUIRED`, `EXPORT_TOO_LARGE`, `ASSET_NOT_REPAIRABLE`, `ASSET_IN_REPAIR_JOB`, `TECHNICIAN_INVALID`, `WRONG_REPAIR_STATUS`, `LABOUR_REQUIRED`, `QUOTE_TOTAL_INVALID`, `IDEMPOTENCY_KEY_REUSED`, `PART_ARCHIVED`, `PART_HAS_STOCK`, `RETURN_EXCEEDS_USAGE`, and `VALIDATION_FAILED` for rules checked against stored data |
| 429    | `RATE_LIMITED`                                                                                                                                                                                                                                                                                                                                                                                                         |
| 500    | `INTERNAL_ERROR` (generic message; details only in server logs)                                                                                                                                                                                                                                                                                                                                                        |

### Idempotency-Key

`POST` endpoints for repairs, portal repairs and inventory (new parts, deliveries,
adjustments, parts used and returned) accept an `Idempotency-Key` header
(8–128 letters, digits, `-` or `_`). The web app sends one key per form submission.

- The key and the saved response are written **in the same transaction** as the
  change, so a request is applied at most once.
- Repeating the request with the same key returns the saved status and body with
  `Idempotency-Replayed: true`. A duplicate that arrives while the first is still
  running waits for it and then gets the replay.
- The same key with a different method, path or body returns
  `422 IDEMPOTENCY_KEY_REUSED`.
- A request that fails stores nothing, so the form can be corrected and resent with
  the same key. Keys expire after 24 hours.
- Without the header, requests run normally. Duplicates that matter are still stopped
  by the rules themselves (one open job per device, conditional quote approval).

## Endpoints

### Health (outside `/api/v1`)

| Method | Path            | Auth | Description                     |
| ------ | --------------- | ---- | ------------------------------- |
| GET    | `/health/live`  | none | Process is up                   |
| GET    | `/health/ready` | none | Database reachable (503 if not) |

### Auth

| Method | Path           | Auth    | Description                                                                                                                                                                                                               |
| ------ | -------------- | ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| POST   | `/auth/login`  | none    | Body `{ email, password }`. Sets the session cookie and returns `{ user }`. Unknown email, wrong password and deactivated account all return the same `401 INVALID_CREDENTIALS`. Failed attempts are rate-limited per IP. |
| POST   | `/auth/logout` | session | Revokes the session server-side. Returns `204`.                                                                                                                                                                           |
| GET    | `/auth/me`     | session | Returns `{ user: { id, email, fullName, role, customerAccountId } }`                                                                                                                                                      |

### Users (staff administration)

| Method | Path         | Permission     | Description                                                                                                                                                                                      |
| ------ | ------------ | -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| GET    | `/users`     | `users:read`   | Filters: `search` (name or email), `role`, `isActive`. Sort: `createdAt`, `email`, `fullName`, `role`.                                                                                           |
| GET    | `/users/:id` | `users:read`   |                                                                                                                                                                                                  |
| POST   | `/users`     | `users:manage` | `{ email, fullName, role, password }`. Staff roles only. `409 EMAIL_TAKEN` if the email exists.                                                                                                  |
| PATCH  | `/users/:id` | `users:manage` | `{ fullName?, role?, isActive?, version }`. Role changes and deactivation revoke the user's sessions. An admin cannot change their own role or deactivate themselves (`422 CANNOT_MODIFY_SELF`). |

### Company settings

| Method | Path        | Permission                  | Description                                                            |
| ------ | ----------- | --------------------------- | ---------------------------------------------------------------------- |
| GET    | `/settings` | `settings:read` (all staff) | `{ companyName, currency, vatRateBasisPoints, updatedAt, version }`    |
| PATCH  | `/settings` | `settings:manage` (admin)   | Any of `companyName`, `currency`, `vatRateBasisPoints`, plus `version` |

### Customers (staff)

Administrator-only in Phase 3. Optional text fields accept `""` or `null` to clear them.

| Method | Path                                 | Permission         | Description                                                                                                                                                    |
| ------ | ------------------------------------ | ------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| GET    | `/customers`                         | `customers:read`   | Filters: `search` (name, account number, email, contact name), `type`, `isActive`. Sort: `name`, `accountNumber`, `createdAt`. Each row includes `assetCount`. |
| GET    | `/customers/lookup?search=`          | `customers:read`   | Up to 20 **active** accounts as summaries, for pickers.                                                                                                        |
| GET    | `/customers/:id`                     | `customers:read`   |                                                                                                                                                                |
| POST   | `/customers`                         | `customers:manage` | `{ type, name, email?, phone?, vatNumber?, addressLine1?, addressLine2?, city?, region?, postalCode?, notes? }`. The account number is generated.              |
| PATCH  | `/customers/:id`                     | `customers:manage` | Any profile field, plus `version`. `isActive: false` archives: the account's portal users are signed out and cannot sign in until it is restored.              |
| GET    | `/customers/:id/contacts`            | `customers:read`   | Primary contact first.                                                                                                                                         |
| POST   | `/customers/:id/contacts`            | `customers:manage` | `{ fullName, email?, phone?, jobTitle?, isPrimary? }`. Making a contact primary demotes the previous one.                                                      |
| PATCH  | `/customers/:id/contacts/:contactId` | `customers:manage` | Any field plus `version`. A contact id from another account returns 404.                                                                                       |
| DELETE | `/customers/:id/contacts/:contactId` | `customers:manage` | `204`. The audit entry keeps the removed details.                                                                                                              |
| GET    | `/customers/:id/users`               | `users:read`       | The account's portal users.                                                                                                                                    |
| POST   | `/customers/:id/users`               | `users:manage`     | `{ email, fullName, password }` creates a `CUSTOMER` user tied to this account. `422 CUSTOMER_ARCHIVED` for archived accounts.                                 |

### Assets

| Method | Path                 | Permission                | Description                                                                                                                                                                                                                                                                          |
| ------ | -------------------- | ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| GET    | `/assets`            | `assets:read` (all staff) | Filters: `search` (tag, serial, manufacturer, model, customer name), `status`, `category`, `customer` (an account id, or `none` for company stock), `warranty` (`active`, `expired`, `none`). Sort: `assetTag`, `createdAt`, `manufacturer`, `model`, `status`, `warrantyExpiresOn`. |
| GET    | `/assets/export.csv` | `assets:export` (admin)   | Same filters and sort, no paging. At most 10,000 rows, otherwise `422 EXPORT_TOO_LARGE`. Audited as `asset.exported` with the filters and row count. Cells that a spreadsheet would run as formulas are neutralised.                                                                 |
| GET    | `/assets/:id`        | `assets:read`             |                                                                                                                                                                                                                                                                                      |
| GET    | `/assets/:id/events` | `assets:read`             | Lifecycle history, newest first, with the staff member and any note.                                                                                                                                                                                                                 |
| POST   | `/assets`            | `assets:manage` (admin)   | `{ category, manufacturer, model, serialNumber?, condition?, status? (IN_STOCK or ACTIVE), customerAccountId?, purchaseDate?, warrantyExpiresOn?, warrantyNotes?, notes? }`. `409 SERIAL_TAKEN` names the asset that already has the serial.                                         |
| PATCH  | `/assets/:id`        | `assets:manage`           | Details and/or `customerAccountId` (reassign, or `null` for stock), plus `version`. Status is not editable here.                                                                                                                                                                     |
| POST   | `/assets/:id/status` | `assets:manage`           | `{ status, reason?, version }`. Only allowed transitions (below). `reason` is required for `RETIRED` and `DISPOSED`.                                                                                                                                                                 |

**Asset lifecycle.** The table lives in `packages/shared/src/schemas/assets.ts`, so the
API and the UI use the same rules.

| From           | Allowed to                          |
| -------------- | ----------------------------------- |
| `IN_STOCK`     | `ACTIVE`, `REFURBISHING`, `RETIRED` |
| `ACTIVE`       | `IN_REPAIR`, `IN_STOCK`, `RETIRED`  |
| `IN_REPAIR`    | `ACTIVE`, `REFURBISHING`, `RETIRED` |
| `REFURBISHING` | `IN_STOCK`, `ACTIVE`, `RETIRED`     |
| `RETIRED`      | `DISPOSED`                          |
| `DISPOSED`     | (final)                             |

An asset can only be `ACTIVE` while it belongs to a customer (`422 CUSTOMER_REQUIRED`).
Assets cannot be assigned to archived customers (`422 CUSTOMER_ARCHIVED`).
`IN_REPAIR` is set only by repair jobs: opening a job moves the device in, and
closing, returning or cancelling it moves the device back. A manual move to
`IN_REPAIR` is refused, and status and owner are locked while a job is open.

### Repairs

Administrators see every job. **Technicians see only jobs assigned to them**; any other
job id returns `404`. **Inventory managers see only jobs that have used parts**, without
the customer's contact details (`contact` is `null`), and cannot read the job's notes,
labour or quotations (`repairs:read_details`, `403`).

| Method | Path                                   | Permission             | Description                                                                                                                                                                                                                                                                 |
| ------ | -------------------------------------- | ---------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| GET    | `/repairs`                             | `repairs:read`         | Filters: `search` (reference, fault, asset tag, serial, make, model, customer), `status`, `state` (`open`/`closed`), `technician` (id or `unassigned`, admin), `customer`, `asset`. Sort: `createdAt`, `updatedAt`, `reference`, `status`.                                  |
| GET    | `/repairs/technicians`                 | `repairs:manage`       | Active technicians with their open job count.                                                                                                                                                                                                                               |
| POST   | `/repairs`                             | `repairs:manage`       | `{ assetId, faultDescription, technicianId? }`. The device must be `ACTIVE` and belong to an active customer, with no open job (`409 REPAIR_ALREADY_OPEN` names it). The device moves to `IN_REPAIR`.                                                                       |
| GET    | `/repairs/:id`                         | `repairs:read`         | Includes the customer contact, labour total and the current quotation summary.                                                                                                                                                                                              |
| GET    | `/repairs/:id/history`                 | `repairs:read`         | Status history, newest first, with staff notes.                                                                                                                                                                                                                             |
| POST   | `/repairs/:id/assign`                  | `repairs:manage`       | `{ technicianId, version }`. From `SUBMITTED` this moves the job to `ASSIGNED`; later it reassigns without changing the status.                                                                                                                                             |
| POST   | `/repairs/:id/transitions`             | `repairs:work`         | `{ to, note?, completionSummary?, version }`. Only moves in the state machine below, by the roles it names.                                                                                                                                                                 |
| GET    | `/repairs/:id/notes`                   | `repairs:read_details` |                                                                                                                                                                                                                                                                             |
| POST   | `/repairs/:id/notes`                   | `repairs:work`         | `{ type, body }`. Types: `FAULT`, `DIAGNOSTIC`, `REPAIR`, `INTERNAL`, `CUSTOMER_VISIBLE` (shown in the portal). Notes cannot be edited.                                                                                                                                     |
| GET    | `/repairs/:id/labour`                  | `repairs:read_details` |                                                                                                                                                                                                                                                                             |
| POST   | `/repairs/:id/labour`                  | `repairs:work`         | `{ minutes, description, workDate }` while the job is being diagnosed or worked on (`422 WRONG_REPAIR_STATUS` otherwise).                                                                                                                                                   |
| DELETE | `/repairs/:id/labour/:entryId`         | `repairs:work`         | `204`. Technicians can remove only their own entries.                                                                                                                                                                                                                       |
| GET    | `/repairs/:id/quotes`                  | `repairs:read_details` | All revisions, newest first, including the draft.                                                                                                                                                                                                                           |
| POST   | `/repairs/:id/quotes`                  | `repairs:work`         | `{ lines: [{ kind, description, quantity, unitPriceCents }], customerNote? }` starts the next revision as a draft. One draft at a time.                                                                                                                                     |
| PATCH  | `/repairs/:id/quotes/:quoteId`         | `repairs:work`         | Edit a draft (`lines` replaces all lines) with `version`. Issued quotations return `409 QUOTE_NOT_EDITABLE`.                                                                                                                                                                |
| DELETE | `/repairs/:id/quotes/:quoteId`         | `repairs:work`         | Discard a draft.                                                                                                                                                                                                                                                            |
| POST   | `/repairs/:id/quotes/:quoteId/issue`   | `repairs:work`         | `{ version }`. Freezes the VAT rate and totals, supersedes the previously issued revision, and moves a `DIAGNOSING` job to `AWAITING_APPROVAL`.                                                                                                                             |
| POST   | `/repairs/:id/quotes/:quoteId/approve` | `repairs:manage`       | `{ version, channel: PHONE \| IN_PERSON \| EMAIL, note }`: the customer's approval recorded on their behalf (D2). Stores the exact approved total.                                                                                                                          |
| POST   | `/repairs/:id/quotes/:quoteId/reject`  | `repairs:manage`       | Same body, for a rejection. The job moves to `QUOTE_REJECTED`.                                                                                                                                                                                                              |
| GET    | `/repairs/:id/parts`                   | `repairs:read`         | `{ lines: [{ part, quantity, costCents }], totalCostCents, movements }`: parts still in use (used minus returned) and every use and return.                                                                                                                                 |
| POST   | `/repairs/:id/parts`                   | `repairs:work`         | `{ partId, quantity, note? }` takes whole units out of stock for the job, by the assigned technician or an admin, while the job is `IN_REPAIR`, `AWAITING_PARTS` or `QUALITY_CHECK` (`422 WRONG_REPAIR_STATUS` otherwise). `409 INSUFFICIENT_STOCK` says how many are left. |
| POST   | `/repairs/:id/parts/returns`           | `repairs:work`         | Same body. Puts unused units back; at most the job's net use of that part (`422 RETURN_EXCEEDS_USAGE`).                                                                                                                                                                     |     |

**Repair state machine.** Defined once in `packages/shared/src/schemas/repairs.ts`
(`REPAIR_TRANSITIONS`) and used by both the API and the UI.

| From                                                                         | To                    | How                           | Who                                       | Needs                    |
| ---------------------------------------------------------------------------- | --------------------- | ----------------------------- | ----------------------------------------- | ------------------------ |
| `SUBMITTED`                                                                  | `ASSIGNED`            | assign                        | Admin                                     |                          |
| `ASSIGNED`                                                                   | `DIAGNOSING`          | transition                    | Assigned technician, Admin                |                          |
| `DIAGNOSING`                                                                 | `AWAITING_APPROVAL`   | issuing a quotation           | Assigned technician, Admin                | ≥ 1 line, total > 0      |
| `AWAITING_APPROVAL`                                                          | `APPROVED`            | approving the quotation       | Customer (portal), Admin on their behalf  | channel and note (admin) |
| `AWAITING_APPROVAL`                                                          | `QUOTE_REJECTED`      | rejecting the quotation       | Customer (portal), Admin on their behalf  | channel and note (admin) |
| `QUOTE_REJECTED`                                                             | `DIAGNOSING`          | transition                    | Assigned technician, Admin                |                          |
| `QUOTE_REJECTED`                                                             | `RETURNED_UNREPAIRED` | transition                    | Admin                                     |                          |
| `APPROVED`                                                                   | `IN_REPAIR`           | transition                    | Assigned technician                       |                          |
| `IN_REPAIR`                                                                  | `AWAITING_PARTS`      | transition                    | Assigned technician                       | note                     |
| `AWAITING_PARTS`                                                             | `IN_REPAIR`           | transition                    | Assigned technician                       | note                     |
| `IN_REPAIR`                                                                  | `QUALITY_CHECK`       | transition                    | Assigned technician                       | ≥ 1 labour entry         |
| `QUALITY_CHECK`                                                              | `COMPLETED`           | transition                    | Assigned technician, Admin                | completion summary       |
| `QUALITY_CHECK`                                                              | `IN_REPAIR`           | transition                    | Assigned technician, Admin                | note                     |
| `COMPLETED`                                                                  | `CLOSED`              | transition                    | Admin                                     |                          |
| `SUBMITTED`, `ASSIGNED`, `DIAGNOSING`, `AWAITING_APPROVAL`, `QUOTE_REJECTED` | `CANCELLED`           | transition (or portal cancel) | Admin; the customer only from `SUBMITTED` | note                     |

Any other move returns `422 INVALID_TRANSITION`, including moves that only a domain
action can make (for example `APPROVED` through `/transitions`). A move by the wrong
role returns `403`; a stale `version` returns `409`. `CLOSED`, `RETURNED_UNREPAIRED`
and `CANCELLED` are final, and the device returns to `ACTIVE`. Cancelling withdraws an
issued quotation.

**Quotations.** `DRAFT → ISSUED → APPROVED | REJECTED | SUPERSEDED | WITHDRAWN`. Lines
are priced excluding VAT; VAT is added once on the subtotal and rounded half-up.
Approval is a conditional update on `status = 'ISSUED' AND version = :seen` while the
job is locked, so a double click, two people approving at once, or a stale tab
showing a superseded revision cannot approve twice or approve the wrong quotation.

### Inventory

Parts are counted in whole units. Stock changes only through movements in the stock
ledger, which cannot be edited: a mistake is corrected with another movement. Low
stock means `quantityOnHand <= reorderLevel` (Phase 1), computed in the query.

| Method | Path                               | Permission                                              | Description                                                                                                                                                                                                                                                                    |
| ------ | ---------------------------------- | ------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| GET    | `/inventory/parts`                 | `inventory:read` (admin, inventory manager, technician) | Filters: `search` (SKU, name, location), `category`, `stock` (`low` includes out of stock, `out`), `isActive` (default `true`). Sort: `name`, `sku`, `quantityOnHand`, `updatedAt`. Each part has `stockState` (`OK`, `LOW`, `OUT`), `averageCostCents` and `stockValueCents`. |
| POST   | `/inventory/parts`                 | `inventory:manage` (admin, inventory manager)           | `{ sku, name, category, description?, location?, reorderLevel }`. The SKU is trimmed and upper-cased; `409 SKU_TAKEN`. New parts have no stock.                                                                                                                                |
| GET    | `/inventory/parts/:id`             | `inventory:read`                                        |                                                                                                                                                                                                                                                                                |
| PATCH  | `/inventory/parts/:id`             | `inventory:manage`                                      | Any field plus `version`. `isActive: false` archives, only with no stock (`422 PART_HAS_STOCK`); `true` restores. Archived parts accept no movements (`422 PART_ARCHIVED`).                                                                                                    |
| GET    | `/inventory/parts/:id/movements`   | `inventory:read`                                        | The part's ledger, newest first, with the balance after each movement. Filters as below.                                                                                                                                                                                       |
| POST   | `/inventory/parts/:id/purchases`   | `inventory:manage`                                      | `{ quantity, unitCostCents, supplier?, reference?, note? }`. Adds stock and moves the weighted average cost.                                                                                                                                                                   |
| POST   | `/inventory/parts/:id/adjustments` | `inventory:manage`                                      | `{ direction: IN \| OUT, quantity, note }`. The reason is required. `OUT` beyond the stock returns `409 INSUFFICIENT_STOCK`.                                                                                                                                                   |
| GET    | `/inventory/movements`             | `inventory:read`                                        | The whole ledger. Filters: `type`, `part`, `repairJob`, `from` and `to` (dates, inclusive).                                                                                                                                                                                    |

Movement types: `PURCHASE`, `ADJUSTMENT_IN`, `ADJUSTMENT_OUT`, `REPAIR_CONSUMPTION`,
`REPAIR_RETURN`. Each records the signed `quantityChange`, `balanceAfter`, the unit
cost at the time, the actor and, for repair movements, the job.

**Why stock cannot go negative.** Every decrease is one statement,
`UPDATE parts SET quantity_on_hand = quantity_on_hand - n WHERE id = $1 AND
quantity_on_hand >= n`, so when requests race for the last units, the ones that would
overdraw match no row and get `409`. A CHECK constraint and a commit-time ledger check
back this up (DATABASE.md).

### Reports

Read-only figures for a date range. `from` and `to` are calendar dates in **UTC**,
inclusive at both ends (`from=2026-10-01&to=2026-10-31` covers
`2026-10-01T00:00Z` up to, not including, `2026-11-01T00:00Z`). Defaults: the last 30
days ending today; only `to` gives the 30 days ending then; only `from` runs to today.
At most 731 days (`400`). Each report reads one consistent snapshot (`REPEATABLE READ`).

| Method | Path                  | Permission                                     | Description                                                                                      |
| ------ | --------------------- | ---------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| GET    | `/reports/operations` | `reports:operations` (admin)                   | Devices, jobs, turnaround, billed revenue, open jobs by status, technician workload and a trend. |
| GET    | `/reports/inventory`  | `reports:inventory` (admin, inventory manager) | Parts used and received in the range; stock value and low stock now.                             |

Definitions (each is checked against fixtures in `test/integration/reports.test.ts`):

| Figure                              | Definition                                                                                                                                                                                                                                                                                                              |
| ----------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `devices.total`, `devices.byStatus` | Every registered device **now**, by lifecycle status.                                                                                                                                                                                                                                                                   |
| `devices.registered`                | Devices created in the range.                                                                                                                                                                                                                                                                                           |
| `jobs.openNow`                      | Jobs not `CLOSED`, `RETURNED_UNREPAIRED` or `CANCELLED`, **now**.                                                                                                                                                                                                                                                       |
| `jobs.opened`                       | Jobs booked in (created) in the range.                                                                                                                                                                                                                                                                                  |
| `jobs.completed`                    | Jobs whose `completedAt` falls in the range, including those closed since.                                                                                                                                                                                                                                              |
| `jobs.abandoned`                    | Jobs cancelled or returned unrepaired (`closedAt`) in the range.                                                                                                                                                                                                                                                        |
| `turnaround`                        | For jobs completed in the range: booking in to completion, in hours (one decimal), average and median. `null` when there are none.                                                                                                                                                                                      |
| `revenue`                           | **Billed revenue**: the approved quotation of each job completed in the range, excluding VAT (`subtotalCents`), plus VAT and total. Not cash received; v1 has no invoicing (Phase 1, assumption 3). Issued, superseded or rejected quotations never count.                                                              |
| `statusDistribution`                | Open jobs **now**, per open status in workflow order, zeros included.                                                                                                                                                                                                                                                   |
| `technicians`                       | Per technician: open jobs now, excluding `COMPLETED` (waiting for collection); jobs completed in the range (credited to the technician assigned now); labour minutes with a work date in the range. Deactivated technicians appear only when one of these is above zero.                                                |
| `trend`                             | Per day (up to 31 days), week from Monday (up to 183 days) or month: jobs booked in, jobs completed and billed revenue excl. VAT. Every bucket is listed, zeros included; the first week or month can start before `from`, but only events inside the range are counted.                                                |
| `consumption`                       | Repair uses minus repair returns whose movement time falls in the range, at the unit cost recorded on each movement. A return in the range of a part used before it reduces the figure. `parts` counts parts with net use above zero; `jobs` counts jobs with a use in the range; `top` lists at most 10 parts by cost. |
| `receipts`                          | Purchases received in the range: units and cost.                                                                                                                                                                                                                                                                        |
| `stock`                             | Active parts **now**: units, value at average cost, parts at or below their reorder level (including those out of stock), parts out of stock.                                                                                                                                                                           |
| `lowStockParts`                     | Up to 10 active parts at or below their reorder level, least in stock first.                                                                                                                                                                                                                                            |

### Activity

| Method | Path     | Permission           | Description                                                                                                                                                                                       |
| ------ | -------- | -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| GET    | `/audit` | `audit:read` (admin) | Newest first. Filters: `action` (exact, or a prefix ending in `.` such as `asset.`), `entityType`, `entityId`, `actorUserId`, `assetId`, `customerAccountId`, `from` and `to` (dates, inclusive). |

### Customer portal

Every portal query is scoped to the signed-in user's own account, taken from the
session and never from the request. Any other record returns `404`, even one that
exists, so the portal never reveals whether a record exists. Staff notes,
status-change reasons and staff identities are never included. Staff users get `403`.

| Method | Path                                          | Permission   | Description                                                                                                         |
| ------ | --------------------------------------------- | ------------ | ------------------------------------------------------------------------------------------------------------------- |
| GET    | `/portal/account`                             | `portal:use` | `{ accountNumber, name, type }`                                                                                     |
| GET    | `/portal/assets`                              | `portal:use` | The account's devices. Filters: `search`, `status`.                                                                 |
| GET    | `/portal/assets/:id`                          | `portal:use` |                                                                                                                     |
| GET    | `/portal/assets/:id/history`                  | `portal:use` | Status history since the device was assigned to this account. Earlier owners are not shown.                         |
| GET    | `/portal/repairs`                             | `portal:use` | The account's repairs. Filters: `state`, `asset`.                                                                   |
| POST   | `/portal/repairs`                             | `portal:use` | `{ assetId, faultDescription }` for one of the account's active devices.                                            |
| GET    | `/portal/repairs/:id`                         | `portal:use` |                                                                                                                     |
| GET    | `/portal/repairs/:id/timeline`                | `portal:use` | Status changes and `CUSTOMER_VISIBLE` notes, newest first. No staff notes or names.                                 |
| GET    | `/portal/repairs/:id/quotes`                  | `portal:use` | Issued quotations and outcomes. Drafts are never shown. On-behalf decisions show the channel, not the staff member. |
| POST   | `/portal/repairs/:id/quotes/:quoteId/approve` | `portal:use` | `{ version }`.                                                                                                      |
| POST   | `/portal/repairs/:id/quotes/:quoteId/reject`  | `portal:use` | `{ version, reason? }`.                                                                                             |
| POST   | `/portal/repairs/:id/cancel`                  | `portal:use` | `{ reason, version }`, only before a technician is assigned (`403` afterwards).                                     |

### Documentation

| Method | Path            | Auth | Description                  |
| ------ | --------------- | ---- | ---------------------------- |
| GET    | `/openapi.json` | none | The OpenAPI 3.1 description. |

## Audit actions recorded so far

`auth.login`, `auth.logout`, `user.created`, `user.updated`, `user.deactivated`,
`user.reactivated`, `settings.updated`, `customer.created`, `customer.updated`,
`customer.archived`, `customer.restored`, `contact.created`, `contact.updated`,
`contact.deleted`, `customer_user.created`, `asset.created`, `asset.updated`,
`asset.reassigned`, `asset.status_changed`, `asset.exported`, `repair.created`,
`repair.assigned`, `repair.status_changed`, `repair.cancelled`, `repair_note.created`,
`labour.created`, `labour.deleted`, `quote.created`, `quote.updated`, `quote.deleted`,
`quote.issued`, `quote.approved`, `quote.rejected`, `part.created`, `part.updated`,
`part.archived`, `part.restored`, `stock.purchased`, `stock.adjusted`,
`repair_part.used`, `repair_part.returned`. Stock entries use `entityType: Part` and the
part's id, so a part's activity is `GET /audit?entityType=Part&entityId=`.

Each entry records the actor, entity, request ID and IP, plus sanitised before and
after snapshots where relevant. Secrets are stripped before saving. Asset, customer and
repair entries also carry `assetId`, `customerAccountId` and `repairJobId`, so a
record's full activity can be listed (`GET /audit?repairJobId=`).
