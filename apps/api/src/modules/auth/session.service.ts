import { env } from '../../config/env.js';
import { generateSessionToken, hashToken } from '../../lib/crypto.js';
import type { Actor } from '../../lib/context.js';
import { prisma, type Db } from '../../lib/prisma.js';

/**
 * Server-side sessions. The browser holds a random token in an httpOnly cookie;
 * the database holds only its SHA-256 hash, so a database leak does not leak
 * usable sessions. Revocation (logout, deactivation, role change) is a delete.
 */
export const SESSION_COOKIE = env.COOKIE_SECURE ? '__Host-df_session' : 'df_session';

const IDLE_MS = env.SESSION_IDLE_MINUTES * 60_000;
const ABSOLUTE_MS = env.SESSION_ABSOLUTE_HOURS * 3_600_000;
/** Avoid a database write on every request: refresh lastSeenAt at most once a minute. */
const TOUCH_INTERVAL_MS = 60_000;

export function sessionCookieOptions() {
  return {
    httpOnly: true,
    secure: env.COOKIE_SECURE,
    sameSite: 'lax' as const,
    path: '/',
    maxAge: ABSOLUTE_MS,
  };
}

export async function createSession(
  db: Db,
  userId: string,
  meta: { ipAddress: string | null; userAgent: string | null },
): Promise<{ token: string; sessionId: string }> {
  const token = generateSessionToken();
  const now = Date.now();
  const session = await db.session.create({
    data: {
      tokenHash: hashToken(token),
      userId,
      expiresAt: new Date(now + ABSOLUTE_MS),
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent?.slice(0, 512) ?? null,
    },
  });
  // Housekeeping: drop this user's expired sessions.
  await db.session.deleteMany({ where: { userId, expiresAt: { lt: new Date(now) } } });
  return { token, sessionId: session.id };
}

/** Returns the actor for a valid token, or null if the session is missing, expired or the user is inactive. */
export async function resolveSession(token: string): Promise<Actor | null> {
  const session = await prisma.session.findUnique({
    where: { tokenHash: hashToken(token) },
    include: {
      user: {
        select: {
          id: true,
          email: true,
          fullName: true,
          role: true,
          isActive: true,
          customerAccountId: true,
          customerAccount: { select: { isActive: true } },
        },
      },
    },
  });
  if (!session) return null;

  const now = Date.now();
  const expired =
    session.expiresAt.getTime() <= now || session.lastSeenAt.getTime() + IDLE_MS <= now;
  // An archived customer account blocks its users immediately, even mid-session.
  const accountArchived = session.user.customerAccount?.isActive === false;
  if (expired || !session.user.isActive || accountArchived) {
    await prisma.session.deleteMany({ where: { id: session.id } });
    return null;
  }

  if (now - session.lastSeenAt.getTime() > TOUCH_INTERVAL_MS) {
    await prisma.session.update({ where: { id: session.id }, data: { lastSeenAt: new Date(now) } });
  }

  return {
    userId: session.user.id,
    role: session.user.role,
    email: session.user.email,
    fullName: session.user.fullName,
    customerAccountId: session.user.customerAccountId,
    sessionId: session.id,
  };
}

export async function revokeSession(sessionId: string): Promise<void> {
  await prisma.session.deleteMany({ where: { id: sessionId } });
}

export async function revokeAllSessionsForUser(db: Db, userId: string): Promise<void> {
  await db.session.deleteMany({ where: { userId } });
}
