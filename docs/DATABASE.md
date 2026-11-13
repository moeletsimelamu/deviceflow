# Database

PostgreSQL 17 with Prisma 7. The schema is `apps/api/prisma/schema.prisma`; the
migrations are in `apps/api/prisma/migrations/`.

## Conventions

- Tables and columns use `snake_case` (mapped with `@@map` and `@map`). TypeScript uses `camelCase`.
- Primary keys are UUIDs, except single-row tables.
- Timestamps are `timestamptz(3)` and stored in UTC.
- Money columns (from Phase 4) are integer cents. Rates are integer basis points (1500 = 15.00%).
- Foreign keys are `RESTRICT` by default. Business records are deactivated or archived, never hard-deleted.
- Editable records have a `version` integer for optimistic concurrency.

## Current schema (Phase 5)

| Table                   | Purpose                                       | Key constraints                                                                                                                                                                                                                                                                                                 |
| ----------------------- | --------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `users`                 | Staff and customer (portal) logins            | `email` unique; CHECK email lower-case and trimmed; CHECK a user has `customer_account_id` **if and only if** the role is `CUSTOMER`; indexes `(role, is_active)`, `customer_account_id`                                                                                                                        |
| `sessions`              | Server-side sessions                          | `token_hash` unique (SHA-256, never the raw token); cascade-deleted with the user; indexes on `user_id`, `expires_at`                                                                                                                                                                                           |
| `audit_logs`            | Append-only record of business actions        | Trigger blocks `UPDATE` and `DELETE`; correlation columns `asset_id`, `customer_account_id` (deliberately not foreign keys); indexes `(entity_type, entity_id)`, `actor_user_id`, `created_at`, `(asset_id, created_at)`, `(customer_account_id, created_at)`                                                   |
| `company_settings`      | Company name, currency, VAT rate              | CHECK `id = 1` (single row); CHECK VAT 0–10000 bp; CHECK currency matches `^[A-Z]{3}$`; row inserted by the migration (ZAR, 15%)                                                                                                                                                                                |
| `customer_accounts`     | Individuals and organisations                 | `account_number` unique, generated `CU-000001` from a sequence; indexes `name`, `(type, is_active)`; archived with `is_active`, never deleted                                                                                                                                                                   |
| `customer_contacts`     | People at a customer account                  | FK to account (`RESTRICT`); partial unique index: at most one `is_primary` contact per account                                                                                                                                                                                                                  |
| `assets`                | Registered devices                            | `asset_tag` unique, generated `DF-YYYY-000001` from a sequence; **unique `(manufacturer_key, serial_number)`**; CHECKs listed below; indexes `customer_account_id`, `status`, `category`, `created_at`                                                                                                          |
| `asset_events`          | Lifecycle history (registered, status, owner) | Append-only (trigger blocks `UPDATE` and `DELETE`); index `(asset_id, created_at)`, `to_customer_account_id`; `repair_job_id` set when a repair job moved the device                                                                                                                                            |
| `repair_jobs`           | Repair jobs                                   | `reference` unique, generated `RJ-000001`; **partial unique index: one open job per device**; CHECKs below; indexes `status`, `(assigned_technician_id, status)`, `(customer_account_id, created_at)`, `asset_id`, `created_at`                                                                                 |
| `repair_status_history` | Every status change of a job                  | Append-only (trigger); index `(repair_job_id, created_at)`                                                                                                                                                                                                                                                      |
| `repair_notes`          | Diagnosis, work, internal and customer notes  | Append-only (trigger); only `CUSTOMER_VISIBLE` notes reach the portal                                                                                                                                                                                                                                           |
| `labour_entries`        | Time actually spent                           | CHECK 1–1440 minutes; deletable (audited) while the job is being worked on                                                                                                                                                                                                                                      |
| `quotations`            | Quotation revisions                           | unique `(repair_job_id, revision)`; partial unique: one `ISSUED` and one `DRAFT` per job; CHECKs on money and decisions; **trigger freezes everything but a draft**                                                                                                                                             |
| `quotation_lines`       | Priced lines (excl. VAT)                      | unique `(quotation_id, position)`; CHECK quantity > 0, prices ≥ 0; trigger allows changes only while the quotation is a `DRAFT`                                                                                                                                                                                 |
| `idempotency_keys`      | Saved responses for `Idempotency-Key`         | unique `(user_id, key)`; written in the same transaction as the change; expire after 24 hours                                                                                                                                                                                                                   |
| `parts`                 | Stocked spare parts and consumables           | `sku` unique (trimmed, upper case); **CHECK `quantity_on_hand >= 0`**; CHECK an archived part holds no stock; **deferred trigger: stock = sum of the part's movements**; indexes `name`, `(category, is_active)`                                                                                                |
| `stock_movements`       | The stock ledger                              | Append-only (trigger); CHECK sign matches the type; CHECK repair movements, and only those, name a job; CHECK adjustments have a reason; trigger: balance matches the part, a job returns at most what it used; indexes `(part_id, created_at)`, `(repair_job_id, part_id)`, `(type, created_at)`, `created_at` |

### Identifiers

