import { MutationCache, QueryCache, QueryClient } from '@tanstack/react-query';
import { ApiError } from './api';
import { SESSION_QUERY_KEY } from '../features/auth/session';

/**
 * Shared query client. Client errors (4xx) are not retried: they will not fix
 * themselves. Any 401 means the session ended, so the session query is reset
 * and the router sends the user to the sign-in page.
 */
export function createQueryClient() {
  const onError = (error: unknown) => {
    if (error instanceof ApiError && error.status === 401) {
      queryClient.setQueryData(SESSION_QUERY_KEY, null);
    }
  };

  const queryClient: QueryClient = new QueryClient({
    queryCache: new QueryCache({ onError }),
    mutationCache: new MutationCache({ onError }),
    defaultOptions: {
      queries: {
        staleTime: 30_000,
        refetchOnWindowFocus: true,
        retry: (count, error) =>
          !(error instanceof ApiError && error.status >= 400 && error.status < 500) && count < 2,
      },
      mutations: { retry: false },
    },
  });
  return queryClient;
}
