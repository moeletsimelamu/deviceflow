# syntax=docker/dockerfile:1
# DeviceFlow web image: static Vite build served by nginx, which also proxies /api.

FROM node:22-alpine AS build
RUN npm install -g npm@11.21.1
WORKDIR /app
COPY package.json package-lock.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
# The web build needs no install scripts (no native modules).
RUN npm ci --ignore-scripts -w @deviceflow/web -w @deviceflow/shared --include-workspace-root
COPY tsconfig.base.json ./
COPY packages/shared packages/shared
COPY apps/web apps/web
RUN npm run build -w @deviceflow/web

FROM nginx:1.28-alpine AS runtime
COPY docker/nginx/default.conf /etc/nginx/conf.d/default.conf
COPY docker/nginx/security-headers.conf /etc/nginx/snippets/security-headers.conf
COPY --from=build /app/apps/web/dist /usr/share/nginx/html
EXPOSE 80
