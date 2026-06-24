import { QueryClient } from '@tanstack/react-query';
import { isApiAuthError } from './axios';

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 1000 * 60 * 10, // 10 minutes
      retry: (failureCount, error) => !isApiAuthError(error) && failureCount < 3,
      refetchOnWindowFocus: false,
      refetchOnReconnect: true,
      gcTime: 1000 * 60 * 30, // 30 minutes
    },
    mutations: {
      retry: (failureCount, error) => !isApiAuthError(error) && failureCount < 2,
    },
  },
});

queryClient.setQueryDefaults(['compendium', 'spells', 'lookup'], {
  staleTime: 1000 * 60 * 30,
  gcTime: 1000 * 60 * 120,
});

queryClient.setQueryDefaults(['compendium'], {
  retry: (failureCount, error) => !isApiAuthError(error) && failureCount < 3,
});
