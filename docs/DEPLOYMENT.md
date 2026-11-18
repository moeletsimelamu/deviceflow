# Deployment

> **Status:** container images, the local Compose stack and CI are in place
> (Phase 2). Choosing a production host, production Compose/secrets handling,
> image publishing and backups are Phase 8 work and are **not done yet**.

## Images

| Image            | Dockerfile              | Contents                                                                                                                                                                |
| ---------------- | ----------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `deviceflow-api` | `docker/api.Dockerfile` | Multi-stage build: compiled API on `node:22-alpine` with production dependencies only, running as the non-root `node` user. Also used for migrations and the demo seed. |
| `deviceflow-web` | `docker/web.Dockerfile` | Vite build served by `nginx:1.28-alpine`, which reverse-proxies `/api` to the API and sets security headers.                                                            |

## Release order

1. **Migrate:** `npx prisma migrate deploy`, run in the API image (Compose service
   `migrate`). The API does not start until this step succeeds.
2. **API:** `node dist/src/server.js`. Health checks: `/health/live` and `/health/ready`.
3. **Web:** nginx on port 80.

## Configuration

| Variable                                                                                      | Required           | Notes                                                                                    |
| --------------------------------------------------------------------------------------------- | ------------------ | ---------------------------------------------------------------------------------------- |
| `DATABASE_URL`                                                                                | yes                | `postgresql://…`                                                                         |
| `NODE_ENV`                                                                                    | yes                | `production`                                                                             |
| `COOKIE_SECURE`                                                                               | yes in production  | Must be `true`. The API refuses to start otherwise. Requires HTTPS.                      |
| `ALLOWED_ORIGINS`                                                                             | yes                | Public origin(s) of the web app, comma-separated                                         |
| `TRUST_PROXY`                                                                                 | yes behind proxies | Number of proxies in front of the API (nginx alone = 1; add one for a TLS load balancer) |
| `SESSION_ABSOLUTE_HOURS`, `SESSION_IDLE_MINUTES`, `LOGIN_RATE_LIMIT_MAX`, `LOG_LEVEL`, `PORT` | no                 | Defaults in `apps/api/src/config/env.ts`                                                 |

Never set `SEED_DEFAULT_PASSWORD` or `DEMO_SEED_CONFIRM` in production.

## Local demo stack

```bash
cp .env.example .env
docker compose up -d --build
docker compose --profile demo run --rm seed
# → http://localhost:8080
```

The demo stack runs the API with `NODE_ENV=production` and `COOKIE_SECURE=true` on
`http://localhost`. Browsers treat `localhost` as a secure context, so this works
locally. It would **not** work on a plain-HTTP public host, by design.

## Continuous integration

`.github/workflows/ci.yml` runs on pull requests and on pushes to `main`:

1. **verify:** `npm ci` (npm 11.21.1) → Prettier check → ESLint → typecheck → all
   tests against a Postgres 17 service container → production build.
2. **Container images and end-to-end tests:** builds both images, starts the stack
   behind nginx (`docker/compose.e2e.yml`), seeds it with a random password made for
   the run, and runs the Playwright suite against it. On failure it uploads the
   Playwright report and prints the stack's logs.

The workflow has run on GitHub since Phase 7 (first green run on pull request #1).

## To do in Phase 8

- Choose the hosting target (open decision 5 in PHASE-1-DISCOVERY.md).
- Production Compose or manifests, TLS termination and secret injection (no `.env`
  files on servers).
- Publish images to a registry from `main`, tagged by commit SHA.
- Database backups and restore runbook.
- Shared rate-limit store if more than one API instance runs.
