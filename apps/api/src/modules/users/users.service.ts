import type {
  CreateUserInput,
  ListUsersQuery,
  Paginated,
  UpdateUserInput,
  User,
} from '@deviceflow/shared';
import { recordAudit } from '../../lib/audit.js';
import type { Actor, RequestContext } from '../../lib/context.js';
import { hashPassword } from '../../lib/crypto.js';
import { AppError, conflict, notFound } from '../../lib/errors.js';
import { pageArgs, paginated } from '../../lib/pagination.js';
import { Prisma, prisma } from '../../lib/prisma.js';
import type { User as UserRow } from '../../generated/prisma/client.js';
import { revokeAllSessionsForUser } from '../auth/session.service.js';

/** Never return passwordHash: map rows to the public DTO explicitly. */
export function toUserDto(user: UserRow): User {
  return {
    id: user.id,
    email: user.email,
    fullName: user.fullName,
    role: user.role,
    isActive: user.isActive,
    customerAccountId: user.customerAccountId,
    lastLoginAt: user.lastLoginAt?.toISOString() ?? null,
    createdAt: user.createdAt.toISOString(),
    updatedAt: user.updatedAt.toISOString(),
    version: user.version,
  };
}

export async function listUsers(query: ListUsersQuery): Promise<Paginated<User>> {
  const where: Prisma.UserWhereInput = {
    ...(query.role ? { role: query.role } : {}),
    ...(query.isActive !== undefined ? { isActive: query.isActive } : {}),
    ...(query.search
      ? {
          OR: [
            { email: { contains: query.search, mode: 'insensitive' } },
            { fullName: { contains: query.search, mode: 'insensitive' } },
          ],
        }
      : {}),
  };

  const [rows, total] = await prisma.$transaction([
    prisma.user.findMany({
      where,
      orderBy: [{ [query.sort.field]: query.sort.direction }, { id: 'asc' }],
      ...pageArgs(query.page, query.pageSize),
    }),
    prisma.user.count({ where }),
  ]);

  return paginated(rows.map(toUserDto), total, query.page, query.pageSize);
}

export async function getUser(id: string): Promise<User> {
  const user = await prisma.user.findUnique({ where: { id } });
  if (!user) throw notFound('User');
  return toUserDto(user);
}

export async function createUser(
  actor: Actor,
  input: CreateUserInput,
  ctx: RequestContext,
): Promise<User> {
  const passwordHash = await hashPassword(input.password);
  try {
    return await prisma.$transaction(async (tx) => {
      const user = await tx.user.create({
        data: {
          email: input.email,
          fullName: input.fullName,
          role: input.role,
          passwordHash,
        },
      });
      const dto = toUserDto(user);
      await recordAudit(
        tx,
        {
          actorUserId: actor.userId,
          action: 'user.created',
          entityType: 'User',
          entityId: user.id,
          after: dto,
        },
        ctx,
      );
      return dto;
    });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      throw new AppError(409, 'EMAIL_TAKEN', 'A user with this email address already exists');
    }
    throw err;
  }
}

/**
 * Updates name, role or active state. Uses the `version` column for optimistic
 * concurrency: a stale form gets 409 instead of silently overwriting someone
 * else's change. Role changes and deactivation revoke the user's sessions so
 * the new permissions apply immediately.
 */
export async function updateUser(
  actor: Actor,
  id: string,
  input: UpdateUserInput,
  ctx: RequestContext,
): Promise<User> {
  if (id === actor.userId && (input.role !== undefined || input.isActive === false)) {
    throw new AppError(
      422,
      'CANNOT_MODIFY_SELF',
      'You cannot change your own role or deactivate your own account',
    );
  }

  return prisma.$transaction(async (tx) => {
    const before = await tx.user.findUnique({ where: { id } });
    if (!before) throw notFound('User');
    if (before.role === 'CUSTOMER' && input.role !== undefined) {
      throw new AppError(422, 'ROLE_NOT_ALLOWED', 'Customer users cannot be given a staff role');
    }

    const { count } = await tx.user.updateMany({
      where: { id, version: input.version },
      data: {
        ...(input.fullName !== undefined ? { fullName: input.fullName } : {}),
        ...(input.role !== undefined ? { role: input.role } : {}),
        ...(input.isActive !== undefined ? { isActive: input.isActive } : {}),
        version: { increment: 1 },
      },
    });
    if (count === 0) throw conflict();

    const after = await tx.user.findUniqueOrThrow({ where: { id } });

    const permissionsChanged =
      (input.role !== undefined && input.role !== before.role) ||
      (input.isActive === false && before.isActive);
    if (permissionsChanged) await revokeAllSessionsForUser(tx, id);

    const action =
      input.isActive === false && before.isActive
        ? 'user.deactivated'
        : input.isActive === true && !before.isActive
          ? 'user.reactivated'
          : 'user.updated';
    await recordAudit(
      tx,
      {
        actorUserId: actor.userId,
        action,
        entityType: 'User',
        entityId: id,
        before: toUserDto(before),
        after: toUserDto(after),
      },
      ctx,
    );
    return toUserDto(after);
  });
}
