import type { CompanySettings, UpdateCompanySettingsInput } from '@deviceflow/shared';
import { recordAudit } from '../../lib/audit.js';
import type { Actor, RequestContext } from '../../lib/context.js';
import { conflict } from '../../lib/errors.js';
import { prisma } from '../../lib/prisma.js';
import type { CompanySettings as SettingsRow } from '../../generated/prisma/client.js';

const SETTINGS_ID = 1;

function toDto(row: SettingsRow): CompanySettings {
  return {
    companyName: row.companyName,
    currency: row.currency as CompanySettings['currency'],
    vatRateBasisPoints: row.vatRateBasisPoints,
    updatedAt: row.updatedAt.toISOString(),
    version: row.version,
  };
}

/** The settings row is created by the initial migration, so it always exists. */
export async function getSettings(): Promise<CompanySettings> {
  return toDto(await prisma.companySettings.findUniqueOrThrow({ where: { id: SETTINGS_ID } }));
}

export async function updateSettings(
  actor: Actor,
  input: UpdateCompanySettingsInput,
  ctx: RequestContext,
): Promise<CompanySettings> {
  return prisma.$transaction(async (tx) => {
    const before = await tx.companySettings.findUniqueOrThrow({ where: { id: SETTINGS_ID } });
    const { version, ...changes } = input;
    const { count } = await tx.companySettings.updateMany({
      where: { id: SETTINGS_ID, version },
      data: { ...changes, version: { increment: 1 } },
    });
    if (count === 0) throw conflict();
    const after = await tx.companySettings.findUniqueOrThrow({ where: { id: SETTINGS_ID } });
    await recordAudit(
      tx,
      {
        actorUserId: actor.userId,
        action: 'settings.updated',
        entityType: 'CompanySettings',
        entityId: String(SETTINGS_ID),
        before: toDto(before),
        after: toDto(after),
      },
      ctx,
    );
    return toDto(after);
  });
}
