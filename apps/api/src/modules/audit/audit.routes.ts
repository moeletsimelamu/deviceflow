import { Router } from 'express';
import { listAuditQuerySchema } from '@deviceflow/shared';
import { requirePermission } from '../../http/middleware/auth.js';
import { parse } from '../../lib/validation.js';
import { listAudit } from './audit.service.js';

export const auditRouter = Router();

auditRouter.get('/', requirePermission('audit:read'), async (req, res) => {
  res.json(await listAudit(parse(listAuditQuerySchema, req.query)));
});
