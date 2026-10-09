"use client";

import { useQuery } from "@tanstack/react-query";
import { currentUserId, supabase } from "@/lib/supabase/client";
import { paths, removeFiles } from "@/lib/storage";
import type { EmailSend, Profile, Project, Settings, Tag, Track } from "@/lib/types";
import { DEFAULT_SETTINGS } from "@/lib/types";
import { getQueryClient, qk } from "./client";
import { deleteTracksForever, duplicateTrack, mapTrack } from "./tracks";

// ---------------------------------------------------------------------------
// Projects
// ---------------------------------------------------------------------------

export async function fetchProjects(): Promise<Project[]> {
  const { data, error } = await supabase()
    .from("projects")
    .select("*")
    .is("deleted_at", null)
    .order("position")
    .order("name");
  if (error) throw error;
  return data as Project[];
}

export function useProjects() {
  return useQuery({ queryKey: qk.projects, queryFn: fetchProjects, staleTime: 5 * 60_000 });
}

export async function createProject(input: { name: string; kind?: Project["kind"]; parent_id?: string | null }) {
  const { data, error } = await supabase()
    .from("projects")
    .insert({ name: input.name.trim(), kind: input.kind ?? "project", parent_id: input.parent_id ?? null })
    .select("*")
    .single();
  if (error) throw error;
  const p = data as Project;
  getQueryClient().setQueryData<Project[]>(qk.projects, (list) => (list ? [...list, p] : [p]));
  return p;
}

export async function updateProject(
  id: string,
  patch: Partial<Pick<Project, "name" | "parent_id" | "description" | "color" | "kind" | "cover_path">>,
) {
  const qc = getQueryClient();
  const snapshot = qc.getQueryData<Project[]>(qk.projects);
  qc.setQueryData<Project[]>(qk.projects, (list) =>
    list?.map((p) => (p.id === id ? { ...p, ...patch, updated_at: new Date().toISOString() } : p)),
  );
  const { error } = await supabase().from("projects").update(patch).eq("id", id);
  if (error) {
    qc.setQueryData(qk.projects, snapshot);
    throw error;
  }
}

/** Collects a project and all its descendants. */
export function projectSubtree(projects: Project[], rootId: string): Project[] {
  const out: Project[] = [];
  const walk = (id: string) => {
    const p = projects.find((x) => x.id === id);
    if (!p) return;
    out.push(p);
    projects.filter((c) => c.parent_id === id).forEach((c) => walk(c.id));
  };
  walk(rootId);
  return out;
}

export async function trashProject(id: string) {
  const { error } = await supabase().rpc("trash_project", { p_project_id: id });
  if (error) throw error;
  const qc = getQueryClient();
  await Promise.all([
    qc.invalidateQueries({ queryKey: qk.projects }),
    qc.invalidateQueries({ queryKey: qk.tracks }),
    qc.invalidateQueries({ queryKey: qk.trash }),
  ]);
}

export async function restoreProject(id: string) {
  const { error } = await supabase().rpc("restore_project", { p_project_id: id });
  if (error) throw error;
  const qc = getQueryClient();
  await Promise.all([
    qc.invalidateQueries({ queryKey: qk.projects }),
    qc.invalidateQueries({ queryKey: qk.tracks }),
    qc.invalidateQueries({ queryKey: qk.trash }),
  ]);
}

export async function deleteProjectForever(id: string) {
  const sb = supabase();
  // Gather the subtree (trashed projects aren't in the cache, so query).
  const { data: all } = await sb.from("projects").select("*");
  const subtree = projectSubtree((all ?? []) as Project[], id);
  const ids = subtree.map((p) => p.id);
  const { data: tracks } = await sb.from("tracks").select("id").in("project_id", ids).not("deleted_at", "is", null);
  if (tracks?.length) await deleteTracksForever(tracks.map((t) => t.id as string));
  await removeFiles(subtree.map((p) => p.cover_path));
  const { error } = await sb.from("projects").delete().eq("id", id);
  if (error) throw error;
  void getQueryClient().invalidateQueries({ queryKey: qk.trash });
}

