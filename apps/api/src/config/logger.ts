import { pino } from 'pino';
import { env } from './env.js';

/**
 * Structured JSON logger. Secrets are redacted at the logger level so a careless
 * `logger.info({ req })` can never write a session cookie or password to the logs.
 */
export const logger = pino({
  level: env.NODE_ENV === 'test' ? 'silent' : env.LOG_LEVEL,
  base: { service: 'deviceflow-api' },
  timestamp: pino.stdTimeFunctions.isoTime,
  redact: {
    paths: [
      'req.headers.cookie',
      'req.headers.authorization',
      'res.headers["set-cookie"]',
      '*.password',
      '*.passwordHash',
      '*.tokenHash',
    ],
    censor: '[redacted]',
  },
});
