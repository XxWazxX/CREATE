"use client";

import { toast } from "sonner";
import { create } from "zustand";
import { processAudio } from "@/lib/audio/process";
import { probeDuration } from "@/lib/audio/decode";
import { getQueryClient, qk } from "@/lib/data/client";
import { invalidateTrack, mapTrack, patchTrackCache, refreshTrack, upsertTrackCache } from "@/lib/data/tracks";
import { normalizeKey, guessStemKind, type StemKind } from "@/lib/music";
import { currentUserId, supabase } from "@/lib/supabase/client";
import { BUCKET, paths } from "@/lib/storage";
import { audioMime, errorMessage, fileExtension, isAudioFile, isLossless, titleFromFilename } from "@/lib/utils";
import { parseFilenameMeta } from "@/lib/filename-meta";
import { tusUpload } from "./tus";

export type UploadStage = "queued" | "uploading" | "processing" | "done" | "error" | "cancelled";

export type UploadJob = {
  id: string;
  kind: "track" | "version" | "stem";
  name: string;
  trackId: string;
  progress: number;
  stage: UploadStage;
  detail?: string;
  error?: string;
  abort?: () => void;
};

type UploadState = {
  jobs: UploadJob[];
  update: (id: string, patch: Partial<UploadJob>) => void;
  add: (job: UploadJob) => void;
  clearFinished: () => void;
};

export const useUploads = create<UploadState>((set) => ({
  jobs: [],
  add: (job) => set((s) => ({ jobs: [...s.jobs, job] })),
  update: (id, patch) => set((s) => ({ jobs: s.jobs.map((j) => (j.id === id ? { ...j, ...patch } : j)) })),
  clearFinished: () =>
    set((s) => ({ jobs: s.jobs.filter((j) => j.stage !== "done" && j.stage !== "error" && j.stage !== "cancelled") })),
}));

const jobs = () => useUploads.getState();

// Two concurrent network uploads; analysis is serialized inside processAudio.
const MAX_CONCURRENT = 2;
let active = 0;
const queue: (() => Promise<void>)[] = [];

function schedule(task: () => Promise<void>) {
  queue.push(task);
  pump();
}

function pump() {
  while (active < MAX_CONCURRENT && queue.length) {
    const task = queue.shift()!;
    active++;
    task().finally(() => {
      active--;
      pump();
    });
  }
}

if (typeof window !== "undefined") {
  window.addEventListener("beforeunload", (e) => {
    if (jobs().jobs.some((j) => j.stage === "uploading" || j.stage === "queued")) e.preventDefault();
  });
}

// ---------------------------------------------------------------------------
// Shared: upload original + analysis + MP3 preview for a version
// ---------------------------------------------------------------------------

async function uploadVersionAudio(opts: {
  jobId: string;
  file: File;
  uid: string;
  trackId: string;
  versionId: string;
  filePath: string;
  mime: string;
  applyToTrack: boolean;
}) {
  const { jobId, file, uid, trackId, versionId, filePath, mime, applyToTrack } = opts;
  // BPM / key written in the file name win; audio detection only fills what the name doesn't say.
  const fromName = parseFilenameMeta(file.name);
  const sb = supabase();
  const wantPreview = isLossless(mime);

  const handle = tusUpload(file, filePath, mime, (p) => jobs().update(jobId, { progress: p }));
  jobs().update(jobId, { stage: "uploading", abort: handle.abort });

  // Analysis runs while bytes are on the wire.
  const analysisPromise = processAudio(file, {
    encodeMp3: wantPreview,
    onAnalysis: async (r) => {
      const versionPatch: Record<string, unknown> = {
        duration: r.duration,
        peaks: r.peaks,
        bpm: fromName.bpm ?? r.bpm,
        key: fromName.key ?? r.key,
      };
      await sb.from("track_versions").update(versionPatch).eq("id", versionId);
      getQueryClient().setQueryData(qk.peaks(versionId), r.peaks);
      if (applyToTrack) {
        const { data: t } = await sb.from("tracks").select("bpm, key").eq("id", trackId).single();
        const trackPatch: Record<string, unknown> = {};
        if (t && t.bpm == null && r.bpm) trackPatch.bpm = r.bpm;
        if (t && !t.key && r.key) trackPatch.key = normalizeKey(r.key);
        if (Object.keys(trackPatch).length) await sb.from("tracks").update(trackPatch).eq("id", trackId);
      }
      await refreshTrack(trackId);
    },
    onMp3Progress: (p) => jobs().update(jobId, { detail: `Encodage de l'aperçu ${Math.round(p * 100)} %` }),
  });

  try {
    await handle.promise;
  } catch (e) {
    await sb.from("track_versions").update({ status: "error" }).eq("id", versionId);
    await refreshTrack(trackId);
    throw e;
  }

  jobs().update(jobId, { stage: "processing", progress: 1, abort: undefined, detail: "Analyse" });
  // The original is uploaded: playable right away (except AIFF in some browsers).
  await sb
    .from("track_versions")
    .update({ status: wantPreview ? "processing" : "ready" })
    .eq("id", versionId);
  await refreshTrack(trackId);

  const result = await analysisPromise;
  if (!result.analysis) {
    const duration = await probeDuration(file);
    if (duration) await sb.from("track_versions").update({ duration }).eq("id", versionId);
  }
  if (result.mp3) {
    jobs().update(jobId, { detail: "Envoi de l'aperçu" });
    const previewPath = paths.preview(uid, trackId, versionId);
    const { error } = await sb.storage.from(BUCKET).upload(previewPath, result.mp3, {
      contentType: "audio/mpeg",
      cacheControl: "31536000",
      upsert: true,
    });
    if (!error) await sb.from("track_versions").update({ preview_path: previewPath }).eq("id", versionId);
  }
  await sb.from("track_versions").update({ status: "ready" }).eq("id", versionId);
  await refreshTrack(trackId);
  return result;
}