/** Duplicates a project, its sub-projects and their tracks (with file copies). */
export async function duplicateProject(id: string): Promise<Project> {
  const projects = getQueryClient().getQueryData<Project[]>(qk.projects) ?? (await fetchProjects());
  const tracks = getQueryClient().getQueryData<Track[]>(qk.tracks) ?? [];
  const source = projects.find((p) => p.id === id);
  if (!source) throw new Error("Projet introuvable");

  const copy = async (p: Project, parentId: string | null, rename: boolean): Promise<Project> => {
    const created = await createProject({
      name: rename ? `${p.name} (copie)` : p.name,
      kind: p.kind,
      parent_id: parentId,
    });
    for (const t of tracks.filter((t) => t.project_id === p.id)) {
      const dup = await duplicateTrack(t.id, { project_id: created.id });
      const { error } = await supabase().from("tracks").update({ title: t.title }).eq("id", dup.id);
      if (!error) dup.title = t.title;
    }
    for (const child of projects.filter((c) => c.parent_id === p.id)) await copy(child, created.id, false);
    return created;
  };
  const result = await copy(source, source.parent_id, true);
  await getQueryClient().invalidateQueries({ queryKey: qk.tracks });
  return result;
}

// ---------------------------------------------------------------------------
// Tags
// ---------------------------------------------------------------------------

export const TAG_COLORS = ["#a1a1aa", "#f59e0b", "#ef4444", "#22c55e", "#3b82f6", "#a855f7", "#ec4899", "#14b8a6"];

export async function fetchTags(): Promise<Tag[]> {
  const { data, error } = await supabase().from("tags").select("*").order("name");
  if (error) throw error;
  return data as Tag[];
}

export function useTags() {
  return useQuery({ queryKey: qk.tags, queryFn: fetchTags, staleTime: 5 * 60_000 });
}

export async function createTag(name: string, color?: string | null): Promise<Tag> {
  const clean = name.trim();
  const existing = getQueryClient()
    .getQueryData<Tag[]>(qk.tags)
    ?.find((t) => t.name.toLowerCase() === clean.toLowerCase());
  if (existing) return existing;
  const { data, error } = await supabase()
    .from("tags")
    .insert({ name: clean, color: color ?? TAG_COLORS[Math.floor(Math.random() * TAG_COLORS.length)] })
    .select("*")
    .single();
  if (error) throw error;
  const tag = data as Tag;
  getQueryClient().setQueryData<Tag[]>(qk.tags, (list) =>
    [...(list ?? []), tag].sort((a, b) => a.name.localeCompare(b.name)),
  );
  return tag;
}

export async function updateTag(id: string, patch: Partial<Pick<Tag, "name" | "color">>) {
  const { error } = await supabase().from("tags").update(patch).eq("id", id);
  if (error) throw error;
  getQueryClient().setQueryData<Tag[]>(qk.tags, (list) => list?.map((t) => (t.id === id ? { ...t, ...patch } : t)));
}

export async function deleteTag(id: string) {
  const { error } = await supabase().from("tags").delete().eq("id", id);
  if (error) throw error;
  const qc = getQueryClient();
  qc.setQueryData<Tag[]>(qk.tags, (list) => list?.filter((t) => t.id !== id));
  qc.setQueryData<Track[]>(qk.tracks, (list) =>
    list?.map((t) => (t.tag_ids.includes(id) ? { ...t, tag_ids: t.tag_ids.filter((x) => x !== id) } : t)),
  );
}

// ---------------------------------------------------------------------------
// Trash
// ---------------------------------------------------------------------------

export function useTrash() {
  return useQuery({
    queryKey: qk.trash,
    queryFn: async () => {
      const sb = supabase();
      const [t, p] = await Promise.all([
        sb
          .from("tracks")
          .select("*, track_tags(tag_id)")
          .not("deleted_at", "is", null)
          .order("deleted_at", { ascending: false }),
        sb.from("projects").select("*").not("deleted_at", "is", null).order("deleted_at", { ascending: false }),
      ]);
      if (t.error) throw t.error;
      if (p.error) throw p.error;
      return { tracks: (t.data ?? []).map(mapTrack), projects: (p.data ?? []) as Project[] };
    },
  });
}

// ---------------------------------------------------------------------------
// Email history
// ---------------------------------------------------------------------------

export function useSends() {
  return useQuery({
    queryKey: qk.sends,
    queryFn: async () => {
      const { data, error } = await supabase()
        .from("email_sends")
        .select(
          "id, track_id, project_id, project_share_id, track_title, recipient, subject, message, status, provider_id, error, created_at, share:project_shares(view_count, play_count, last_viewed_at, token, expires_at)",
        )
        .order("created_at", { ascending: false })
        .limit(500);
      if (error) throw error;
      return (data ?? []) as unknown as EmailSend[];
    },
  });
}

