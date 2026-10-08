"use client";

import { QueryClient } from "@tanstack/react-query";

let qc: QueryClient | null = null;

export function getQueryClient() {
  if (!qc) {
    qc = new QueryClient({
      defaultOptions: {
        queries: {
          staleTime: 60_000,
          gcTime: 30 * 60_000,
          refetchOnWindowFocus: false,
          retry: 1,
        },
      },
    });
  }
  return qc;
}

export const qk = {
  tracks: ["tracks"] as const,
  track: (id: string) => ["track", id] as const,
  peaks: (versionId: string) => ["peaks", versionId] as const,
  projects: ["projects"] as const,
  tags: ["tags"] as const,
  trash: ["trash"] as const,
  sends: ["sends"] as const,
  profile: ["profile"] as const,
  projectShares: (projectId: string) => ["project-shares", projectId] as const,
  storage: ["storage"] as const,
};
