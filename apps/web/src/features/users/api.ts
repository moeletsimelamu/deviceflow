import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { CreateUserInput, Paginated, Role, UpdateUserInput, User } from '@deviceflow/shared';
import { api, toQueryString } from '../../lib/api';

export interface UserFilters {
  search: string;
  role: Role | '';
  status: 'active' | 'inactive' | '';
  page: number;
  sort: string;
}

export const usersKeys = {
  all: ['users'] as const,
  list: (filters: UserFilters) => ['users', 'list', filters] as const,
};

export function useUsers(filters: UserFilters) {
  return useQuery({
    queryKey: usersKeys.list(filters),
    queryFn: ({ signal }) =>
      api<Paginated<User>>(
        `/users${toQueryString({
          search: filters.search,
          role: filters.role,
          isActive: filters.status === '' ? undefined : filters.status === 'active',
          page: filters.page,
          pageSize: 20,
          sort: filters.sort,
        })}`,
        { signal },
      ),
    // Keep showing the previous page while the next one loads (no flicker).
    placeholderData: keepPreviousData,
  });
}

export function useCreateUser() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateUserInput) =>
      api<{ data: User }>('/users', { method: 'POST', body: input }).then((r) => r.data),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: usersKeys.all }),
  });
}

export function useUpdateUser() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: UpdateUserInput }) =>
      api<{ data: User }>(`/users/${id}`, { method: 'PATCH', body: input }).then((r) => r.data),
    onSettled: () => queryClient.invalidateQueries({ queryKey: usersKeys.all }),
  });
}