export async function fetchSendHtml(id: string): Promise<string | null> {
  const { data } = await supabase().from("email_sends").select("html").eq("id", id).single();
  return (data?.html as string | null) ?? null;
}

// ---------------------------------------------------------------------------
// Profile / settings
// ---------------------------------------------------------------------------

function mergeSettings(s: Partial<Settings> | null | undefined): Settings {
  return {
    email: { ...DEFAULT_SETTINGS.email, ...(s?.email ?? {}) },
    audio: { ...DEFAULT_SETTINGS.audio, ...(s?.audio ?? {}) },
    appearance: { ...DEFAULT_SETTINGS.appearance, ...(s?.appearance ?? {}) },
    emailDesign: { ...DEFAULT_SETTINGS.emailDesign, ...(s?.emailDesign ?? {}) },
  };
}

export function useProfile() {
  return useQuery({
    queryKey: qk.profile,
    staleTime: Infinity,
    queryFn: async (): Promise<Profile & { email: string }> => {
      const sb = supabase();
      const uid = await currentUserId();
      const [{ data: user }, { data, error }] = await Promise.all([
        sb.auth.getUser(),
        sb.from("profiles").select("*").eq("id", uid).maybeSingle(),
      ]);
      if (error) throw error;
      const row = data ?? (await sb.from("profiles").upsert({ id: uid }).select("*").single()).data;
      return {
        id: uid,
        display_name: row?.display_name ?? null,
        settings: mergeSettings(row?.settings),
        email: user.user?.email ?? "",
      };
    },
  });
}

export async function saveProfile(patch: { display_name?: string | null; settings?: Settings }) {
  const uid = await currentUserId();
  const qc = getQueryClient();
  qc.setQueryData<Profile & { email: string }>(qk.profile, (p) => (p ? { ...p, ...patch } : p));
  const { error } = await supabase().from("profiles").update(patch).eq("id", uid);
  if (error) {
    await qc.invalidateQueries({ queryKey: qk.profile });
    throw error;
  }
}

// ---------------------------------------------------------------------------
// Storage usage
// ---------------------------------------------------------------------------

export function useStorageUsage() {
  return useQuery({
    queryKey: qk.storage,
    queryFn: async () => {
      const sb = supabase();
      const [v, s] = await Promise.all([
        sb.from("track_versions").select("file_size"),
        sb.from("stems").select("file_size"),
      ]);
      const sum = (rows: { file_size: number | null }[] | null) =>
        (rows ?? []).reduce((acc, r) => acc + Number(r.file_size ?? 0), 0);
      return {
        audio: sum(v.data as { file_size: number | null }[]),
        stems: sum(s.data as { file_size: number | null }[]),
        versions: v.data?.length ?? 0,
        stemCount: s.data?.length ?? 0,
      };
    },
  });
}

// ---------------------------------------------------------------------------
// Covers
// ---------------------------------------------------------------------------

/** Resizes an image to a square JPEG (fast lists, small storage). */
export async function resizeCover(file: File, size = 600): Promise<Blob> {
  const bitmap = await createImageBitmap(file);
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d")!;
  const s = Math.min(bitmap.width, bitmap.height);
  ctx.drawImage(bitmap, (bitmap.width - s) / 2, (bitmap.height - s) / 2, s, s, 0, 0, size, size);
  bitmap.close();
  return new Promise((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("Impossible d'encoder l'image"))), "image/jpeg", 0.86),
  );
}

export async function uploadCover(ownerId: string, file: File): Promise<string> {
  const uid = await currentUserId();
  const blob = await resizeCover(file);
  const path = paths.cover(uid, ownerId);
  const { error } = await supabase().storage.from("media").upload(path, blob, {
    contentType: "image/jpeg",
    cacheControl: "31536000",
  });
  if (error) throw error;
  return path;
}

/** Email logo: keeps its proportions and transparency (PNG), at most 600px wide. */
export async function uploadLogo(file: File): Promise<string> {
  const uid = await currentUserId();
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, 600 / bitmap.width);
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext("2d")!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  const blob = await new Promise<Blob>((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("Impossible d'encoder l'image"))), "image/png"),
  );
  const path = paths.logo(uid);
  const { error } = await supabase().storage.from("media").upload(path, blob, {
    contentType: "image/png",
    cacheControl: "31536000",
  });
  if (error) throw error;
  return path;
}
