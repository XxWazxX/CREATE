import { projectTrackFiles, resolveProjectShare, signedUrl, streamPath } from "@/lib/project-share-server";

/**
 * Audio source of the public player: always a fresh signed URL (the page can stay
 * open for hours), after the same checks as the page (link valid, unlocked,
 * streaming allowed, prod of this project).
 *   ?track=ID            the original upload (MP3 copy only for AIFF)
 *   ?track=ID&v=mp3      the MP3 copy — fallback when a browser can't play the original
 */
export async function GET(req: Request, ctx: RouteContext<"/api/p/[token]/stream">) {
  const { token } = await ctx.params;
  const r = await resolveProjectShare(token).catch(() => ({ status: "not_found" as const }));
  if (r.status !== "ok" || !r.share.allow_streaming) return new Response(null, { status: 404 });

  const url = new URL(req.url);
  const trackId = url.searchParams.get("track");
  const t = (await projectTrackFiles(r.share.project_id)).find((x) => x.id === trackId);
  if (!t) return new Response(null, { status: 404 });

  const path =
    url.searchParams.get("v") === "mp3"
      ? (t.preview_path ?? (t.mime_type === "audio/mpeg" ? t.file_path : null))
      : streamPath(t);
  if (!path) return new Response(null, { status: 404 });
  const signed = await signedUrl(path, 60 * 60 * 3);
  if (!signed) return new Response(null, { status: 502 });
  return new Response(null, {
    status: 302,
    headers: { location: signed, "cache-control": "private, max-age=600", "referrer-policy": "no-referrer" },
  });
}
