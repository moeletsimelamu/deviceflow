# syntax=docker/dockerfile:1
# DeviceFlow API image: compiled TypeScript on a slim Node runtime, non-root.

FROM node:22-alpine AS base
# npm 10.x has a resolver bug with this dependency tree; npm 11 also enforces the
# `allowScripts` allow-list in package.json (only approved install scripts run).
RUN npm install -g npm@11.21.1 \
 && apk add --no-cache openssl
WORKDIR /app

# ---- Install all dependencies (cached unless manifests change) --------------
FROM base AS deps
COPY package.json package-lock.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY apps/api/prisma apps/api/prisma
COPY apps/api/prisma.config.ts apps/api/
RUN npm ci -w @deviceflow/api -w @deviceflow/shared --include-workspace-root

# ---- Compile ---------------------------------------------------------------
FROM deps AS build
COPY tsconfig.base.json ./
COPY packages/shared packages/shared
COPY apps/api apps/api
RUN npm run build -w @deviceflow/shared \
 && npm run prisma:generate -w @deviceflow/api \
 && npm run build -w @deviceflow/api

# ---- Production dependencies only ------------------------------------------
FROM base AS prod-deps
COPY package.json package-lock.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY apps/api/prisma apps/api/prisma
COPY apps/api/prisma.config.ts apps/api/
RUN npm ci --omit=dev -w @deviceflow/api -w @deviceflow/shared \
 && npm cache clean --force

# ---- Runtime ---------------------------------------------------------------
FROM base AS runtime
ENV NODE_ENV=production
COPY --from=prod-deps /app ./
COPY --from=build /app/packages/shared/dist packages/shared/dist
COPY --from=build /app/apps/api/dist apps/api/dist
USER node
WORKDIR /app/apps/api
EXPOSE 3000
CMD ["node", "dist/src/server.js"]
