import { Router } from 'express';
import {
  createUserSchema,
  listUsersQuerySchema,
  updateUserSchema,
  uuidParamSchema,
} from '@deviceflow/shared';
import { requirePermission } from '../../http/middleware/auth.js';
import { actorOf, requestContext } from '../../http/request-context.js';
import { parse } from '../../lib/validation.js';
import * as usersService from './users.service.js';

export const usersRouter = Router();

usersRouter.get('/', requirePermission('users:read'), async (req, res) => {
  const query = parse(listUsersQuerySchema, req.query);
  res.json(await usersService.listUsers(query));
});

usersRouter.get('/:id', requirePermission('users:read'), async (req, res) => {
  const { id } = parse(uuidParamSchema, req.params);
  res.json({ data: await usersService.getUser(id) });
});

usersRouter.post('/', requirePermission('users:manage'), async (req, res) => {
  const input = parse(createUserSchema, req.body);
  const user = await usersService.createUser(actorOf(req), input, requestContext(req));
  res.status(201).json({ data: user });
});

usersRouter.patch('/:id', requirePermission('users:manage'), async (req, res) => {
  const { id } = parse(uuidParamSchema, req.params);
  const input = parse(updateUserSchema, req.body);
  const user = await usersService.updateUser(actorOf(req), id, input, requestContext(req));
  res.json({ data: user });
});
