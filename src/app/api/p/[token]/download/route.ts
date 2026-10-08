import { createAdminClient } from "@/lib/supabase/admin";
import {
  isLosslessMime,
  projectTrackFiles,
  resolveProjectShare,
  shareHit,
  signedUrl,
  type ShareTrackFiles,
} from "@/lib/project-share-server";

function safe(name: string) {
  return name.replace(/[\\/:*?"<>|]+/g, "-").trim() || "track";
}

function ext(name: string | null | undefined, fallback: string) {
  const m = name?.match(/\.([a-z0-9]+)$/i);
  return m ? m[1].toLowerCase() : fallback;
}

/** Which file serves "MP3" for a track (MP3 preview, or an MP3 original). */
function mp3Path(t: ShareTrackFiles) {
  return t.preview_path ?? (t.mime_type === "audio/mpeg" ? t.file_path : null);
}

type ZipEntry = { name: string; path: string };

/**
 * Multi-file downloads are zipped in the visitor's browser: the server only
 * returns short-lived signed URLs for the files this link is allowed to give
 * (one Supabase round-trip, no heavy CPU work in the Worker).
 */
async function zipManifest(zipName: string, entries: ZipEntry[]) {
  const admin = createAdminClient();
  const { data, error } = await admin.storage.from("media").createSignedUrls(
    entries.map((e) => e.path),
    600,
  );
  if (error) return new Response("Fichiers indisponibles", { status: 500 });
  const files = entries
    .map((e, i) => ({ name: e.name, url: data?.[i]?.signedUrl ?? null }))
    .filter((f): f is { name: string; url: string } => !!f.url);
  return Response.json({ zipName, files }, { headers: { "Cache-Control": "private, no-store" } });
}

/**
 * Permission-checked downloads for a project link.
 *   ?kind=mp3|wav&track=ID   one track
 *   ?kind=stems&track=ID     ZIP manifest of a track's stems
 *   ?kind=all-mp3|all-wav    ZIP manifest of the whole project ("01 - Title.mp3")
 *   ?kind=all-stems          ZIP manifest of every stem, one folder per track
 * Single files redirect to a signed URL; ZIP kinds return JSON (zipped client-side).
 */
export async function GET(req: Request, ctx: RouteContext<"/api/p/[token]/download">) {
  const { token } = await ctx.params;
  const r = await resolveProjectShare(token).catch(() => ({ status: "not_found" as const }));
  if (r.status === "expired") return new Response("Ce lien de partage a expiré.", { status: 410 });
  if (r.status === "locked") return new Response("Ce projet est protégé par un mot de passe.", { status: 401 });
  if (r.status !== "ok") return new Response("Ce lien n'est plus disponible.", { status: 404 });
  const { share, project } = r;

  const url = new URL(req.url);
  const kind = url.searchParams.get("kind") ?? "";
  const trackId = url.searchParams.get("track");
  const tracks = await projectTrackFiles(share.project_id);
  const pad = (i: number) => String(i + 1).padStart(2, "0");
  const forbidden = (what: string) =>
    new Response(`Le téléchargement ${what} n'est pas autorisé pour ce lien.`, { status: 403 });

  const needs = kind.endsWith("mp3") ? "mp3" : kind.endsWith("wav") ? "wav" : kind.endsWith("stems") ? "stems" : null;
  if (needs === "mp3" && !share.allow_mp3_download) return forbidden("MP3");
  if (needs === "wav" && !share.allow_wav_download) return forbidden("WAV");
  if (needs === "stems" && !share.allow_stems_download) return forbidden("des stems");
  if (!needs) return new Response("Type de téléchargement inconnu", { status: 400 });

  if (kind === "mp3" || kind === "wav" || kind === "stems") {
    const index = tracks.findIndex((t) => t.id === trackId);
    const t = tracks[index];
    if (!t) return new Response("Morceau introuvable", { status: 404 });
    const base = `${pad(index)} - ${safe(t.title)}`;
    if (kind === "mp3") {
      const path = mp3Path(t);
      if (!path) return new Response("Pas de MP3 pour ce morceau.", { status: 404 });
      const u = await signedUrl(path, 300, `${base}.mp3`);
      if (!u) return new Response("Introuvable", { status: 404 });
      await shareHit(share.id, "download");
      return Response.redirect(u, 302);
    }
    if (kind === "wav") {
      if (!isLosslessMime(t.mime_type)) return new Response("Pas de WAV pour ce morceau.", { status: 404 });
      const u = await signedUrl(t.file_path, 300, `${base}.${ext(t.original_filename, "wav")}`);
      if (!u) return new Response("Introuvable", { status: 404 });
      await shareHit(share.id, "download");
      return Response.redirect(u, 302);
    }
    if (!t.stems.length) return new Response("Aucun stem pour ce morceau.", { status: 404 });
    await shareHit(share.id, "download");
    return zipManifest(
      `${base} - Stems.zip`,
      t.stems.map((s) => ({
        name: `${safe(s.name)}.${ext(s.original_filename ?? s.file_path, "wav")}`,
        path: s.file_path,
      })),
    );
  }

  // Whole project
  const entries: ZipEntry[] = [];
  tracks.forEach((t, i) => {
    if (kind === "all-mp3") {
      const path = mp3Path(t);
      if (path) entries.push({ name: `${pad(i)} - ${safe(t.title)}.mp3`, path });
    } else if (kind === "all-wav") {
      if (isLosslessMime(t.mime_type))
        entries.push({ name: `${pad(i)} - ${safe(t.title)}.${ext(t.original_filename, "wav")}`, path: t.file_path });
    } else if (kind === "all-stems") {
      for (const s of t.stems)
        entries.push({
          name: `${pad(i)} - ${safe(t.title)}/${safe(s.name)}.${ext(s.original_filename ?? s.file_path, "wav")}`,
          path: s.file_path,
        });
    }
  });
  if (!entries.length) return new Response("Rien à télécharger.", { status: 404 });
  await shareHit(share.id, "download");
  const suffix = kind === "all-wav" ? " (WAV)" : kind === "all-stems" ? " - Stems" : "";
  return zipManifest(`${safe(project.name)}${suffix}.zip`, entries);
}
