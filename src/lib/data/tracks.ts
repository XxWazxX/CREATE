"use client";

import { useQuery } from "@tanstack/react-query";
import { currentUserId, supabase } from "@/lib/supabase/client";
import { BUCKET, paths, removeFiles, removeFolder } from "@/lib/storage";
import type { Activity, Stem, Track, TrackVersion } from "@/lib/types";
import { fileExtension } from "@/lib/utils";
import { getQueryClient, qk } from "./client";

type Row = Record<string, unknown> & { track_tags?: { tag_id: string }[] };

export function mapTrack(row: Row): Track {
  const { track_tags, ...rest } = row;
  const t = rest as unknown as Track;
  return {
    ...t,
    bpm: t.bpm == null ? null : Number(t.bpm),
    file_size: t.file_size == null ? null : Number(t.file_size),
    tag_ids: (track_tags ?? []).map((x) => x.tag_id),
  };
}

function mapVersion(row: Record<string, unknown>): TrackVersion {
  const v = row as unknown as TrackVersion;
  return {
    ...v,
    bpm: v.bpm == null ? null : Number(v.bpm),
    file_size: v.file_size == null ? null : Number(v.file_size),
  };
}

const TRACK_SELECT = "*, track_tags(tag_id)";

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

/** Loads the whole (non-trashed) library index — metadata only, never audio. */
export async function fetchTracks(): Promise<Track[]> {
  const pageSize = 1000;
  const all: Track[] = [];
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await supabase()
      .from("tracks")
      .select(TRACK_SELECT)
      .is("deleted_at", null)
      .order("created_at", { ascending: false })
      .range(from, from + pageSize - 1);
    if (error) throw error;
    all.push(...(data as Row[]).map(mapTrack));
    if (!data || data.length < pageSize) break;
  }
  return all;
}

export function useTracks() {
  return useQuery({ queryKey: qk.tracks, queryFn: fetchTracks, staleTime: 5 * 60_000 });
}

export type TrackDetail = {
  track: Track;
  versions: TrackVersion[];
  stems: Stem[];
  activity: Activity[];
};

export async function fetchTrackDetail(id: string): Promise<TrackDetail> {
  const sb = supabase();
  const [t, v, s, a] = await Promise.all([
    sb.from("tracks").select(TRACK_SELECT).eq("id", id).single(),
    sb.from("track_versions").select("*").eq("track_id", id).order("version_number", { ascending: false }),
    sb.from("stems").select("*").eq("track_id", id).order("position").order("created_at"),
    sb.from("activity").select("*").eq("track_id", id).order("created_at", { ascending: false }).limit(60),
  ]);
  if (t.error) throw t.error;
  for (const r of [v, s, a]) if (r.error) throw r.error;
  return {
    track: mapTrack(t.data as Row),
    versions: (v.data ?? []).map(mapVersion),
    stems: (s.data ?? []) as Stem[],
    activity: (a.data ?? []) as Activity[],
  };
}

export function useTrackDetail(id: string) {
  return useQuery({ queryKey: qk.track(id), queryFn: () => fetchTrackDetail(id) });
}

/** Waveform peaks of a version (cached forever: a version's audio never changes). */
export function usePeaks(versionId: string | null | undefined) {
  return useQuery({
    queryKey: qk.peaks(versionId ?? "none"),
    enabled: !!versionId,
    staleTime: Infinity,
    queryFn: async () => {
      const { data, error } = await supabase().from("track_versions").select("peaks").eq("id", versionId!).single();
      if (error) throw error;
      return (data?.peaks as number[] | null) ?? null;
    },
  });
}

// ---------------------------------------------------------------------------
// Cache helpers (instant UI)
// ---------------------------------------------------------------------------

export function patchTrackCache(id: string, patch: Partial<Track>) {
  const qc = getQueryClient();
  qc.setQueryData<Track[]>(qk.tracks, (list) => list?.map((t) => (t.id === id ? { ...t, ...patch } : t)));
  qc.setQueryData<TrackDetail>(qk.track(id), (d) => (d ? { ...d, track: { ...d.track, ...patch } } : d));
}

export function upsertTrackCache(track: Track) {
  const qc = getQueryClient();
  qc.setQueryData<Track[]>(qk.tracks, (list) => {
    if (!list) return list;
    if (track.deleted_at) return list.filter((t) => t.id !== track.id);
    const i = list.findIndex((t) => t.id === track.id);
    if (i === -1) return [track, ...list];
    const next = list.slice();
    next[i] = track;
    return next;
  });
  qc.setQueryData<TrackDetail>(qk.track(track.id), (d) => (d ? { ...d, track } : d));
}

function removeFromCache(ids: string[]) {
  const set = new Set(ids);
  getQueryClient().setQueryData<Track[]>(qk.tracks, (list) => list?.filter((t) => !set.has(t.id)));
}

export async function refreshTrack(id: string): Promise<Track | null> {
  const { data } = await supabase().from("tracks").select(TRACK_SELECT).eq("id", id).maybeSingle();
  if (!data) return null;
  const t = mapTrack(data as Row);
  upsertTrackCache(t);
  return t;
}

