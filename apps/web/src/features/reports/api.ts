import { keepPreviousData, useQuery } from '@tanstack/react-query';
import type { InventoryReport, OperationsReport } from '@deviceflow/shared';
import { api, toQueryString } from '../../lib/api';

export interface ReportRangeInput {
  from: string;
  to: string;
}

/** The previous report stays on screen (dimmed) while a new range loads. */
export function useOperationsReport(range: ReportRangeInput, enabled: boolean) {
  return useQuery<OperationsReport>({
    queryKey: ['reports', 'operations', range],
    queryFn: ({ signal }) =>
      api<{ data: OperationsReport }>(`/reports/operations${toQueryString({ ...range })}`, {
        signal,
      }).then((r) => r.data),
    placeholderData: keepPreviousData,
    enabled,
  });
}

export function useInventoryReport(range: ReportRangeInput, enabled: boolean) {
  return useQuery<InventoryReport>({
    queryKey: ['reports', 'inventory', range],
    queryFn: ({ signal }) =>
      api<{ data: InventoryReport }>(`/reports/inventory${toQueryString({ ...range })}`, {
        signal,
      }).then((r) => r.data),
    placeholderData: keepPreviousData,
    enabled,
  });
}
