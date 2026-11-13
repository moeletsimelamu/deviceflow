import { Router } from 'express';
import {
  addLabourSchema,
  addRepairNoteSchema,
  assignRepairSchema,
  createQuoteSchema,
  createRepairSchema,
  listRepairsQuerySchema,
  quoteVersionSchema,
  repairLabourParamsSchema,
  repairQuoteParamsSchema,
  repairTransitionSchema,
  returnRepairPartSchema,
  staffQuoteDecisionSchema,
  updateQuoteSchema,
  useRepairPartSchema,
  uuidParamSchema,
} from '@deviceflow/shared';
import { requirePermission } from '../../http/middleware/auth.js';
import { actorOf, requestContext } from '../../http/request-context.js';
import { inTransaction, sendIdempotent } from '../../lib/idempotency.js';
import { parse } from '../../lib/validation.js';
import * as inventory from '../inventory/inventory.service.js';
import * as repairs from './repairs.service.js';

export const repairsRouter = Router();

const read = requirePermission('repairs:read');
// Notes, labour and quotations: not for inventory managers, who see jobs only for their parts.
const readDetails = requirePermission('repairs:read_details');
const work = requirePermission('repairs:work');
const manage = requirePermission('repairs:manage');

repairsRouter.get('/', read, async (req, res) => {
  res.json(await repairs.listRepairs(actorOf(req), parse(listRepairsQuerySchema, req.query)));
});

// Registered before "/:id" so "technicians" is not parsed as an id.
repairsRouter.get('/technicians', manage, async (_req, res) => {
  res.json({ data: await repairs.listTechnicians() });
});

repairsRouter.post('/', manage, async (req, res) => {
  const input = parse(createRepairSchema, req.body);
  await sendIdempotent(req, res, 201, async (tx) => {
    const job = await repairs.createRepair(tx, actorOf(req), input, requestContext(req), {
      source: 'STAFF',
    });
    return { data: repairs.toRepairDto(job) };
  });
});

repairsRouter.get('/:id', read, async (req, res) => {
  const { id } = parse(uuidParamSchema, req.params);
  res.json({ data: await repairs.getRepair(actorOf(req), id) });
});

repairsRouter.get('/:id/history', read, async (req, res) => {
  const { id } = parse(uuidParamSchema, req.params);
  res.json({ data: await repairs.listHistory(actorOf(req), id) });
});

repairsRouter.post('/:id/assign', manage, async (req, res) => {
  const { id } = parse(uuidParamSchema, req.params);
  const input = parse(assignRepairSchema, req.body);
  await sendIdempotent(req, res, 200, async (tx) => ({
    data: await repairs.assignRepair(tx, actorOf(req), id, input, requestContext(req)),
  }));
});

repairsRouter.post('/:id/transitions', work, async (req, res) => {
  const { id } = parse(uuidParamSchema, req.params);
  const input = parse(repairTransitionSchema, req.body);
  await sendIdempotent(req, res, 200, async (tx) => ({
    data: await repairs.transitionRepair(tx, actorOf(req), id, input, requestContext(req)),
  }));
});

// Notes
repairsRouter.get('/:id/notes', readDetails, async (req, res) => {
  const { id } = parse(uuidParamSchema, req.params);
  res.json({ data: await repairs.listNotes(actorOf(req), id) });
});

repairsRouter.post('/:id/notes', work, async (req, res) => {
  const { id } = parse(uuidParamSchema, req.params);
  const input = parse(addRepairNoteSchema, req.body);
  await sendIdempotent(req, res, 201, async (tx) => ({
    data: await repairs.addNote(tx, actorOf(req), id, input, requestContext(req)),
  }));
});

// Labour
repairsRouter.get('/:id/labour', readDetails, async (req, res) => {
  const { id } = parse(uuidParamSchema, req.params);
  res.json({ data: await repairs.listLabour(actorOf(req), id) });
});