export function invalidateTrack(id: string) {
  return getQueryClient().invalidateQueries({ queryKey: qk.track(id) });
}

// ---------------------------------------------------------------------------
// Mutations
// ---------------------------------------------------------------------------

type EditableTrack = Pick<
  Track,
  "title" | "artist" | "producer" | "bpm" | "key" | "genre" | "notes" | "favorite" | "project_id" | "cover_path"
>;

export async function updateTrack(id: string, patch: Partial<EditableTrack>) {
  const qc = getQueryClient();
  const before = qc.getQueryData<Track[]>(qk.tracks)?.find((t) => t.id === id);
  const now = new Date().toISOString();
  const dbPatch: Partial<Track> = { ...patch };
  if (patch.favorite !== undefined) dbPatch.favorited_at = patch.favorite ? now : null;
  patchTrackCache(id, { ...dbPatch, updated_at: now });
  const { error } = await supabase().from("tracks").update(dbPatch).eq("id", id);
  if (error) {
    if (before) patchTrackCache(id, before);
    throw error;
  }
}

export function toggleFavorite(track: Pick<Track, "id" | "favorite">) {
  return updateTrack(track.id, { favorite: !track.favorite });
}

export async function moveTracks(ids: string[], projectId: string | null) {
  ids.forEach((id) => patchTrackCache(id, { project_id: projectId }));
  const { error } = await supabase().from("tracks").update({ project_id: projectId }).in("id", ids);
  if (error) {
    await getQueryClient().invalidateQueries({ queryKey: qk.tracks });
    throw error;
  }
  void getQueryClient().invalidateQueries({ queryKey: qk.projects });
}

export async function trashTracks(ids: string[]) {
  const qc = getQueryClient();
  const snapshot = qc.getQueryData<Track[]>(qk.tracks);
  removeFromCache(ids);
  const { error } = await supabase().from("tracks").update({ deleted_at: new Date().toISOString() }).in("id", ids);
  if (error) {
    qc.setQueryData(qk.tracks, snapshot);
    throw error;
  }
  void qc.invalidateQueries({ queryKey: qk.trash });
}

export async function restoreTracks(ids: string[]) {
  const { data, error } = await supabase()
    .from("tracks")
    .update({ deleted_at: null })
    .in("id", ids)
    .select(TRACK_SELECT);
  if (error) throw error;
  (data as Row[]).map(mapTrack).forEach(upsertTrackCache);
  void getQueryClient().invalidateQueries({ queryKey: qk.trash });
}

/** Permanently deletes tracks: their audio, previews, stems and covers, then the rows. */
export async function deleteTracksForever(ids: string[]) {
  const uid = await currentUserId();
  const { data: rows } = await supabase().from("tracks").select("id, cover_path").in("id", ids);
  for (const id of ids) {
    await removeFolder(paths.trackFolder(uid, id));
    await removeFolder(paths.stemFolder(uid, id));
  }
  await removeFiles((rows ?? []).map((r) => r.cover_path as string | null));
  const { error } = await supabase().from("tracks").delete().in("id", ids);
  if (error) throw error;
  removeFromCache(ids);
  void getQueryClient().invalidateQueries({ queryKey: qk.trash });
  void getQueryClient().invalidateQueries({ queryKey: qk.storage });
}

export async function recordPlay(id: string) {
  patchTrackCache(id, { last_played_at: new Date().toISOString() });
  await supabase().rpc("record_play", { p_track_id: id });
}

async function copyObject(from: string, to: string) {
  const { error } = await supabase().storage.from(BUCKET).copy(from, to);
  if (error) throw error;
}

