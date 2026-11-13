import { randomUUID } from 'node:crypto';
import express from 'express';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import { pinoHttp } from 'pino-http';
import { env } from '../config/env.js';
import { logger } from '../config/logger.js';
import { authenticate } from './middleware/auth.js';
import { csrfProtection } from './middleware/csrf.js';
import { errorHandler, notFoundHandler } from './middleware/error-handler.js';
import { createAuthRouter } from '../modules/auth/auth.routes.js';
import { usersRouter } from '../modules/users/users.routes.js';
import { settingsRouter } from '../modules/settings/settings.routes.js';
import { healthRouter } from '../modules/health/health.routes.js';
import { customersRouter } from '../modules/customers/customers.routes.js';
import { assetsRouter } from '../modules/assets/assets.routes.js';
import { auditRouter } from '../modules/audit/audit.routes.js';
import { portalRouter } from '../modules/portal/portal.routes.js';
import { repairsRouter } from '../modules/repairs/repairs.routes.js';
import { inventoryRouter } from '../modules/inventory/inventory.routes.js';
import { reportsRouter } from '../modules/reports/reports.routes.js';
import { buildOpenApiDocument } from './openapi.js';

const REQUEST_ID_PATTERN = /^[A-Za-z0-9-]{8,64}$/;

/**
 * Builds the Express application without starting a server, so integration
 * tests can drive it with Supertest.
 */
export function createApp() {
  const app = express();

  app.disable('x-powered-by');
  app.set('trust proxy', env.TRUST_PROXY);

  app.use(
    pinoHttp({
      logger,
      // Reuse a well-formed incoming X-Request-Id (e.g. from nginx); otherwise generate one.
      genReqId: (req, res) => {
        const incoming = req.headers['x-request-id'];
        const id =
          typeof incoming === 'string' && REQUEST_ID_PATTERN.test(incoming)
            ? incoming
            : randomUUID();
        res.setHeader('X-Request-Id', id);
        return id;
      },
      autoLogging: { ignore: (req) => req.url?.startsWith('/health') ?? false },
      customLogLevel: (_req, res, err) =>
        err || res.statusCode >= 500 ? 'error' : res.statusCode >= 400 ? 'warn' : 'info',
    }),
  );

  app.use(helmet());
  app.use(express.json({ limit: '100kb' }));
  app.use(cookieParser());

  app.use('/health', healthRouter);

  const api = express.Router();
  api.use(csrfProtection);
  api.use(authenticate);
  api.use((_req, res, next) => {
    // API responses contain personal data: never cache them in shared caches.
    res.setHeader('Cache-Control', 'no-store');
    next();
  });
  api.use('/auth', createAuthRouter());
  api.use('/users', usersRouter);
  api.use('/settings', settingsRouter);
  api.use('/customers', customersRouter);
  api.use('/assets', assetsRouter);
  api.use('/repairs', repairsRouter);
  api.use('/inventory', inventoryRouter);
  api.use('/reports', reportsRouter);
  api.use('/audit', auditRouter);
  api.use('/portal', portalRouter);

  // The API description is public: security never depends on hiding the routes.
  const openApiDocument = buildOpenApiDocument();
  api.get('/openapi.json', (_req, res) => {
    res.json(openApiDocument);
  });

  app.use('/api/v1', api);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
