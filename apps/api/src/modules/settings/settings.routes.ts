import { Router } from 'express';
import { updateCompanySettingsSchema } from '@deviceflow/shared';
import { requirePermission } from '../../http/middleware/auth.js';
import { actorOf, requestContext } from '../../http/request-context.js';
import { parse } from '../../lib/validation.js';
import * as settingsService from './settings.service.js';

export const settingsRouter = Router();

settingsRouter.get('/', requirePermission('settings:read'), async (_req, res) => {
  res.json({ data: await settingsService.getSettings() });
});

settingsRouter.patch('/', requirePermission('settings:manage'), async (req, res) => {
  const input = parse(updateCompanySettingsSchema, req.body);
  res.json({
    data: await settingsService.updateSettings(actorOf(req), input, requestContext(req)),
  });
});