// ---------------------------------------------------------------------------
// New tracks
// ---------------------------------------------------------------------------

export async function importFiles(files: File[], opts: { projectId?: string | null } = {}) {
  const audio = files.filter(isAudioFile);
  const skipped = files.length - audio.length;
  if (skipped) toast.error(`${skipped} fichier${skipped > 1 ? "s ignorés" : " ignoré"} (pas de l'audio)`);
  if (!audio.length) return [];

  const uid = await currentUserId();
  const sb = supabase();
  const created: string[] = [];

  // Create every row first so all files appear in the library instantly.
  for (const file of audio) {
    const trackId = crypto.randomUUID();
    const versionId = crypto.randomUUID();
    const ext = fileExtension(file.name);
    const mime = audioMime(file);
    const filePath = paths.version(uid, trackId, versionId, ext);
    const jobId = trackId;
    jobs().add({ id: jobId, kind: "track", name: file.name, trackId, progress: 0, stage: "queued" });

    const meta = parseFilenameMeta(file.name);
    const { data, error } = await sb.rpc("create_track", {
      p_track_id: trackId,
      p_version_id: versionId,
      p_title: meta.title || titleFromFilename(file.name),
      p_file_path: filePath,
      p_original_filename: file.name,
      p_file_size: file.size,
      p_mime_type: mime,
      p_project_id: opts.projectId ?? null,
    });
    if (error) {
      jobs().update(jobId, { stage: "error", error: error.message });
      toast.error(`Impossible d'importer ${file.name}`, { description: error.message });
      continue;
    }
    let row = data as Record<string, unknown>;
    if (meta.bpm != null || meta.key) {
      const patch = { bpm: meta.bpm, key: meta.key };
      const { data: updated } = await sb.from("tracks").update(patch).eq("id", trackId).select("*").single();
      await sb.from("track_versions").update(patch).eq("id", versionId);
      if (updated) row = updated as Record<string, unknown>;
    }
    upsertTrackCache(mapTrack({ ...row, track_tags: [] }));
    created.push(trackId);

    schedule(async () => {
      if (jobs().jobs.find((j) => j.id === jobId)?.stage === "cancelled") return;
      try {
        await uploadVersionAudio({ jobId, file, uid, trackId, versionId, filePath, mime, applyToTrack: true });
        jobs().update(jobId, { stage: "done", detail: undefined });
      } catch (e) {
        const msg = errorMessage(e);
        jobs().update(jobId, { stage: msg === "Import annulé" ? "cancelled" : "error", error: msg });
        if (msg !== "Import annulé") toast.error(`Échec de l'import : ${file.name}`, { description: msg });
      } finally {
        void getQueryClient().invalidateQueries({ queryKey: qk.storage });
      }
    });
  }
  if (opts.projectId) void getQueryClient().invalidateQueries({ queryKey: qk.projects });
  return created;
}

// ---------------------------------------------------------------------------
// New version of an existing track
// ---------------------------------------------------------------------------

