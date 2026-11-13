import { z } from 'zod';

/**
 * Reusable field parsers for optional values coming from forms and JSON.
 *
 * Convention for optional fields:
 *  - `undefined` (key absent) means "leave unchanged" in a PATCH,
 *  - `null` or an empty string means "clear the value" and is stored as NULL.
 */
function blankToNull<T extends string>(value: T | null | undefined): T | null | undefined {
  if (value === undefined) return undefined;
  if (value === null || value === '') return null;
  return value;
}

export function optionalText(max: number) {
  return z
    .string()
    .trim()
    .max(max, `Must be at most ${max} characters`)
    .nullish()
    .transform(blankToNull);
}

export const optionalEmail = z
  .string()
  .trim()
  .toLowerCase()
  .max(254)
  .nullish()
  .transform(blankToNull)
  .refine((v) => v == null || z.email().safeParse(v).success, 'Enter a valid email address');

export const optionalPhone = optionalText(32).refine(
  (v) => v == null || /^\+?[0-9 ()-]{6,31}$/.test(v),
  'Enter a valid phone number',
);

/** A calendar date as `YYYY-MM-DD` (no time zone), or empty for none. */
export const optionalDate = z
  .union([z.literal(''), z.iso.date({ message: 'Enter a valid date' })])
  .nullish()
  .transform(blankToNull);

/** Today's date as `YYYY-MM-DD`, allowing one day of slack for time zones ahead of UTC. */
export function latestAllowedDate(now = new Date()): string {
  return new Date(now.getTime() + 24 * 60 * 60_000).toISOString().slice(0, 10);
}

export const versionField = z.number().int().min(0);

/** True when a PATCH body contains at least one field besides `version`. */
export function hasChanges(value: Record<string, unknown>): boolean {
  return Object.entries(value).some(([key, v]) => key !== 'version' && v !== undefined);
}
