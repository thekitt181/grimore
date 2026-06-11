import { QueryClient } from '@tanstack/react-query';
import { isApiAuthError } from './axios';

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 1000 * 60 * 5, // 5 minutes
      retry: 1,
      refetchOnWindowFocus: false,
    },
    mutations: {
      retry: 0,
    },
  },
});

queryClient.setQueryDefaults(['compendium', 'spells', 'lookup'], {
  staleTime: 1000 * 60 * 30,
  gcTime: 1000 * 60 * 60,
});

queryClient.setQueryDefaults(['compendium'], {
  retry: (failureCount, error) => !isApiAuthError(error) && failureCount < 1,
});
