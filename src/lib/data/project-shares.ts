"use client";

import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase/client";
import type { ProjectShare, ProjectSharePermissions } from "@/lib/types";
import { getQueryClient, qk } from "./client";

const COLUMNS =
  "id, project_id, token, label, allow_streaming, allow_mp3_download, allow_wav_download, allow_stems_download, expires_at, view_count, play_count, download_count, last_viewed_at, created_at, updated_at, password_hash";

function shape(row: Record<string, unknown>): ProjectShare {
  const { password_hash, ...rest } = row;
  return { ...(rest as Omit<ProjectShare, "has_password">), has_password: !!password_hash };
}

export function useProjectShares(projectId: string | null) {
  return useQuery({
    queryKey: qk.projectShares(projectId ?? "none"),
    enabled: !!projectId,
    queryFn: async () => {
      const { data, error } = await supabase()
        .from("project_shares")
        .select(COLUMNS)
        .eq("project_id", projectId!)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []).map(shape);
    },
  });
}

export type ShareForm = ProjectSharePermissions & {
  label: string;
  expires_at: string | null;
  /** undefined = unchanged, null = remove, string = set */
  password?: string | null;
};

async function call(url: string, method: string, body: unknown): Promise<ProjectShare> {
  const res = await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((json as { error?: string }).error ?? `Erreur ${res.status}`);
  return json as ProjectShare;
}

/** Created server-side: secure token + hashed password never touch the browser in clear. */
export async function createProjectShare(projectId: string, form: ShareForm) {
  const share = await call("/api/project-shares", "POST", { projectId, ...form });
  getQueryClient().setQueryData<ProjectShare[]>(qk.projectShares(projectId), (l) => [share, ...(l ?? [])]);
  return share;
}

export async function updateProjectShare(share: ProjectShare, form: Partial<ShareForm>) {
  const updated = await call(`/api/project-shares/${share.id}`, "PATCH", form);
  getQueryClient().setQueryData<ProjectShare[]>(qk.projectShares(share.project_id), (l) =>
    l?.map((s) => (s.id === share.id ? updated : s)),
  );
  return updated;
}

export async function deleteProjectShare(share: ProjectShare) {
  const { error } = await supabase().from("project_shares").delete().eq("id", share.id);
  if (error) throw error;
  getQueryClient().setQueryData<ProjectShare[]>(qk.projectShares(share.project_id), (l) =>
    l?.filter((s) => s.id !== share.id),
  );
}

const LOCAL_HOST = /^(localhost|127\.0\.0\.1|\[::1\])$/;

/**
 * Public link for a share. Online, always the address the app is served from
 * (works with workers.dev and any custom domain). From the local app, the
 * public address (NEXT_PUBLIC_APP_URL) so copied links work for recipients.
 */
export function projectShareUrl(token: string) {
  const origin = typeof window !== "undefined" ? window.location.origin : "";
  const isLocal = typeof window !== "undefined" && LOCAL_HOST.test(window.location.hostname);
  const base = (isLocal && process.env.NEXT_PUBLIC_APP_URL) || origin || process.env.NEXT_PUBLIC_APP_URL || "";
  return `${base.replace(/\/$/, "")}/p/${token}`;
}

export function isExpired(share: Pick<ProjectShare, "expires_at">) {
  return !!share.expires_at && new Date(share.expires_at) <= new Date();
}
