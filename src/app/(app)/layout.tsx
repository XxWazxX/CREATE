import { Suspense } from "react";
import { AppShell } from "@/components/app/app-shell";

// No login screen: src/proxy.ts signs the owner in automatically (server-side),
// and Row Level Security still scopes every query to that account.
export default function AppLayout({ children }: LayoutProps<"/">) {
  // The shell reads the URL (active nav, drop target project). On dynamic
  // routes that is only known at request time, so it streams in behind a
  // skeleton of the same shape; static routes are fully prerendered.
  return (
    <Suspense fallback={<ShellSkeleton />}>
      <AppShell>{children}</AppShell>
    </Suspense>
  );
}

function ShellSkeleton() {
  return (
    <div className="flex h-dvh">
      <div className="border-line bg-panel hidden w-60 shrink-0 border-r md:block" />
      <div className="flex-1" />
    </div>
  );
}