repairsRouter.post('/:id/labour', work, async (req, res) => {
  const { id } = parse(uuidParamSchema, req.params);
  const input = parse(addLabourSchema, req.body);
  await sendIdempotent(req, res, 201, async (tx) => ({
    data: await repairs.addLabour(tx, actorOf(req), id, input, requestContext(req)),
  }));
});

repairsRouter.delete('/:id/labour/:entryId', work, async (req, res) => {
  const { id, entryId } = parse(repairLabourParamsSchema, req.params);
  await inTransaction((tx) =>
    repairs.deleteLabour(tx, actorOf(req), id, entryId, requestContext(req)),
  );
  res.status(204).end();
});

// Quotations
repairsRouter.get('/:id/quotes', readDetails, async (req, res) => {
  const { id } = parse(uuidParamSchema, req.params);
  res.json({ data: await repairs.listQuotes(actorOf(req), id) });
});

repairsRouter.post('/:id/quotes', work, async (req, res) => {
  const { id } = parse(uuidParamSchema, req.params);
  const input = parse(createQuoteSchema, req.body);
  await sendIdempotent(req, res, 201, async (tx) => ({
    data: await repairs.createQuote(tx, actorOf(req), id, input, requestContext(req)),
  }));
});

repairsRouter.patch('/:id/quotes/:quoteId', work, async (req, res) => {
  const { id, quoteId } = parse(repairQuoteParamsSchema, req.params);
  const input = parse(updateQuoteSchema, req.body);
  const quote = await inTransaction((tx) =>
    repairs.updateQuote(tx, actorOf(req), id, quoteId, input, requestContext(req)),
  );
  res.json({ data: quote });
});

repairsRouter.delete('/:id/quotes/:quoteId', work, async (req, res) => {
  const { id, quoteId } = parse(repairQuoteParamsSchema, req.params);
  await inTransaction((tx) =>
    repairs.deleteQuote(tx, actorOf(req), id, quoteId, requestContext(req)),
  );
  res.status(204).end();
});

repairsRouter.post('/:id/quotes/:quoteId/issue', work, async (req, res) => {
  const { id, quoteId } = parse(repairQuoteParamsSchema, req.params);
  const { version } = parse(quoteVersionSchema, req.body);
  await sendIdempotent(req, res, 200, async (tx) => ({
    data: await repairs.issueQuote(tx, actorOf(req), id, quoteId, version, requestContext(req)),
  }));
});

// Decisions recorded by an administrator on the customer's behalf (D2).
for (const [path, approve] of [
  ['approve', true],
  ['reject', false],
] as const) {
  repairsRouter.post(`/:id/quotes/:quoteId/${path}`, manage, async (req, res) => {
    const { id, quoteId } = parse(repairQuoteParamsSchema, req.params);
    const input = parse(staffQuoteDecisionSchema, req.body);
    await sendIdempotent(req, res, 200, async (tx) => ({
      data: await repairs.staffDecideQuote(
        tx,
        actorOf(req),
        id,
        quoteId,
        { approve, version: input.version, channel: input.channel, note: input.note },
        requestContext(req),
      ),
    }));
  });
}

// Parts used on the job (Phase 5). Inventory managers can read these.
repairsRouter.get('/:id/parts', read, async (req, res) => {
  const { id } = parse(uuidParamSchema, req.params);
  res.json({ data: await inventory.listRepairParts(actorOf(req), id) });
});

repairsRouter.post('/:id/parts', work, async (req, res) => {
  const { id } = parse(uuidParamSchema, req.params);
  const input = parse(useRepairPartSchema, req.body);
  await sendIdempotent(req, res, 201, async (tx) => ({
    data: await inventory.useRepairPart(tx, actorOf(req), id, input, requestContext(req)),
  }));
});

repairsRouter.post('/:id/parts/returns', work, async (req, res) => {
  const { id } = parse(uuidParamSchema, req.params);
  const input = parse(returnRepairPartSchema, req.body);
  await sendIdempotent(req, res, 201, async (tx) => ({
    data: await inventory.returnRepairPart(tx, actorOf(req), id, input, requestContext(req)),
  }));
});
