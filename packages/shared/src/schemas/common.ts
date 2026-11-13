import { z } from 'zod';

/** Builds a `sort=field:asc|desc` parser restricted to an allow-list of fields. */
export function sortSchema<const F extends readonly [string, ...string[]]>(
  fields: F,
  fallback: `${F[number]}:${'asc' | 'desc'}`,
) {
  return z
    .string()
    .default(fallback)
    .transform((value, ctx) => {
      const [field, direction = 'asc'] = value.split(':');
      if (!field || !fields.includes(field) || !['asc', 'desc'].includes(direction)) {
        ctx.addIssue({
          code: 'custom',
          message: `Sort must be one of ${fields.join(', ')} followed by :asc or :desc`,
        });
        return z.NEVER;
      }
      return { field: field as F[number], direction: direction as 'asc' | 'desc' };
    });
}

export const paginationSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
});

export interface PageMeta {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

export interface Paginated<T> {
  data: T[];
  meta: PageMeta;
}

export const uuidParamSchema = z.object({ id: z.uuid() });
