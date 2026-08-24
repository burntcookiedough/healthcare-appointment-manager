import { QueryClient } from "@tanstack/react-query";

export function createQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 1000 * 60 * 2, // 2 minutes
        refetchOnWindowFocus: false,
        retry: (failureCount, error: any) => {
          // Do not retry 403 or validation failures
          if (error?.status === 403 || error?.status === 404 || error?.status === 422) {
            return false;
          }
          return failureCount < 2;
        },
      },
      mutations: {
        retry: false,
      },
    },
  });
}
