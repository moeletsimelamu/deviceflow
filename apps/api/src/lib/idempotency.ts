import { createHash } from 'node:crypto';
import type { Request, Response } from 'express';
import { AppError } from './errors.js';
import { Prisma, prisma, type Tx } from './prisma.js';

/**
 * Duplicate-request protection (Phase 1, §3.5).
 *
 * A client may send an `Idempotency-Key` header (8–128 characters of letters,
 * digits, `-` and `_`) with a state-changing request. The web app generates one
 * key per form submission, so a double click, a retry after a dropped
 * connection or a resubmitted form does not repeat the change.
 *
 * How it works:
 *  1. The key row is inserted **inside the same transaction** as the change, and
 *     the response is saved in that row before the transaction commits. Either
 *     both are stored or neither is, so a request is applied at most once.
 *  2. A second request with the same key while the first is still running
 *     waits on the unique index. When the first commits, the insert fails and
 *     the saved response is replayed. If the first failed (and rolled back),
 *     the second simply runs.
 *  3. The same key with a different method, path or body is refused with
 *     `422 IDEMPOTENCY_KEY_REUSED`, so a key cannot replay the wrong result.
 *  4. Failed requests store nothing (their transaction rolls back), so the user
 *     can correct the form and submit again with the same key.
 *  5. Keys expire after 24 hours.
 *
 * Without the header the request runs normally in a transaction. Business rules
 * (conditional updates, unique indexes) still prevent the duplicates that matter.
 */

export const IDEMPOTENCY_HEADER = 'Idempotency-Key';
const KEY_PATTERN = /^[A-Za-z0-9_-]{8,128}$/;
const KEY_TTL_MS = 24 * 60 * 60_000;

/** JSON with object keys sorted, so `{a,b}` and `{b,a}` hash the same. */
function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(',')}}`;
  }
  return JSON.stringify(value ?? null);
}

export function requestHash(method: string, path: string, body: unknown): string {
  return createHash('sha256')
    .update(`${method.toUpperCase()} ${path}\n${canonicalJson(body)}`)
    .digest('hex');
}

function readKey(req: Request): string | undefined {
  const raw = req.get(IDEMPOTENCY_HEADER);
  if (raw === undefined) return undefined;
  if (!KEY_PATTERN.test(raw)) {
    throw new AppError(400, 'VALIDATION_FAILED', 'The Idempotency-Key header is invalid', [
      {
        path: IDEMPOTENCY_HEADER,
        message: 'Use 8 to 128 letters, digits, hyphens or underscores',
      },
    ]);
  }
  return raw;
}

interface Saved {
  status: number;
  body: unknown;
}

type Lookup = { kind: 'none' } | { kind: 'replay'; saved: Saved } | { kind: 'mismatch' };

async function lookup(userId: string, key: string, hash: string): Promise<Lookup> {
  const row = await prisma.idempotencyKey.findUnique({ where: { userId_key: { userId, key } } });
  if (!row) return { kind: 'none' };
  if (Date.now() - row.createdAt.getTime() > KEY_TTL_MS) {
    await prisma.idempotencyKey.deleteMany({ where: { id: row.id } });
    return { kind: 'none' };
  }
  if (row.requestHash !== hash) return { kind: 'mismatch' };
  // A row without a response cannot be seen: it is only visible once committed,
  // and it is committed together with its response.
  return { kind: 'replay', saved: { status: row.responseStatus ?? 200, body: row.responseBody } };
}

function keyReused(): AppError {
  return new AppError(
    422,
    'IDEMPOTENCY_KEY_REUSED',
    'This Idempotency-Key was already used for a different request',
  );
}

/**
 * Runs `work` in a transaction and sends its result as JSON with `status`,
 * applying the Idempotency-Key rules above when the header is present.
 */
export async function sendIdempotent(
  req: Request,
  res: Response,
  status: number,
  work: (tx: Tx) => Promise<unknown>,
): Promise<void> {
  const key = readKey(req);
  const userId = req.actor?.userId;
  if (!key || !userId) {
    const body = await prisma.$transaction(work);
    res.status(status).json(body);
    return;
  }

  const hash = requestHash(req.method, `${req.baseUrl}${req.path}`, req.body);
  const replay = (saved: Saved) => {
    res.setHeader('Idempotency-Replayed', 'true');
    res.status(saved.status).json(saved.body);
  };

  const before = await lookup(userId, key, hash);
  if (before.kind === 'mismatch') throw keyReused();
  if (before.kind === 'replay') return replay(before.saved);

  try {
    const body = await prisma.$transaction(async (tx) => {
      const row = await tx.idempotencyKey.create({
        data: { userId, key, requestHash: hash },
      });
      const result = await work(tx);
      await tx.idempotencyKey.update({
        where: { id: row.id },
        data: {
          responseStatus: status,
          responseBody: JSON.parse(JSON.stringify(result)) as Prisma.InputJsonValue,
        },
      });
      return result;
    });
    res.status(status).json(body);
  } catch (err) {
    // A concurrent request with the same key committed first: replay its result.
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      const after = await lookup(userId, key, hash);
      if (after.kind === 'mismatch') throw keyReused();
      if (after.kind === 'replay') return replay(after.saved);
    }
    throw err;
  }
}

/** For mutations that do not take part in idempotency: run `work` in a transaction. */
export function inTransaction<T>(work: (tx: Tx) => Promise<T>): Promise<T> {
  return prisma.$transaction(work);
}