/** Duplicates a track (current version, stems, tags, cover) with its own file copies. */
export async function duplicateTrack(id: string, overrides: { project_id?: string | null } = {}): Promise<Track> {
  const sb = supabase();
  const uid = await currentUserId();
  const { track, versions, stems } = await fetchTrackDetail(id);
  const current = versions.find((v) => v.id === track.current_version_id) ?? versions[0];
  if (!current) throw new Error("Ce morceau n'a pas d'audio à dupliquer");

  const newId = crypto.randomUUID();
  const newVersionId = crypto.randomUUID();
  const ext = fileExtension(current.file_path);
  const filePath = paths.version(uid, newId, newVersionId, ext);
  await copyObject(current.file_path, filePath);
  let previewPath: string | null = null;
  if (current.preview_path) {
    previewPath = paths.preview(uid, newId, newVersionId);
    await copyObject(current.preview_path, previewPath);
  }
  let coverPath: string | null = null;
  if (track.cover_path) {
    coverPath = paths.cover(uid, newId);
    await copyObject(track.cover_path, coverPath);
  }

  const { error: tErr } = await sb.from("tracks").insert({
    id: newId,
    title: `${track.title} (copie)`,
    artist: track.artist,
    producer: track.producer,
    bpm: track.bpm,
    key: track.key,
    genre: track.genre,
    notes: track.notes,
    project_id: overrides.project_id !== undefined ? overrides.project_id : track.project_id,
    parent_track_id: track.id,
    cover_path: coverPath,
    status: "ready",
  });
  if (tErr) throw tErr;
  const { error: vErr } = await sb.from("track_versions").insert({
    id: newVersionId,
    track_id: newId,
    version_number: 1,
    label: "V1",
    file_path: filePath,
    preview_path: previewPath,
    original_filename: current.original_filename,
    file_size: current.file_size,
    mime_type: current.mime_type,
    duration: current.duration,
    peaks: current.peaks,
    bpm: current.bpm,
    key: current.key,
    status: "ready",
  });
  if (vErr) throw vErr;
  await sb.from("tracks").update({ current_version_id: newVersionId }).eq("id", newId);

  for (const s of stems) {
    const stemId = crypto.randomUUID();
    const stemPath = paths.stem(uid, newId, stemId, fileExtension(s.file_path));
    await copyObject(s.file_path, stemPath);
    await sb.from("stems").insert({
      id: stemId,
      track_id: newId,
      kind: s.kind,
      name: s.name,
      file_path: stemPath,
      original_filename: s.original_filename,
      file_size: s.file_size,
      mime_type: s.mime_type,
      duration: s.duration,
      position: s.position,
      status: "ready",
    });
  }
  if (track.tag_ids.length) {
    await sb.from("track_tags").insert(track.tag_ids.map((tag_id) => ({ track_id: newId, tag_id })));
  }
  const fresh = await refreshTrack(newId);
  if (!fresh) throw new Error("Échec de la duplication");
  void getQueryClient().invalidateQueries({ queryKey: qk.storage });
  return fresh;
}

export async function setTrackTags(trackId: string, tagIds: string[]) {
  const qc = getQueryClient();
  const before = qc.getQueryData<Track[]>(qk.tracks)?.find((t) => t.id === trackId)?.tag_ids ?? [];
  patchTrackCache(trackId, { tag_ids: tagIds });
  const toAdd = tagIds.filter((t) => !before.includes(t));
  const toRemove = before.filter((t) => !tagIds.includes(t));
  const sb = supabase();
  if (toRemove.length) {
    const { error } = await sb.from("track_tags").delete().eq("track_id", trackId).in("tag_id", toRemove);
    if (error) {
      patchTrackCache(trackId, { tag_ids: before });
      throw error;
    }
  }
  if (toAdd.length) {
    const { error } = await sb.from("track_tags").insert(toAdd.map((tag_id) => ({ track_id: trackId, tag_id })));
    if (error) {
      patchTrackCache(trackId, { tag_ids: before });
      throw error;
    }
  }
}

// ---------------------------------------------------------------------------
// Versions
// ---------------------------------------------------------------------------

export async function setCurrentVersion(trackId: string, versionId: string) {
  const { error } = await supabase().from("tracks").update({ current_version_id: versionId }).eq("id", trackId);
  if (error) throw error;
  await refreshTrack(trackId);
  await invalidateTrack(trackId);
}

export async function updateVersion(versionId: string, trackId: string, patch: { label?: string; notes?: string }) {
  getQueryClient().setQueryData<TrackDetail>(qk.track(trackId), (d) =>
    d ? { ...d, versions: d.versions.map((v) => (v.id === versionId ? { ...v, ...patch } : v)) } : d,
  );
  const { error } = await supabase().from("track_versions").update(patch).eq("id", versionId);
  if (error) {
    await invalidateTrack(trackId);
    throw error;
  }
}

export async function deleteVersion(version: TrackVersion, track: Track) {
  if (version.id === track.current_version_id) throw new Error("Définis d'abord une autre version comme actuelle");
  await removeFiles([version.file_path, version.preview_path]);
  const { error } = await supabase().from("track_versions").delete().eq("id", version.id);
  if (error) throw error;
  await invalidateTrack(track.id);
  void getQueryClient().invalidateQueries({ queryKey: qk.storage });
}

// ---------------------------------------------------------------------------
// Stems
// ---------------------------------------------------------------------------

export async function updateStem(stem: Stem, patch: Partial<Pick<Stem, "kind" | "name" | "position">>) {
  getQueryClient().setQueryData<TrackDetail>(qk.track(stem.track_id), (d) =>
    d ? { ...d, stems: d.stems.map((s) => (s.id === stem.id ? { ...s, ...patch } : s)) } : d,
  );
  const { error } = await supabase().from("stems").update(patch).eq("id", stem.id);
  if (error) {
    await invalidateTrack(stem.track_id);
    throw error;
  }
}

export async function deleteStem(stem: Stem) {
  await removeFiles([stem.file_path]);
  const { error } = await supabase().from("stems").delete().eq("id", stem.id);
  if (error) throw error;
  getQueryClient().setQueryData<TrackDetail>(qk.track(stem.track_id), (d) =>
    d ? { ...d, stems: d.stems.filter((s) => s.id !== stem.id) } : d,
  );
  void getQueryClient().invalidateQueries({ queryKey: qk.storage });
}