Account numbers, asset tags and repair references come from Postgres sequences through
the functions `next_customer_account_number()`, `next_asset_tag()` and
`next_repair_reference()`, used as column defaults.
Sequences are safe under concurrent inserts and never hand out a number twice. A
transaction that rolls back (for example a rejected duplicate serial) still uses up its
number, so **gaps in the numbering are expected** and mean nothing. The number widens
past six digits instead of being cut off.

### Duplicate serial numbers

The rule is "one device per manufacturer and serial number". It is enforced by the
unique index `assets_manufacturer_serial_key` on `(manufacturer_key, serial_number)`:

- `serial_number` is stored normalised: upper case with all whitespace removed
  (`" 7xk2 9p3 "` becomes `7XK29P3`). CHECK `assets_serial_normalised_chk` makes the
  database refuse anything else, so no code path can bypass the normalisation.
- `manufacturer_key` is the manufacturer trimmed and upper-cased by the API (`Dell`,
  `DELL` and `dell` are the same). CHECK `assets_manufacturer_key_chk` requires it to
  be upper case and non-empty.
- Devices without a serial store `NULL`, and Postgres treats NULLs as distinct, so any
  number of them can be registered.
- Because the index is the guard, two simultaneous registrations of the same device
  cannot both succeed. A test fires five at once and checks exactly one is stored.

### Constraints Prisma cannot express

Hand-written at the end of each migration:

| Object                                                                                                            | Kind                  | Migration          |
| ----------------------------------------------------------------------------------------------------------------- | --------------------- | ------------------ |
| `users_email_normalised_chk`                                                                                      | CHECK                 | `init`             |
| `company_settings_single_row_chk`, `company_settings_vat_range_chk`, `company_settings_currency_chk`              | CHECK                 | `init`             |
| `audit_logs_block_mutation()` and the `audit_logs_no_update_delete` trigger                                       | Function and trigger  | `init`             |
| `customer_account_number_seq`, `asset_tag_seq` and their `next_…()` functions                                     | Sequence, function    | `customers_assets` |
| `users_customer_account_chk`                                                                                      | CHECK                 | `customers_assets` |
| `customer_contacts_one_primary_idx`                                                                               | Partial unique index  | `customers_assets` |
| `assets_manufacturer_key_chk`, `assets_serial_normalised_chk`                                                     | CHECK                 | `customers_assets` |
| `assets_active_has_customer_chk` (an `ACTIVE` asset always has a customer)                                        | CHECK                 | `customers_assets` |
| `assets_warranty_after_purchase_chk`                                                                              | CHECK                 | `customers_assets` |
| `asset_events_block_mutation()` and the `asset_events_no_update_delete` trigger                                   | Function and trigger  | `customers_assets` |
| `repair_reference_seq` and `next_repair_reference()`                                                              | Sequence, function    | `repairs`          |
| `repair_jobs_one_open_per_asset_idx` (one job not CLOSED, RETURNED_UNREPAIRED or CANCELLED per device)            | Partial unique index  | `repairs`          |
| `repair_jobs_technician_chk` (past SUBMITTED a job has a technician)                                              | CHECK                 | `repairs`          |
| `repair_jobs_completion_chk` (COMPLETED and CLOSED need a summary and completion time)                            | CHECK                 | `repairs`          |
| `repair_jobs_closed_at_chk` (finished jobs, and only those, have `closed_at`)                                     | CHECK                 | `repairs`          |
| `labour_entries_minutes_chk`                                                                                      | CHECK                 | `repairs`          |
| `quotations_money_chk` (non-negative, total = subtotal + VAT, VAT 0–100%, revision ≥ 1)                           | CHECK                 | `repairs`          |
| `quotations_issued_chk`, `quotations_decided_chk`                                                                 | CHECK                 | `repairs`          |
| `quotations_approved_chk` (approved ⇔ `approved_total_cents` set, and it equals the total)                        | CHECK                 | `repairs`          |
| `quotations_one_issued_per_job_idx`, `quotations_one_draft_per_job_idx`                                           | Partial unique index  | `repairs`          |
| `quotation_lines_values_chk`                                                                                      | CHECK                 | `repairs`          |
| `quotations_guard()` trigger: issued quotations are immutable; decided ones are final; only drafts can be deleted | Function and trigger  | `repairs`          |
| `quotation_lines_guard()` trigger: lines change only while the quotation is a draft                               | Function and trigger  | `repairs`          |
| `repair_records_block_mutation()` on `repair_status_history` and `repair_notes`                                   | Function and triggers | `repairs`          |
| `parts_quantity_chk` (stock never below zero), `parts_reorder_level_chk`, `parts_average_cost_chk`                | CHECK                 | `inventory`        |
| `parts_sku_normalised_chk`, `parts_archived_empty_chk` (archived ⇒ no stock)                                      | CHECK                 | `inventory`        |
| `stock_movements_sign_chk`, `stock_movements_balance_chk`, `stock_movements_cost_chk`                             | CHECK                 | `inventory`        |
| `stock_movements_repair_chk` (job set ⇔ repair movement), `stock_movements_note_chk` (adjustments need a reason)  | CHECK                 | `inventory`        |
| `stock_movements_guard()`: append-only; new balance must equal the part's stock; returns ≤ the job's net use      | Function and trigger  | `inventory`        |
| `stock_balance_matches_ledger()`: deferred constraint triggers on `parts` and `stock_movements`                   | Function and triggers | `inventory`        |

