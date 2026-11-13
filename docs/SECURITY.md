# Security

## Authentication

- **Passwords** are hashed with argon2id (64 MiB memory, 3 iterations). New passwords
  must be 12–128 characters. The login form does not apply the new-password policy,
  so older passwords keep working.
- **Login responses do not reveal accounts.** Unknown email, wrong password and
  deactivated account all return the same error. When the email is unknown, the
  server still verifies against a dummy argon2 hash, so all three cases take about
  the same time.
- **Sessions** are server-side rows. The browser holds a random 256-bit token in a
  cookie that is `HttpOnly`, `SameSite=Lax` and `Path=/`. When `COOKIE_SECURE=true`,
  the cookie is also `Secure` and named `__Host-df_session`; the browser enforces that
  this prefix is only ever sent over HTTPS to the same host. The database stores only
  the token's SHA-256 hash.
- **Expiry:** an absolute limit (`SESSION_ABSOLUTE_HOURS`, default 12) and an idle
  limit (`SESSION_IDLE_MINUTES`, default 120). Expired sessions are deleted when they
  are next used, and on each login.
- **Revocation** happens on logout, deactivation and role change. Deactivating a user
  or changing their role deletes all of that user's sessions in the same transaction.
  Archiving a customer account deletes the sessions of all its portal users, and both
  sign-in and every session check refuse users whose account is archived.
- **Rate limiting:** failed logins are limited per client IP (`LOGIN_RATE_LIMIT_MAX`
  per 15 minutes, default 10). Successful logins are not counted.

## Authorisation

- Roles map to permission strings in `packages/shared/src/roles.ts`.
- Every protected route declares `requirePermission(...)`. Services also enforce
  record-level rules, for example that an admin cannot demote themselves.
- The UI hides what a role cannot do, but that is only convenience. Integration tests
  call endpoints directly as each role and assert `403`.
- **Customer isolation.** Customers use only `/portal/*` endpoints (`portal:use`);
  every staff endpoint returns `403` to them. Portal services read the account id
  from the session, never from the request, and look records up with
  `WHERE id = :id AND customer_account_id = :own`. Any other record returns `404`,
  not `403`, so the API does not reveal that it exists. Integration tests try other
  customers' devices, unowned stock devices, random ids and query-string tricks.
- **Portal data minimisation.** Portal responses use their own narrow shapes: staff
  notes, status-change reasons and staff identities are never sent. Device history
  starts from when the device was assigned to the customer, so a previous owner's
  history is not shown.
- **Customer records are administrator-only** in Phase 3. Technicians and inventory
  managers see an asset's owning account name and number only.
- **Database backstop.** A CHECK constraint makes a customer login without an
  account (or a staff login with one) impossible.
- **Technician scope (Phase 4).** Technicians see and act on only the repair jobs
  assigned to them; any other job id is `404` on every repair endpoint, and the list
  ignores filters that would widen it. They see the customer contact for those jobs.
  Reassigning a job removes the previous technician's access immediately.
- **Per-move roles.** On top of permissions, the state machine names who may make each
  move (for example only the assigned technician starts a repair; only an
  administrator closes a job). Tests try every move as every role.
- **Quotation integrity.** Customers can approve only issued quotations on their own
  account's jobs; drafts are `404` to them. Approval is conditional on the status and
  version they saw. Administrators recording a decision on a customer's behalf must
  give the channel and a note, and the portal shows the customer that it was recorded
  for them. Database triggers make issued quotations and decisions unchangeable.
- **Repairs in the portal** follow the same rules as devices: account from the
  session, `404` outside it, no internal notes, reasons, labour or staff names.
- **Inventory (Phase 5).** Administrators and inventory managers manage parts and
  stock (`inventory:manage`). Technicians can read parts, stock levels and the ledger
  (`inventory:read`) so they can use parts on their jobs, but cannot change stock
  except by using or returning parts on a job assigned to them. Customers have no
  inventory access.
- **Inventory managers and repairs.** They see only jobs that have used parts, by
  customer account name, without contact details (Phase 1, §2.2), and cannot read the
  job's notes, labour or quotations (`repairs:read_details`). They cannot change jobs.
