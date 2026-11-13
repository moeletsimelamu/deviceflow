import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  Contact,
  CreateContactInput,
  CreateCustomerInput,
  CreateCustomerUserInput,
  Customer,
  CustomerSummary,
  CustomerType,
  Paginated,
  UpdateContactInput,
  UpdateCustomerInput,
  User,
} from '@deviceflow/shared';
import { api, toQueryString } from '../../lib/api';

export interface CustomerFilters {
  search: string;
  type: CustomerType | '';
  status: 'active' | 'archived' | '';
  page: number;
  sort: string;
}

export const customersKeys = {
  all: ['customers'] as const,
  list: (f: CustomerFilters) => ['customers', 'list', f] as const,
  detail: (id: string) => ['customers', 'detail', id] as const,
  contacts: (id: string) => ['customers', 'detail', id, 'contacts'] as const,
  users: (id: string) => ['customers', 'detail', id, 'users'] as const,
  lookup: (search: string) => ['customers', 'lookup', search] as const,
};

export function useCustomers(filters: CustomerFilters) {
  return useQuery({
    queryKey: customersKeys.list(filters),
    queryFn: ({ signal }) =>
      api<Paginated<Customer>>(
        `/customers${toQueryString({
          search: filters.search,
          type: filters.type,
          isActive: filters.status === '' ? undefined : filters.status === 'active',
          page: filters.page,
          pageSize: 20,
          sort: filters.sort,
        })}`,
        { signal },
      ),
    placeholderData: keepPreviousData,
  });
}

export function useCustomer(id: string) {
  return useQuery({
    queryKey: customersKeys.detail(id),
    queryFn: ({ signal }) =>
      api<{ data: Customer }>(`/customers/${id}`, { signal }).then((r) => r.data),
  });
}

export function useCustomerLookup(search: string, enabled: boolean) {
  return useQuery<CustomerSummary[]>({
    queryKey: customersKeys.lookup(search),
    queryFn: ({ signal }) =>
      api<{ data: CustomerSummary[] }>(`/customers/lookup${toQueryString({ search })}`, {
        signal,
      }).then((r) => r.data),
    enabled,
    placeholderData: keepPreviousData,
  });
}

export function useCreateCustomer() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateCustomerInput) =>
      api<{ data: Customer }>('/customers', { method: 'POST', body: input }).then((r) => r.data),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: customersKeys.all }),
  });
}

export function useUpdateCustomer(id: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: UpdateCustomerInput) =>
      api<{ data: Customer }>(`/customers/${id}`, { method: 'PATCH', body: input }).then(
        (r) => r.data,
      ),
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: customersKeys.all });
      void queryClient.invalidateQueries({ queryKey: ['activity'] });
    },
  });
}

export function useContacts(customerId: string) {
  return useQuery({
    queryKey: customersKeys.contacts(customerId),
    queryFn: ({ signal }) =>
      api<{ data: Contact[] }>(`/customers/${customerId}/contacts`, { signal }).then((r) => r.data),
  });
}

export function useSaveContact(customerId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (
      args:
        { id: string; input: UpdateContactInput } | { id?: undefined; input: CreateContactInput },
    ) =>
      (args.id
        ? api<{ data: Contact }>(`/customers/${customerId}/contacts/${args.id}`, {
            method: 'PATCH',
            body: args.input,
          })
        : api<{ data: Contact }>(`/customers/${customerId}/contacts`, {
            method: 'POST',
            body: args.input,
          })
      ).then((r) => r.data),
    onSettled: () =>
      queryClient.invalidateQueries({ queryKey: customersKeys.contacts(customerId) }),
  });
}

export function useDeleteContact(customerId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (contactId: string) =>
      api<void>(`/customers/${customerId}/contacts/${contactId}`, { method: 'DELETE' }),
    onSettled: () =>
      queryClient.invalidateQueries({ queryKey: customersKeys.contacts(customerId) }),
  });
}

export function useCustomerUsers(customerId: string, enabled: boolean) {
  return useQuery({
    queryKey: customersKeys.users(customerId),
    queryFn: ({ signal }) =>
      api<{ data: User[] }>(`/customers/${customerId}/users`, { signal }).then((r) => r.data),
    enabled,
  });
}

export function useCreateCustomerUser(customerId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateCustomerUserInput) =>
      api<{ data: User }>(`/customers/${customerId}/users`, { method: 'POST', body: input }).then(
        (r) => r.data,
      ),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: customersKeys.users(customerId) });
      void queryClient.invalidateQueries({ queryKey: ['users'] });
    },
  });
}
