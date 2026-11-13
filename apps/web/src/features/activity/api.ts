import { keepPreviousData, useQuery } from '@tanstack/react-query';
import type { AuditEntry, Paginated } from '@deviceflow/shared';
import { api, toQueryString } from '../../lib/api';

export interface ActivityFilters {
  action?: string;
  actorUserId?: string;
  assetId?: string;
  customerAccountId?: string;
  repairJobId?: string;
  entityType?: string;
  entityId?: string;
  from?: string;
  to?: string;
  page: number;
  pageSize?: number;
}

export function useActivity(filters: ActivityFilters, enabled = true) {
  return useQuery({
    queryKey: ['activity', filters],
    queryFn: ({ signal }) =>
      api<Paginated<AuditEntry>>(
        `/audit${toQueryString({ ...filters, pageSize: filters.pageSize ?? 25 })}`,
        { signal },
      ),
    placeholderData: keepPreviousData,
    enabled,
  });
}