export async function uploadNewVersion(trackId: string, file: File, label?: string) {
  if (!isAudioFile(file)) throw new Error("Ce n'est pas un fichier audio");
  const uid = await currentUserId();
  const versionId = crypto.randomUUID();
  const mime = audioMime(file);
  const filePath = paths.version(uid, trackId, versionId, fileExtension(file.name));
  const jobId = versionId;
  jobs().add({ id: jobId, kind: "version", name: file.name, trackId, progress: 0, stage: "queued" });

  const { error } = await supabase().rpc("add_track_version", {
    p_track_id: trackId,
    p_version_id: versionId,
    p_file_path: filePath,
    p_original_filename: file.name,
    p_file_size: file.size,
    p_mime_type: mime,
    p_label: label ?? null,
  });
  if (error) {
    jobs().update(jobId, { stage: "error", error: error.message });
    throw error;
  }
  await refreshTrack(trackId);
  await invalidateTrack(trackId);

  schedule(async () => {
    try {
      await uploadVersionAudio({ jobId, file, uid, trackId, versionId, filePath, mime, applyToTrack: false });
      jobs().update(jobId, { stage: "done", detail: undefined });
    } catch (e) {
      jobs().update(jobId, { stage: "error", error: errorMessage(e) });
      toast.error(`Échec de l'import : ${file.name}`, { description: errorMessage(e) });
    } finally {
      await invalidateTrack(trackId);
      void getQueryClient().invalidateQueries({ queryKey: qk.storage });
    }
  });
}

// ---------------------------------------------------------------------------
// Stems
// ---------------------------------------------------------------------------

export async function uploadStems(trackId: string, files: File[], versionId: string | null) {
  const audio = files.filter(isAudioFile);
  if (!audio.length) throw new Error("Aucun fichier audio");
  const uid = await currentUserId();
  const sb = supabase();
  const { count } = await sb.from("stems").select("id", { count: "exact", head: true }).eq("track_id", trackId);
  let position = count ?? 0;

  for (const file of audio) {
    const stemId = crypto.randomUUID();
    const mime = audioMime(file);
    const filePath = paths.stem(uid, trackId, stemId, fileExtension(file.name));
    const kind: StemKind = guessStemKind(file.name);
    jobs().add({ id: stemId, kind: "stem", name: file.name, trackId, progress: 0, stage: "queued" });
    const { error } = await sb.from("stems").insert({
      id: stemId,
      track_id: trackId,
      version_id: versionId,
      kind,
      name: titleFromFilename(file.name),
      file_path: filePath,
      original_filename: file.name,
      file_size: file.size,
      mime_type: mime,
      position: position++,
      status: "uploading",
    });
    if (error) {
      jobs().update(stemId, { stage: "error", error: error.message });
      continue;
    }
    schedule(async () => {
      try {
        const handle = tusUpload(file, filePath, mime, (p) => jobs().update(stemId, { progress: p }));
        jobs().update(stemId, { stage: "uploading", abort: handle.abort });
        const durationPromise = probeDuration(file);
        await handle.promise;
        const duration = await durationPromise;
        await sb.from("stems").update({ status: "ready", duration }).eq("id", stemId);
        jobs().update(stemId, { stage: "done", progress: 1, abort: undefined });
      } catch (e) {
        await sb.from("stems").update({ status: "error" }).eq("id", stemId);
        jobs().update(stemId, { stage: "error", error: errorMessage(e) });
      } finally {
        await invalidateTrack(trackId);
        void getQueryClient().invalidateQueries({ queryKey: qk.storage });
      }
    });
  }
  await invalidateTrack(trackId);
}

/** Re-runs BPM / key detection for an existing track from its stored audio. */
export async function redetect(trackId: string, filePath: string, versionId: string) {
  const sb = supabase();
  const { data, error } = await sb.storage.from(BUCKET).download(filePath);
  if (error || !data) throw error ?? new Error("Échec du téléchargement");
  const file = new File([data], filePath.split("/").pop() ?? "audio");
  const result = await processAudio(file, { encodeMp3: false });
  if (!result.analysis) throw new Error(result.error ?? "Échec de l'analyse");
  const { bpm, key, duration, peaks } = result.analysis;
  await sb.from("track_versions").update({ bpm, key, duration, peaks }).eq("id", versionId);
  getQueryClient().setQueryData(qk.peaks(versionId), peaks);
  const patch: Record<string, unknown> = {};
  if (bpm) patch.bpm = bpm;
  if (key) patch.key = normalizeKey(key);
  if (Object.keys(patch).length) {
    patchTrackCache(trackId, patch);
    await sb.from("tracks").update(patch).eq("id", trackId);
  }
  await invalidateTrack(trackId);
  return result.analysis;
}
