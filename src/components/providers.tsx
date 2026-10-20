"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState } from "react";
import { ApiError } from "@/lib/api/client";
import { shouldRetryStatus } from "@/lib/offline/shell-cache";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { toast } from "sonner";

const toastBag = toast as typeof toast & { wrapped?: boolean };
if (!toastBag.wrapped) {
  const success = toast.success.bind(toast);
  toast.success = ((message, options) => {
    toast.dismiss();
    return success(message, options);
  }) as typeof toast.success;
  toastBag.wrapped = true;
}

export function Providers({ children }: { children: React.ReactNode }) {
  const [client] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 15_000,
            gcTime: 5 * 60_000,
            refetchOnWindowFocus: false,
            retry: (failureCount, error) => {
              const status = error instanceof ApiError ? error.status : 0;
              if (!shouldRetryStatus(status)) return false;
              return failureCount < 1;
            },
            networkMode: "offlineFirst",
          },
        },
      }),
  );
  return (
    <QueryClientProvider client={client}>
      <TooltipProvider>
        {children}
        <Toaster position="top-center" />
      </TooltipProvider>
    </QueryClientProvider>
  );
}
