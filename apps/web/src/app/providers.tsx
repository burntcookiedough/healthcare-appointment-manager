"use client";

import * as React from "react";
import { QueryClientProvider } from "@tanstack/react-query";
import { createQueryClient } from "@/lib/query-client";
import { AuthProvider } from "@/features/auth/auth-context";
import { ScenarioSwitcher } from "@/components/dev/ScenarioSwitcher";
import { Toaster } from "sonner";

export function Providers({ children }: { children: React.ReactNode }) {
  const [queryClient] = React.useState(() => createQueryClient());

  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        {children}
        <Toaster
          position="bottom-left"
          toastOptions={{
            style: {
              background: "#111111",
              color: "#ffffff",
              borderRadius: "16px",
              border: "1px solid #262626",
            },
          }}
        />
        <ScenarioSwitcher />
      </AuthProvider>
    </QueryClientProvider>
  );
}
