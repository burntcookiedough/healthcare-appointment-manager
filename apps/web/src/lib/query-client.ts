import { QueryClient } from "@tanstack/react-query";

export function createQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 1000 * 60 * 2, // 2 minutes
        refetchOnWindowFocus: false,
        retry: (failureCount, error: unknown) => {
          // Do not retry 403 or validation failures
          const errObj = error as { status?: number };
          if (errObj?.status === 403 || errObj?.status === 404 || errObj?.status === 422) {
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
