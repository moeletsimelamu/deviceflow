import { Router } from 'express';
import { reportQuerySchema } from '@deviceflow/shared';
import { requirePermission } from '../../http/middleware/auth.js';
import { parse } from '../../lib/validation.js';
import * as reports from './reports.service.js';

export const reportsRouter = Router();

reportsRouter.get('/operations', requirePermission('reports:operations'), async (req, res) => {
  res.json({ data: await reports.operationsReport(parse(reportQuerySchema, req.query)) });
});

reportsRouter.get('/inventory', requirePermission('reports:inventory'), async (req, res) => {
  res.json({ data: await reports.inventoryReport(parse(reportQuerySchema, req.query)) });
});
