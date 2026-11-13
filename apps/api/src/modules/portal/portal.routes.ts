import { Router } from 'express';
import {
  portalCancelRepairSchema,
  portalCreateRepairSchema,
  portalListAssetsQuerySchema,
  portalListRepairsQuerySchema,
  portalRejectQuoteSchema,
  quoteVersionSchema,
  repairQuoteParamsSchema,
  uuidParamSchema,
} from '@deviceflow/shared';
import { requirePermission } from '../../http/middleware/auth.js';
import { actorOf, requestContext } from '../../http/request-context.js';
import { sendIdempotent } from '../../lib/idempotency.js';
import { parse } from '../../lib/validation.js';
import * as portal from './portal.service.js';
import * as repairs from './portal-repairs.service.js';

export const portalRouter = Router();

portalRouter.use(requirePermission('portal:use'));

portalRouter.get('/account', async (req, res) => {
  res.json({ data: await portal.getAccount(actorOf(req)) });
});

portalRouter.get('/assets', async (req, res) => {
  res.json(await portal.listAssets(actorOf(req), parse(portalListAssetsQuerySchema, req.query)));
});

portalRouter.get('/assets/:id', async (req, res) => {
  const { id } = parse(uuidParamSchema, req.params);
  res.json({ data: await portal.getAsset(actorOf(req), id) });
});

portalRouter.get('/assets/:id/history', async (req, res) => {
  const { id } = parse(uuidParamSchema, req.params);
  res.json({ data: await portal.listAssetHistory(actorOf(req), id) });
});

// Repairs
portalRouter.get('/repairs', async (req, res) => {
  res.json(await repairs.listRepairs(actorOf(req), parse(portalListRepairsQuerySchema, req.query)));
});

portalRouter.post('/repairs', async (req, res) => {
  const input = parse(portalCreateRepairSchema, req.body);
  await sendIdempotent(req, res, 201, async (tx) => ({
    data: await repairs.submitRepair(tx, actorOf(req), input, requestContext(req)),
  }));
});

portalRouter.get('/repairs/:id', async (req, res) => {
  const { id } = parse(uuidParamSchema, req.params);
  res.json({ data: await repairs.getRepair(actorOf(req), id) });
});

portalRouter.get('/repairs/:id/timeline', async (req, res) => {
  const { id } = parse(uuidParamSchema, req.params);
  res.json({ data: await repairs.getTimeline(actorOf(req), id) });
});

portalRouter.get('/repairs/:id/quotes', async (req, res) => {
  const { id } = parse(uuidParamSchema, req.params);
  res.json({ data: await repairs.listQuotes(actorOf(req), id) });
});

portalRouter.post('/repairs/:id/cancel', async (req, res) => {
  const { id } = parse(uuidParamSchema, req.params);
  const input = parse(portalCancelRepairSchema, req.body);
  await sendIdempotent(req, res, 200, async (tx) => ({
    data: await repairs.cancelRepair(tx, actorOf(req), id, input, requestContext(req)),
  }));
});

portalRouter.post('/repairs/:id/quotes/:quoteId/approve', async (req, res) => {
  const { id, quoteId } = parse(repairQuoteParamsSchema, req.params);
  const { version } = parse(quoteVersionSchema, req.body);
  await sendIdempotent(req, res, 200, async (tx) => ({
    data: await repairs.approveQuote(tx, actorOf(req), id, quoteId, version, requestContext(req)),
  }));
});

portalRouter.post('/repairs/:id/quotes/:quoteId/reject', async (req, res) => {
  const { id, quoteId } = parse(repairQuoteParamsSchema, req.params);
  const input = parse(portalRejectQuoteSchema, req.body);
  await sendIdempotent(req, res, 200, async (tx) => ({
    data: await repairs.rejectQuote(tx, actorOf(req), id, quoteId, input, requestContext(req)),
  }));
});
