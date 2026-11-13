import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  AddLabourInput,
  AddRepairNoteInput,
  AssignRepairInput,
  CreateQuoteInput,
  CreateRepairInput,
  LabourEntry,
  Paginated,
  Quotation,
  Repair,
  RepairHistoryEntry,
  RepairNote,
  RepairStatus,
  RepairTransitionInput,
  StaffQuoteDecisionInput,
  TechnicianOption,
  UpdateQuoteInput,
} from '@deviceflow/shared';
import { api, toQueryString } from '../../lib/api';

export interface RepairFilters {
  search: string;
  state: 'open' | 'closed' | '';
  status: RepairStatus | '';
  /** A technician id, "unassigned", or "" for everyone. */
  technician: string;
  customer?: string;
  asset?: string;
  page: number;
  sort: string;
}

export const repairsKeys = {
  all: ['repairs'] as const,
  list: (f: RepairFilters, pageSize: number) => ['repairs', 'list', f, pageSize] as const,
  detail: (id: string) => ['repairs', 'detail', id] as const,
  part: (id: string, part: string) => ['repairs', 'detail', id, part] as const,
  technicians: ['repairs', 'technicians'] as const,
};

export function useRepairs(filters: RepairFilters, pageSize = 20, enabled = true) {
  return useQuery({
    queryKey: repairsKeys.list(filters, pageSize),
    queryFn: ({ signal }) =>
      api<Paginated<Repair>>(`/repairs${toQueryString({ ...filters, pageSize })}`, { signal }),
    placeholderData: keepPreviousData,
    enabled,
  });
}

export function useRepair(id: string) {
  return useQuery({
    queryKey: repairsKeys.detail(id),
    queryFn: ({ signal }) =>
      api<{ data: Repair }>(`/repairs/${id}`, { signal }).then((r) => r.data),
  });
}

function usePart<T>(id: string, part: 'history' | 'notes' | 'labour' | 'quotes') {
  return useQuery({
    queryKey: repairsKeys.part(id, part),
    queryFn: ({ signal }) =>
      api<{ data: T }>(`/repairs/${id}/${part}`, { signal }).then((r) => r.data),
  });
}

export const useRepairHistory = (id: string) => usePart<RepairHistoryEntry[]>(id, 'history');
export const useRepairNotes = (id: string) => usePart<RepairNote[]>(id, 'notes');
export const useRepairLabour = (id: string) => usePart<LabourEntry[]>(id, 'labour');
export const useRepairQuotes = (id: string) => usePart<Quotation[]>(id, 'quotes');

export function useTechnicians(enabled = true) {
  return useQuery({
    queryKey: repairsKeys.technicians,
    queryFn: ({ signal }) =>
      api<{ data: TechnicianOption[] }>('/repairs/technicians', { signal }).then((r) => r.data),
    enabled,
  });
}

/** A repair change can move its device (IN_REPAIR) and adds activity entries. */
function useInvalidateRepairs() {
  const queryClient = useQueryClient();
  return () => {
    void queryClient.invalidateQueries({ queryKey: repairsKeys.all });
    void queryClient.invalidateQueries({ queryKey: ['assets'] });
    void queryClient.invalidateQueries({ queryKey: ['activity'] });
  };
}

/** POST with an Idempotency-Key (one per form submission, see useIdempotencyKey). */
function post<T>(path: string, body: unknown, idempotencyKey: string) {
  return api<{ data: T }>(path, { method: 'POST', body, idempotencyKey }).then((r) => r.data);
}

export function useCreateRepair(idempotencyKey: string) {
  const invalidate = useInvalidateRepairs();
  return useMutation({
    mutationFn: (input: CreateRepairInput) => post<Repair>('/repairs', input, idempotencyKey),
    onSuccess: invalidate,
  });
}

export function useAssignRepair(id: string, idempotencyKey: string) {
  const invalidate = useInvalidateRepairs();
  return useMutation({
    mutationFn: (input: AssignRepairInput) =>
      post<Repair>(`/repairs/${id}/assign`, input, idempotencyKey),
    onSettled: invalidate,
  });
}

export function useTransitionRepair(id: string, idempotencyKey: string) {
  const invalidate = useInvalidateRepairs();
  return useMutation({
    mutationFn: (input: RepairTransitionInput) =>
      post<Repair>(`/repairs/${id}/transitions`, input, idempotencyKey),
    onSettled: invalidate,
  });
}

export function useAddNote(id: string, idempotencyKey: string) {
  const invalidate = useInvalidateRepairs();
  return useMutation({
    mutationFn: (input: AddRepairNoteInput) =>
      post<RepairNote>(`/repairs/${id}/notes`, input, idempotencyKey),
    onSuccess: invalidate,
  });
}

export function useAddLabour(id: string, idempotencyKey: string) {
  const invalidate = useInvalidateRepairs();
  return useMutation({
    mutationFn: (input: AddLabourInput) =>
      post<LabourEntry>(`/repairs/${id}/labour`, input, idempotencyKey),
    onSuccess: invalidate,
  });
}

export function useDeleteLabour(id: string) {
  const invalidate = useInvalidateRepairs();
  return useMutation({
    mutationFn: (entryId: string) =>
      api<void>(`/repairs/${id}/labour/${entryId}`, { method: 'DELETE' }),
    onSettled: invalidate,
  });
}

export function useSaveQuote(id: string, idempotencyKey: string) {
  const invalidate = useInvalidateRepairs();
  return useMutation({
    mutationFn: (
      input:
        { quoteId: null; body: CreateQuoteInput } | { quoteId: string; body: UpdateQuoteInput },
    ) =>
      input.quoteId === null
        ? post<Quotation>(`/repairs/${id}/quotes`, input.body, idempotencyKey)
        : api<{ data: Quotation }>(`/repairs/${id}/quotes/${input.quoteId}`, {
            method: 'PATCH',
            body: input.body,
          }).then((r) => r.data),
    onSettled: invalidate,
  });
}

export function useDeleteQuote(id: string) {
  const invalidate = useInvalidateRepairs();
  return useMutation({
    mutationFn: (quoteId: string) =>
      api<void>(`/repairs/${id}/quotes/${quoteId}`, { method: 'DELETE' }),
    onSettled: invalidate,
  });
}

export function useIssueQuote(id: string, idempotencyKey: string) {
  const invalidate = useInvalidateRepairs();
  return useMutation({
    mutationFn: (quote: { id: string; version: number }) =>
      post<Quotation>(
        `/repairs/${id}/quotes/${quote.id}/issue`,
        { version: quote.version },
        idempotencyKey,
      ),
    onSettled: invalidate,
  });
}

export function useDecideQuote(id: string, idempotencyKey: string) {
  const invalidate = useInvalidateRepairs();
  return useMutation({
    mutationFn: (input: { quoteId: string; approve: boolean; body: StaffQuoteDecisionInput }) =>
      post<Quotation>(
        `/repairs/${id}/quotes/${input.quoteId}/${input.approve ? 'approve' : 'reject'}`,
        input.body,
        idempotencyKey,
      ),
    onSettled: invalidate,
  });
}
