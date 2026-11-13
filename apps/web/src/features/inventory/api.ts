import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  CreatePartInput,
  Paginated,
  Part,
  PartCategory,
  RecordAdjustmentInput,
  RecordPurchaseInput,
  RepairParts,
  StockMovement,
  StockMovementType,
  UpdatePartInput,
  UseRepairPartInput,
} from '@deviceflow/shared';
import { api, toQueryString } from '../../lib/api';

export interface PartFilters {
  search: string;
  category: PartCategory | '';
  stock: 'low' | 'out' | '';
  isActive: boolean;
  page: number;
  sort: string;
}

export interface MovementFilters {
  type: StockMovementType | '';
  part?: string;
  from: string;
  to: string;
  page: number;
}

export const inventoryKeys = {
  all: ['inventory'] as const,
  parts: (f: PartFilters, pageSize: number) => ['inventory', 'parts', f, pageSize] as const,
  part: (id: string) => ['inventory', 'part', id] as const,
  movements: (f: MovementFilters, pageSize: number) =>
    ['inventory', 'movements', f, pageSize] as const,
};

export function useParts(filters: PartFilters, pageSize = 25, enabled = true) {
  return useQuery({
    queryKey: inventoryKeys.parts(filters, pageSize),
    queryFn: ({ signal }) =>
      api<Paginated<Part>>(`/inventory/parts${toQueryString({ ...filters, pageSize })}`, {
        signal,
      }),
    placeholderData: keepPreviousData,
    enabled,
  });
}

export function usePart(id: string) {
  return useQuery({
    queryKey: inventoryKeys.part(id),
    queryFn: ({ signal }) =>
      api<{ data: Part }>(`/inventory/parts/${id}`, { signal }).then((r) => r.data),
  });
}

export function useMovements(filters: MovementFilters, pageSize = 25) {
  return useQuery({
    queryKey: inventoryKeys.movements(filters, pageSize),
    queryFn: ({ signal }) =>
      api<Paginated<StockMovement>>(
        `/inventory/movements${toQueryString({ ...filters, pageSize })}`,
        { signal },
      ),
    placeholderData: keepPreviousData,
  });
}

export function useRepairParts(repairId: string) {
  return useQuery({
    queryKey: ['repairs', 'detail', repairId, 'parts'],
    queryFn: ({ signal }) =>
      api<{ data: RepairParts }>(`/repairs/${repairId}/parts`, { signal }).then((r) => r.data),
  });
}

/** Stock changes show up in parts, the ledger, repair jobs and the activity feed. */
function useInvalidateStock() {
  const queryClient = useQueryClient();
  return () => {
    void queryClient.invalidateQueries({ queryKey: inventoryKeys.all });
    void queryClient.invalidateQueries({ queryKey: ['repairs'] });
    void queryClient.invalidateQueries({ queryKey: ['activity'] });
  };
}

function post<T>(path: string, body: unknown, idempotencyKey: string) {
  return api<{ data: T }>(path, { method: 'POST', body, idempotencyKey }).then((r) => r.data);
}

export function useCreatePart(idempotencyKey: string) {
  const invalidate = useInvalidateStock();
  return useMutation({
    mutationFn: (input: CreatePartInput) => post<Part>('/inventory/parts', input, idempotencyKey),
    onSuccess: invalidate,
  });
}

export function useUpdatePart(id: string) {
  const invalidate = useInvalidateStock();
  return useMutation({
    mutationFn: (input: UpdatePartInput) =>
      api<{ data: Part }>(`/inventory/parts/${id}`, { method: 'PATCH', body: input }).then(
        (r) => r.data,
      ),
    onSettled: invalidate,
  });
}

export function useRecordPurchase(id: string, idempotencyKey: string) {
  const invalidate = useInvalidateStock();
  return useMutation({
    mutationFn: (input: RecordPurchaseInput) =>
      post<StockMovement>(`/inventory/parts/${id}/purchases`, input, idempotencyKey),
    onSuccess: invalidate,
  });
}

export function useRecordAdjustment(id: string, idempotencyKey: string) {
  const invalidate = useInvalidateStock();
  return useMutation({
    mutationFn: (input: RecordAdjustmentInput) =>
      post<StockMovement>(`/inventory/parts/${id}/adjustments`, input, idempotencyKey),
    onSettled: invalidate,
  });
}

export function useUseRepairPart(repairId: string, idempotencyKey: string) {
  const invalidate = useInvalidateStock();
  return useMutation({
    mutationFn: (input: UseRepairPartInput) =>
      post<StockMovement>(`/repairs/${repairId}/parts`, input, idempotencyKey),
    onSettled: invalidate,
  });
}

export function useReturnRepairPart(repairId: string, idempotencyKey: string) {
  const invalidate = useInvalidateStock();
  return useMutation({
    mutationFn: (input: UseRepairPartInput) =>
      post<StockMovement>(`/repairs/${repairId}/parts/returns`, input, idempotencyKey),
    onSettled: invalidate,
  });
}
