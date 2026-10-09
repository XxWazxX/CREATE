"use client";

import { useQuery } from "@tanstack/react-query";
import { getQueryClient, qk } from "@/lib/data/client";
import { currentUserId, supabase } from "@/lib/supabase/client";
import { BUCKET, paths, removeFiles, type TrackFolder } from "@/lib/storage";

/** A file the owner put in a track's "Prod" or "Session" folder (straight from storage). */
export type FolderFile = {
  name: string;
  path: string;
  size: number | null;
  mime: string | null;
  created_at: string | null;
};

export async function listTrackFolder(trackId: string, folder: TrackFolder): Promise<FolderFile[]> {
  const prefix = paths.folder(await currentUserId(), trackId, folder);
  const { data, error } = await supabase()
    .storage.from(BUCKET)
    .list(prefix, { limit: 1000, sortBy: { column: "name", order: "asc" } });
  if (error) throw error;
  return (data ?? [])
    .filter((f) => f.id && f.name !== ".emptyFolderPlaceholder")
    .map((f) => ({
      name: f.name,
      path: `${prefix}/${f.name}`,
      size: (f.metadata?.size as number | undefined) ?? null,
      mime: (f.metadata?.mimetype as string | undefined) ?? null,
      created_at: f.created_at ?? null,
    }));
}

export function useTrackFolder(trackId: string, folder: TrackFolder) {
  return useQuery({ queryKey: qk.trackFolder(trackId, folder), queryFn: () => listTrackFolder(trackId, folder) });
}

export async function deleteFolderFile(trackId: string, folder: TrackFolder, file: FolderFile) {
  await removeFiles([file.path]);
  getQueryClient().setQueryData<FolderFile[]>(qk.trackFolder(trackId, folder), (list) =>
    list?.filter((f) => f.path !== file.path),
  );
}
