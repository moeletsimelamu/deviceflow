import { Router } from 'express';
import { prisma } from '../../lib/prisma.js';

export const healthRouter = Router();

/** Liveness: the process is up. Used by container orchestrators to restart a hung process. */
healthRouter.get('/live', (_req, res) => {
  res.json({ status: 'ok' });
});

/** Readiness: the API can reach the database and should receive traffic. */
healthRouter.get('/ready', async (req, res) => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    res.json({ status: 'ok', database: 'ok' });
  } catch (err) {
    req.log.warn({ err }, 'Readiness check failed');
    res.status(503).json({ status: 'unavailable', database: 'unreachable' });
  }
});
