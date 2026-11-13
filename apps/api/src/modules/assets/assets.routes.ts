import { Router } from 'express';
import {
  changeAssetStatusSchema,
  createAssetSchema,
  exportAssetsQuerySchema,
  listAssetsQuerySchema,
  updateAssetSchema,
  uuidParamSchema,
} from '@deviceflow/shared';
import { requirePermission } from '../../http/middleware/auth.js';
import { actorOf, requestContext } from '../../http/request-context.js';
import { parse } from '../../lib/validation.js';
import * as assets from './assets.service.js';

export const assetsRouter = Router();

const read = requirePermission('assets:read');
const manage = requirePermission('assets:manage');

assetsRouter.get('/', read, async (req, res) => {
  res.json(await assets.listAssets(parse(listAssetsQuerySchema, req.query)));
});

// Registered before "/:id" so "export.csv" is not parsed as an id.
assetsRouter.get('/export.csv', requirePermission('assets:export'), async (req, res) => {
  const query = parse(exportAssetsQuerySchema, req.query);
  const date = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  let started = false;
  // Headers are sent with the first chunk, so an error before then (for example
  // EXPORT_TOO_LARGE) still reaches the client as a normal JSON error response.
  await assets.exportAssets(actorOf(req), query, requestContext(req), (chunk) => {
    if (!started) {
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="deviceflow-assets-${date}.csv"`);
      started = true;
    }
    res.write(chunk);
  });
  res.end();
});

assetsRouter.get('/:id', read, async (req, res) => {
  const { id } = parse(uuidParamSchema, req.params);
  res.json({ data: await assets.getAsset(id) });
});

assetsRouter.get('/:id/events', read, async (req, res) => {
  const { id } = parse(uuidParamSchema, req.params);
  res.json({ data: await assets.listAssetEvents(id) });
});

assetsRouter.post('/', manage, async (req, res) => {
  const input = parse(createAssetSchema, req.body);
  const asset = await assets.createAsset(actorOf(req), input, requestContext(req));
  res.status(201).json({ data: asset });
});

assetsRouter.patch('/:id', manage, async (req, res) => {
  const { id } = parse(uuidParamSchema, req.params);
  const input = parse(updateAssetSchema, req.body);
  res.json({ data: await assets.updateAsset(actorOf(req), id, input, requestContext(req)) });
});

assetsRouter.post('/:id/status', manage, async (req, res) => {
  const { id } = parse(uuidParamSchema, req.params);
  const input = parse(changeAssetStatusSchema, req.body);
  res.json({ data: await assets.changeAssetStatus(actorOf(req), id, input, requestContext(req)) });
});
