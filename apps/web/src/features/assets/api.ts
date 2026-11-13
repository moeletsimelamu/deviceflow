import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  Asset,
  AssetCategory,
  AssetEvent,
  AssetStatus,
  ChangeAssetStatusInput,
  CreateAssetInput,
  Paginated,
  UpdateAssetInput,
} from '@deviceflow/shared';
import { api, ApiError, toQueryString } from '../../lib/api';

export interface AssetFilters {
  search: string;
  status: AssetStatus | '';
  category: AssetCategory | '';
  /** A customer id, "none" for stock, or "" for all. */
  customer: string;
  warranty: 'active' | 'expired' | 'none' | '';
  page: number;
  sort: string;
}

export const assetsKeys = {
  all: ['assets'] as const,
  list: (f: AssetFilters, pageSize: number) => ['assets', 'list', f, pageSize] as const,
  detail: (id: string) => ['assets', 'detail', id] as const,
  events: (id: string) => ['assets', 'detail', id, 'events'] as const,
};

function filterParams(f: AssetFilters) {
  return {
    search: f.search,
    status: f.status,
    category: f.category,
    customer: f.customer,
    warranty: f.warranty,
    sort: f.sort,
  };
}

export function useAssets(filters: AssetFilters, pageSize = 20) {
  return useQuery({
    queryKey: assetsKeys.list(filters, pageSize),
    queryFn: ({ signal }) =>
      api<Paginated<Asset>>(
        `/assets${toQueryString({ ...filterParams(filters), page: filters.page, pageSize })}`,
        { signal },
      ),
    placeholderData: keepPreviousData,
  });
}

export function useAsset(id: string) {
  return useQuery({
    queryKey: assetsKeys.detail(id),
    queryFn: ({ signal }) => api<{ data: Asset }>(`/assets/${id}`, { signal }).then((r) => r.data),
  });
}

export function useAssetEvents(id: string) {
  return useQuery({
    queryKey: assetsKeys.events(id),
    queryFn: ({ signal }) =>
      api<{ data: AssetEvent[] }>(`/assets/${id}/events`, { signal }).then((r) => r.data),
  });
}

function useInvalidateAssets() {
  const queryClient = useQueryClient();
  return () => {
    void queryClient.invalidateQueries({ queryKey: assetsKeys.all });
    // Asset counts on customers and the activity feed change too.
    void queryClient.invalidateQueries({ queryKey: ['customers'] });
    void queryClient.invalidateQueries({ queryKey: ['activity'] });
  };
}

export function useCreateAsset() {
  const invalidate = useInvalidateAssets();
  return useMutation({
    mutationFn: (input: CreateAssetInput) =>
      api<{ data: Asset }>('/assets', { method: 'POST', body: input }).then((r) => r.data),
    onSuccess: invalidate,
  });
}

export function useUpdateAsset(id: string) {
  const invalidate = useInvalidateAssets();
  return useMutation({
    mutationFn: (input: UpdateAssetInput) =>
      api<{ data: Asset }>(`/assets/${id}`, { method: 'PATCH', body: input }).then((r) => r.data),
    onSettled: invalidate,
  });
}

export function useChangeAssetStatus(id: string) {
  const invalidate = useInvalidateAssets();
  return useMutation({
    mutationFn: (input: ChangeAssetStatusInput) =>
      api<{ data: Asset }>(`/assets/${id}/status`, { method: 'POST', body: input }).then(
        (r) => r.data,
      ),
    onSettled: invalidate,
  });
}

/**
 * Downloads the CSV with fetch rather than a plain link, so a refusal (for
 * example "too many rows") is shown as a message instead of a JSON page.
 */
export async function downloadAssetExport(filters: AssetFilters): Promise<void> {
  const response = await fetch(`/api/v1/assets/export.csv${toQueryString(filterParams(filters))}`, {
    credentials: 'same-origin',
    headers: { 'X-Requested-With': 'DeviceFlow' },
  });
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as {
      error?: { code?: string; message?: string; requestId?: string };
    } | null;
    throw new ApiError(
      response.status,
      (body?.error?.code as ApiError['code'] | undefined) ?? 'INTERNAL_ERROR',
      body?.error?.message ?? `Export failed (${response.status})`,
      [],
      body?.error?.requestId,
    );
  }
  const blob = await response.blob();
  const name =
    /filename="([^"]+)"/.exec(response.headers.get('content-disposition') ?? '')?.[1] ??
    'deviceflow-assets.csv';
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  link.click();
  URL.revokeObjectURL(url);
}