`TRUNCATE` does not fire row triggers, so the test suite can still reset the tables.

### Relationships

```
customer_accounts 1──* customer_contacts
customer_accounts 1──* users (role CUSTOMER only)
customer_accounts 1──* assets (NULL = company stock)
assets            1──* asset_events
users             1──* assets (created_by), asset_events (actor), audit_logs (actor)
assets            1──* repair_jobs (at most one open)
customer_accounts 1──* repair_jobs (the owner when the job was opened)
repair_jobs       1──* repair_status_history, repair_notes, labour_entries, quotations
quotations        1──* quotation_lines
users             1──* repair_jobs (technician, submitted_by), quotations (created/issued/decided by)
parts             1──* stock_movements
repair_jobs       1──* stock_movements (parts used and returned)
users             1──* stock_movements (actor)
```

### Money

Amounts are integer cents. Quantities are stored as hundredths (`quantity_hundredths`,
1.5 hours = 150), so no floating-point arithmetic is involved. Line totals are rounded
half-up to the cent; VAT is calculated once on the subtotal and rounded half-up
(`packages/shared/src/money.ts`, unit tested). The VAT rate and currency are copied
from company settings onto the quotation and frozen when it is issued, so a later
change of the company rate does not alter quotations already sent. A single quotation
is limited to R10 000 000 so totals fit a 32-bit column.

### Repair jobs and devices

Opening a job moves the device from `ACTIVE` to `IN_REPAIR`; closing, returning
unrepaired or cancelling moves it back to `ACTIVE`. Both moves write an `asset_events`
row with `repair_job_id`. While a job is open, the asset service refuses manual status
and owner changes, so the job's customer scope always matches the device's owner.

### Stock and the ledger

`parts.quantity_on_hand` is a stored balance, and `stock_movements` is the ledger that
explains it. Three layers keep them honest:

1. **The API** changes stock with one conditional statement, for example
   `UPDATE parts SET quantity_on_hand = quantity_on_hand - n WHERE id = $1 AND is_active
AND quantity_on_hand >= n RETURNING quantity_on_hand`. Postgres locks the row and
   re-checks the condition against the latest committed value, so of two requests
   racing for the last unit one wins and the other matches no row (409
   `INSUFFICIENT_STOCK`). The returned figure becomes the movement's `balance_after`.
2. **CHECK `parts_quantity_chk`** refuses negative stock from any code path.
3. **Deferred constraint triggers** compare the stock figure with the sum of the
   part's movements at commit. A stock change without a movement, or a movement
   without a stock change, cannot commit. A new movement must also carry the part's
   current balance, and a repair return cannot exceed what the job has used.

Mistakes are corrected with a new, opposite movement; nothing in the ledger is edited
or deleted. Quantities are whole units.

**Cost.** Each movement records a unit cost: the price paid for a purchase, otherwise
the part's average cost at the time. Purchases move the weighted average cost
(`(on hand × average + bought × price) ÷ (on hand + bought)`, rounded half-up to the
cent, computed in the same `UPDATE`). Adjustments and repair use do not change the
average. A return goes back at the average cost the job was charged for that part.

**Repair use** is a `REPAIR_CONSUMPTION` movement with the job's id; a return is
`REPAIR_RETURN`. There is no separate usage table (Phase 1 listed `RepairPartUsage`):
the ledger already holds one row per use and return, and a second table would be a
second copy of the same facts that could disagree.

All foreign keys are `ON DELETE RESTRICT`, except quotation lines (cascade with their
draft) and idempotency keys (cascade with their user). The API deletes only contacts,
labour entries and draft quotations; the audit entry keeps a copy of what was removed.

## Migration workflow

| Situation                                 | Command                                                                                                           |
| ----------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| Change the schema in development          | Edit `schema.prisma`, then `npm run db:migrate -- --name <change>`                                                |
| Add SQL Prisma cannot generate            | `npx prisma migrate dev --create-only --name <change>` (from `apps/api`), edit the SQL, then `npm run db:migrate` |
| Apply migrations (CI, Docker, production) | `npm run db:deploy` (`prisma migrate deploy`)                                                                     |
| Start the development database over       | `npm run db:reset`                                                                                                |

Migrations run as a **separate release step**: the Compose `migrate` service, or
`db:deploy` in a pipeline. The API never migrates on startup, so several API
instances can never race to apply the same migration.

## Databases in development

`docker/postgres-init/01-create-test-database.sql` creates `deviceflow_test` next to
`deviceflow` when the volume is first created. Integration tests run only against
`TEST_DATABASE_URL`, and the Vitest config refuses to run if it equals
`DATABASE_URL`, because the tests truncate every table.

If the Docker volume existed before that script was added, create the test database
by hand:

```bash
docker compose exec db psql -U deviceflow -c "CREATE DATABASE deviceflow_test"
```
