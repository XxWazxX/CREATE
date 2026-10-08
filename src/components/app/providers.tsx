"use client";

import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "sonner";
import { TooltipProvider } from "@/components/ui/slider";
import { getQueryClient } from "@/lib/data/client";

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <QueryClientProvider client={getQueryClient()}>
      <TooltipProvider delayDuration={400}>
        {children}
        <Toaster
          theme="dark"
          position="bottom-center"
          offset={96}
          mobileOffset={{ bottom: 140 }}
          toastOptions={{
            classNames: {
              toast: "!bg-raised !border-line-strong !text-fg !rounded-xl !shadow-xl",
              description: "!text-muted",
              actionButton: "!bg-accent !text-accent-fg",
            },
          }}
        />
      </TooltipProvider>
    </QueryClientProvider>
  );
}
