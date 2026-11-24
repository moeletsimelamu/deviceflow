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
- **Authorisation matrix (Phase 7).** `apps/api/test/integration/authz-matrix.test.ts`
  holds a hand-written table of who may call each of the 72 API operations and calls
  every operation signed out and as every role. The table must match the documented
  operations exactly, and the number of routes the server mounts must match too, so
  a new endpoint cannot ship without a decision about who may call it.
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
- **One value per header (Phase 7).** nginx drops the API's own copies of
  `X-Frame-Options`, `X-Content-Type-Options`, `Referrer-Policy` and
  `Content-Security-Policy` on proxied responses. Before this, API responses carried
  `X-Frame-Options` twice with different values (`SAMEORIGIN` and `DENY`), and
  browsers ignore that header when its values conflict. The end-to-end header test
  checks each header appears exactly once.
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
  production dependencies.
- **Phase 7 audit (2026-11-17).** Production dependencies: **0** vulnerabilities.
  Development tooling: 15 advisories (7 high, 8 moderate), all from two advisories:
  - **picomatch ReDoS** (GHSA-fc5q-39xc-vjpf; through vite, vitest, tinyglobby and
    fdir). Every picomatch release is affected; there is no fixed version yet, and
    npm's suggested "fix" is a major downgrade of Vitest and Vite. Not reachable
    here: picomatch only matches glob patterns from our own config files (test
    includes, the Vite build), never input from users, and none of it runs in the
    production images.
  - **minimatch denial of service** (GHSA-g3hv-75wg-m249; through ESLint and
    typescript-eslint). Fixed in ESLint 10.15.0 and typescript-eslint 8.73.0, which
    were 4 days and 1 day old at the time. Not reachable either: ESLint only reads
    the repository's own glob patterns.
  - **Decision:** not upgraded yet. New releases get at least a week before we adopt
    them (a supply-chain precaution), and neither advisory can be reached by an
    attacker. To do: upgrade ESLint and typescript-eslint after 2026-11-24, and take
    a fixed picomatch when one is released.
- **Audit update (2026-11-24).**
  - **minimatch: fixed.** ESLint upgraded to 10.15.0 and typescript-eslint to 8.73.0
    once both were at least a week old. typescript-eslint 8.74.0 was out by then but
    only a day old, so it was not taken.
  - **picomatch: no longer reported** by `npm audit`, with the same picomatch 4.0.7
    installed, so the change is on the advisory's side. Nothing to do.
  - **New: effect ReDoS** (GHSA-7589-6fvf-x4pw, high; versions up to 3.22.0). It
    reaches us through the Prisma CLI (`prisma` → `@prisma/config`, which pins
    `effect` 3.20.0 exactly), and because the CLI runs the migration step in the
    production image, `npm audit --omit=dev` now reports it too (3 entries, one
    advisory). Not reachable: the affected code compiles schemas into regular
    expressions, and Prisma uses it only to read our own `prisma.config.ts` while a
    migration or code generation runs, never in the API server and never on input
    from users. npm's suggested fix is a downgrade to Prisma 6, which is not an
    option. Fixed `effect` releases exist (3.22.1 and later; 3.22.4 is from October
    2026), so the remedy is a newer Prisma or an npm override pinning `effect` to a
    fixed 3.22 release, tested against migrations and code generation. Tracked
    below.
- Playwright and axe-core (Phase 7) are development-only, pinned exactly, and not
  in the production images. Playwright downloads its Chromium build from its own
  CDN with `npx playwright install chromium`.

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

## Rate limits (Phase 7 review)

- **Sign-in** is the only endpoint that guesses can be made against, and it is
  limited per client address (failed attempts only). Behind nginx, `TRUST_PROXY=1`
  makes the API use the address nginx saw, not one a client wrote into
  `X-Forwarded-For`.
- Every other endpoint needs a session, so abuse is tied to an account and is in
  the audit log. Expensive operations are bounded instead of rate-limited: page
  sizes are capped at 100, CSV exports at 10 000 rows, report ranges at 731 days,
  request bodies at 100 kB (1 MB at nginx), and a device can have only one open
  repair job, which limits portal repair requests.
- There is no general per-address request limit. That belongs in front of the app
  (nginx `limit_req` or the hosting platform) and is planned with the production
  configuration in Phase 8.

## Error handling (Phase 7 review)

- Every error leaves the API in one shape (`{ error: { code, message, details?,
requestId } }`). Unexpected errors return a generic message; the stack goes only
  to the server log, with the request ID that the user sees as "Reference".
- Malformed requests are client errors. Before Phase 7, an undecodable `%`-escape in
  a URL, a corrupt compressed body or an unsupported encoding or charset returned
  `500`; they now return `400` or `415`, and the library's own message, which can
  quote internals, is not passed on.
- In the web app, a crash in one page shows an error inside the app shell, so the
  navigation still works; the technical message goes to the browser console, not
  the screen. An error page from the proxy (for example while the API restarts)
  says DeviceFlow is not responding instead of showing a bare status code.

## Known limitations

| Limitation                                                                       | Plan                                                                              |
| -------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| The rate-limit store is in-memory, so it is per instance and resets on restart.  | Use a shared store (Redis or Postgres) before running more than one API instance. |
| No self-service password reset (needs email delivery).                           | Admin-set passwords for now. Revisit when notifications are added.                |
| No MFA.                                                                          | Candidate for after v1.                                                           |
| `effect` ReDoS through the Prisma CLI (not reachable; see the 2026-11-24 audit). | Take a Prisma release with a fixed `effect`, or override `effect` to 3.22.x.      |
| No general per-address request rate limit.                                       | Add at the edge (nginx or the host) with the production configuration, Phase 8.   |
