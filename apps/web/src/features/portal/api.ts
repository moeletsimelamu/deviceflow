import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  AssetStatus,
  Paginated,
  PortalAccount,
  PortalAsset,
  PortalAssetEvent,
  PortalCancelRepairInput,
  PortalCreateRepairInput,
  PortalQuotation,
  PortalRepair,
  PortalRepairTimelineEntry,
} from '@deviceflow/shared';
import { api, toQueryString } from '../../lib/api';

export function usePortalAccount() {
  return useQuery({
    queryKey: ['portal', 'account'],
    queryFn: ({ signal }) =>
      api<{ data: PortalAccount }>('/portal/account', { signal }).then((r) => r.data),
    staleTime: 5 * 60_000,
  });
}

export function usePortalAssets(filters: {
  search: string;
  status: AssetStatus | '';
  page: number;
}) {
  return useQuery({
    queryKey: ['portal', 'assets', filters],
    queryFn: ({ signal }) =>
      api<Paginated<PortalAsset>>(`/portal/assets${toQueryString({ ...filters, pageSize: 20 })}`, {
        signal,
      }),
    placeholderData: keepPreviousData,
  });
}

export function usePortalAsset(id: string) {
  return useQuery({
    queryKey: ['portal', 'assets', 'detail', id],
    queryFn: ({ signal }) =>
      api<{ data: PortalAsset }>(`/portal/assets/${id}`, { signal }).then((r) => r.data),
  });
}

export function usePortalAssetHistory(id: string) {
  return useQuery({
    queryKey: ['portal', 'assets', 'detail', id, 'history'],
    queryFn: ({ signal }) =>
      api<{ data: PortalAssetEvent[] }>(`/portal/assets/${id}/history`, { signal }).then(
        (r) => r.data,
      ),
  });
}

// --- Repairs ---------------------------------------------------------------------

export function usePortalRepairs(filters: {
  state: 'open' | 'closed' | '';
  asset?: string;
  page: number;
}) {
  return useQuery({
    queryKey: ['portal', 'repairs', filters],
    queryFn: ({ signal }) =>
      api<Paginated<PortalRepair>>(
        `/portal/repairs${toQueryString({ ...filters, pageSize: 20 })}`,
        {
          signal,
        },
      ),
    placeholderData: keepPreviousData,
  });
}

export function usePortalRepair(id: string) {
  return useQuery({
    queryKey: ['portal', 'repairs', 'detail', id],
    queryFn: ({ signal }) =>
      api<{ data: PortalRepair }>(`/portal/repairs/${id}`, { signal }).then((r) => r.data),
  });
}

export function usePortalRepairTimeline(id: string) {
  return useQuery({
    queryKey: ['portal', 'repairs', 'detail', id, 'timeline'],
    queryFn: ({ signal }) =>
      api<{ data: PortalRepairTimelineEntry[] }>(`/portal/repairs/${id}/timeline`, {
        signal,
      }).then((r) => r.data),
  });
}

export function usePortalRepairQuotes(id: string) {
  return useQuery({
    queryKey: ['portal', 'repairs', 'detail', id, 'quotes'],
    queryFn: ({ signal }) =>
      api<{ data: PortalQuotation[] }>(`/portal/repairs/${id}/quotes`, { signal }).then(
        (r) => r.data,
      ),
  });
}

/** Everything in the portal may change after a repair action (device status too). */
function useInvalidatePortal() {
  const queryClient = useQueryClient();
  return () => void queryClient.invalidateQueries({ queryKey: ['portal'] });
}

export function useRequestRepair(idempotencyKey: string) {
  const invalidate = useInvalidatePortal();
  return useMutation({
    mutationFn: (input: PortalCreateRepairInput) =>
      api<{ data: PortalRepair }>('/portal/repairs', {
        method: 'POST',
        body: input,
        idempotencyKey,
      }).then((r) => r.data),
    onSuccess: invalidate,
  });
}

export function usePortalDecision(repairId: string, idempotencyKey: string) {
  const invalidate = useInvalidatePortal();
  return useMutation({
    mutationFn: (input: {
      quoteId: string;
      approve: boolean;
      version: number;
      reason?: string | null;
    }) =>
      api<{ data: PortalQuotation }>(
        `/portal/repairs/${repairId}/quotes/${input.quoteId}/${input.approve ? 'approve' : 'reject'}`,
        {
          method: 'POST',
          body: input.approve
            ? { version: input.version }
            : { version: input.version, reason: input.reason ?? null },
          idempotencyKey,
        },
      ).then((r) => r.data),
    onSettled: invalidate,
  });
}

export function useCancelRepair(repairId: string, idempotencyKey: string) {
  const invalidate = useInvalidatePortal();
  return useMutation({
    mutationFn: (input: PortalCancelRepairInput) =>
      api<{ data: PortalRepair }>(`/portal/repairs/${repairId}/cancel`, {
        method: 'POST',
        body: input,
        idempotencyKey,
      }).then((r) => r.data),
    onSettled: invalidate,
  });
}
