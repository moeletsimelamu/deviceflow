import { Router } from 'express';
import { z } from 'zod';
import {
  contactParamsSchema,
  createContactSchema,
  createCustomerSchema,
  createCustomerUserSchema,
  listCustomersQuerySchema,
  updateContactSchema,
  updateCustomerSchema,
  uuidParamSchema,
} from '@deviceflow/shared';
import { requirePermission } from '../../http/middleware/auth.js';
import { actorOf, requestContext } from '../../http/request-context.js';
import { parse } from '../../lib/validation.js';
import * as customers from './customers.service.js';

export const customersRouter = Router();

const read = requirePermission('customers:read');
const manage = requirePermission('customers:manage');

customersRouter.get('/', read, async (req, res) => {
  res.json(await customers.listCustomers(parse(listCustomersQuerySchema, req.query)));
});

/** Lightweight lookup for pickers: active accounts only, at most 20. */
customersRouter.get('/lookup', read, async (req, res) => {
  const { search } = parse(z.object({ search: z.string().trim().max(100).default('') }), req.query);
  res.json({ data: await customers.searchCustomerSummaries(search) });
});

customersRouter.get('/:id', read, async (req, res) => {
  const { id } = parse(uuidParamSchema, req.params);
  res.json({ data: await customers.getCustomer(id) });
});

customersRouter.post('/', manage, async (req, res) => {
  const input = parse(createCustomerSchema, req.body);
  const customer = await customers.createCustomer(actorOf(req), input, requestContext(req));
  res.status(201).json({ data: customer });
});

customersRouter.patch('/:id', manage, async (req, res) => {
  const { id } = parse(uuidParamSchema, req.params);
  const input = parse(updateCustomerSchema, req.body);
  res.json({ data: await customers.updateCustomer(actorOf(req), id, input, requestContext(req)) });
});

customersRouter.get('/:id/contacts', read, async (req, res) => {
  const { id } = parse(uuidParamSchema, req.params);
  res.json({ data: await customers.listContacts(id) });
});

customersRouter.post('/:id/contacts', manage, async (req, res) => {
  const { id } = parse(uuidParamSchema, req.params);
  const input = parse(createContactSchema, req.body);
  const contact = await customers.createContact(actorOf(req), id, input, requestContext(req));
  res.status(201).json({ data: contact });
});

customersRouter.patch('/:id/contacts/:contactId', manage, async (req, res) => {
  const { id, contactId } = parse(contactParamsSchema, req.params);
  const input = parse(updateContactSchema, req.body);
  res.json({
    data: await customers.updateContact(actorOf(req), id, contactId, input, requestContext(req)),
  });
});

customersRouter.delete('/:id/contacts/:contactId', manage, async (req, res) => {
  const { id, contactId } = parse(contactParamsSchema, req.params);
  await customers.deleteContact(actorOf(req), id, contactId, requestContext(req));
  res.status(204).end();
});

// Portal sign-ins belong to user administration, so they need users:* permissions.
customersRouter.get('/:id/users', requirePermission('users:read'), async (req, res) => {
  const { id } = parse(uuidParamSchema, req.params);
  res.json({ data: await customers.listCustomerUsers(id) });
});

customersRouter.post('/:id/users', requirePermission('users:manage'), async (req, res) => {
  const { id } = parse(uuidParamSchema, req.params);
  const input = parse(createCustomerUserSchema, req.body);
  const user = await customers.createCustomerUser(actorOf(req), id, input, requestContext(req));
  res.status(201).json({ data: user });
});
