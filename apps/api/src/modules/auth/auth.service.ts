import type { LoginInput, SessionUser } from '@deviceflow/shared';
import { recordAudit } from '../../lib/audit.js';
import type { Actor, RequestContext } from '../../lib/context.js';
import { getDummyHash, verifyPassword } from '../../lib/crypto.js';
import { AppError } from '../../lib/errors.js';
import { prisma } from '../../lib/prisma.js';
import { createSession, revokeSession } from './session.service.js';

const invalidCredentials = () =>
  new AppError(401, 'INVALID_CREDENTIALS', 'Email or password is incorrect');

/**
 * Verifies credentials and opens a session. Unknown email, wrong password and
 * deactivated account all produce the same error and take the same time, so the
 * endpoint cannot be used to discover which email addresses have accounts.
 */
export async function login(
  input: LoginInput,
  meta: { userAgent: string | null },
  ctx: RequestContext,
): Promise<{ token: string; user: SessionUser }> {
  const user = await prisma.user.findUnique({
    where: { email: input.email },
    include: { customerAccount: { select: { isActive: true } } },
  });

  if (!user) {
    await verifyPassword(await getDummyHash(), input.password);
    throw invalidCredentials();
  }

  const passwordOk = await verifyPassword(user.passwordHash, input.password);
  const accountArchived = user.customerAccount?.isActive === false;
  if (!passwordOk || !user.isActive || accountArchived) throw invalidCredentials();

  const { token } = await prisma.$transaction(async (tx) => {
    const session = await createSession(tx, user.id, {
      ipAddress: ctx.ipAddress,
      userAgent: meta.userAgent,
    });
    await tx.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });
    await recordAudit(
      tx,
      { actorUserId: user.id, action: 'auth.login', entityType: 'User', entityId: user.id },
      ctx,
    );
    return session;
  });

  return {
    token,
    user: {
      id: user.id,
      email: user.email,
      fullName: user.fullName,
      role: user.role,
      customerAccountId: user.customerAccountId,
    },
  };
}

export async function logout(actor: Actor, ctx: RequestContext): Promise<void> {
  await revokeSession(actor.sessionId);
  await recordAudit(
    prisma,
    {
      actorUserId: actor.userId,
      action: 'auth.logout',
      entityType: 'User',
      entityId: actor.userId,
    },
    ctx,
  );
}
