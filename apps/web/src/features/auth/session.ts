import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  hasPermission,
  type LoginInput,
  type Permission,
  type SessionUser,
} from '@deviceflow/shared';
import { api, ApiError } from '../../lib/api';

export const SESSION_QUERY_KEY = ['session'] as const;

/** The signed-in user, or null when signed out. */
export function useSession() {
  return useQuery({
    queryKey: SESSION_QUERY_KEY,
    queryFn: async (): Promise<SessionUser | null> => {
      try {
        return (await api<{ user: SessionUser }>('/auth/me')).user;
      } catch (err) {
        if (err instanceof ApiError && err.status === 401) return null;
        throw err;
      }
    },
    staleTime: 5 * 60_000,
  });
}

export function useCurrentUser(): SessionUser {
  const { data } = useSession();
  if (!data) throw new Error('useCurrentUser must be used inside an authenticated route');
  return data;
}

export function useCan(permission: Permission): boolean {
  const { data } = useSession();
  return data ? hasPermission(data.role, permission) : false;
}

export function useLogin() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: LoginInput) =>
      api<{ user: SessionUser }>('/auth/login', { method: 'POST', body: input }),
    onSuccess: ({ user }) => {
      queryClient.clear();
      queryClient.setQueryData(SESSION_QUERY_KEY, user);
    },
  });
}

export function useLogout() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => api<void>('/auth/logout', { method: 'POST' }),
    // Whatever the server says, forget everything cached for this user.
    onSettled: () => {
      queryClient.clear();
      queryClient.setQueryData(SESSION_QUERY_KEY, null);
    },
  });
}