- **Reports (Phase 6).** Revenue, turnaround and workload (`reports:operations`) are
  administrator-only: technicians cannot see revenue (Phase 1) and inventory managers
  have no access to prices charged. Inventory managers have `reports:inventory`
  (parts, stock value, low stock). The API enforces both; the page only loads the
  sections the role may see.
- **Known gap.** The stock ledger (`inventory:read`) shows the job reference for repair
  movements, so a technician can see the reference, not the details, of another
  technician's job that used a part. Opening that job still returns `404`.

## CSRF

Cookie authentication needs CSRF protection. DeviceFlow uses three layers:

1. The `SameSite=Lax` cookie is not sent on cross-site POST, PUT, PATCH or DELETE.
2. Every state-changing request must carry `X-Requested-With`. A cross-site HTML form
   cannot set custom headers, and a cross-origin `fetch` that sets one needs a CORS
   preflight. The API never enables CORS, so that preflight is never approved.
3. If the browser sends an `Origin` header, it must be in `ALLOWED_ORIGINS`.

## Transport and headers

- API: `helmet` defaults, and `X-Powered-By` is disabled. Responses use
  `Cache-Control: no-store`.
- Web (nginx): CSP `default-src 'self'` (scripts self-only; inline styles allowed for
  UI positioning), `frame-ancestors 'none'`, `X-Frame-Options: DENY`, `nosniff`,
  a strict referrer policy and a permissions policy.
- In production, `COOKIE_SECURE=true` is required: the API refuses to start without
  it. TLS is terminated in front of nginx, so set `TRUST_PROXY` to the number of
  proxies in front of the API.

## Secrets and configuration

- `.env` is git-ignored. `.env.example` contains development-only placeholders and is
  the documented template.
- The API validates its environment at startup and exits with a clear list of
  problems.
- No credentials appear in source code. Demo users get their password from
  `SEED_DEFAULT_PASSWORD`, and the seed refuses to run in production unless explicitly
  confirmed (only the local Docker demo profile confirms).
- Logs redact cookies, authorization headers, `Set-Cookie`, passwords and hashes.
- Audit snapshots strip `passwordHash`, `password`, `tokenHash` and `token`.

## Supply chain

- Dependency versions are pinned exactly, and `package-lock.json` is committed.
- npm 11's `allowScripts` permits install scripts only for argon2, prisma,
  @prisma/engines and esbuild. Each is pinned by version.
- At the end of Phase 2, `npm audit --omit=dev` reported **0** vulnerabilities in
  production dependencies. There are 10 moderate advisories in development-only
  tooling; these are reviewed in Phase 7.

## Bulk export

- `GET /assets/export.csv` needs the separate `assets:export` permission (admin).
- Each export is audited with the filters and the row count, and it is capped at
  10,000 rows.
- **CSV formula injection:** any cell starting with `=`, `+`, `-`, `@`, a tab or a
  carriage return is prefixed with `'`, so a customer name such as
  `=HYPERLINK(...)` cannot run as a formula when the file is opened in Excel. Every
  cell is quoted.

## Database protections

- Audit rows, asset history, repair status history, repair notes and the stock
  ledger cannot be updated or deleted, enforced by triggers. Issued quotations cannot
  be changed. Stock cannot go negative or drift from the ledger (CHECK and deferred
  triggers).
- `Idempotency-Key` replays are scoped to the user who sent the key, and a key cannot
  replay a response for a different request (the request hash must match).
- Business constraints are CHECK constraints where Prisma cannot express them
  (see DATABASE.md).
- The Compose database port is bound to `127.0.0.1` only.

## Known limitations

| Limitation                                                                      | Plan                                                                              |
| ------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| The rate-limit store is in-memory, so it is per instance and resets on restart. | Use a shared store (Redis or Postgres) before running more than one API instance. |
| No self-service password reset (needs email delivery).                          | Admin-set passwords for now. Revisit when notifications are added.                |
| No MFA.                                                                         | Candidate for after v1.                                                           |
| Development-only npm advisories are not yet triaged.                            | Phase 7 security review.                                                          |
