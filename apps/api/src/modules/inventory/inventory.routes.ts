import { Router } from 'express';
import {
  createPartSchema,
  listMovementsQuerySchema,
  listPartsQuerySchema,
  recordAdjustmentSchema,
  recordPurchaseSchema,
  updatePartSchema,
  uuidParamSchema,
} from '@deviceflow/shared';
import { requirePermission } from '../../http/middleware/auth.js';
import { actorOf, requestContext } from '../../http/request-context.js';
import { inTransaction, sendIdempotent } from '../../lib/idempotency.js';
import { parse } from '../../lib/validation.js';
import * as inventory from './inventory.service.js';

export const inventoryRouter = Router();

const read = requirePermission('inventory:read');
const manage = requirePermission('inventory:manage');

inventoryRouter.get('/parts', read, async (req, res) => {
  res.json(await inventory.listParts(parse(listPartsQuerySchema, req.query)));
});

inventoryRouter.post('/parts', manage, async (req, res) => {
  const input = parse(createPartSchema, req.body);
  await sendIdempotent(req, res, 201, async (tx) => ({
    data: await inventory.createPart(tx, actorOf(req), input, requestContext(req)),
  }));
});

inventoryRouter.get('/parts/:id', read, async (req, res) => {
  const { id } = parse(uuidParamSchema, req.params);
  res.json({ data: await inventory.getPart(id) });
});

inventoryRouter.patch('/parts/:id', manage, async (req, res) => {
  const { id } = parse(uuidParamSchema, req.params);
  const input = parse(updatePartSchema, req.body);
  const part = await inTransaction((tx) =>
    inventory.updatePart(tx, actorOf(req), id, input, requestContext(req)),
  );
  res.json({ data: part });
});

inventoryRouter.get('/parts/:id/movements', read, async (req, res) => {
  const { id } = parse(uuidParamSchema, req.params);
  const query = parse(listMovementsQuerySchema, req.query);
  await inventory.getPart(id);
  res.json(await inventory.listMovements({ ...query, part: id }));
});

inventoryRouter.post('/parts/:id/purchases', manage, async (req, res) => {
  const { id } = parse(uuidParamSchema, req.params);
  const input = parse(recordPurchaseSchema, req.body);
  await sendIdempotent(req, res, 201, async (tx) => ({
    data: await inventory.recordPurchase(tx, actorOf(req), id, input, requestContext(req)),
  }));
});

inventoryRouter.post('/parts/:id/adjustments', manage, async (req, res) => {
  const { id } = parse(uuidParamSchema, req.params);
  const input = parse(recordAdjustmentSchema, req.body);
  await sendIdempotent(req, res, 201, async (tx) => ({
    data: await inventory.recordAdjustment(tx, actorOf(req), id, input, requestContext(req)),
  }));
});

inventoryRouter.get('/movements', read, async (req, res) => {
  res.json(await inventory.listMovements(parse(listMovementsQuerySchema, req.query)));
});
