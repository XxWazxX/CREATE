import { createAdminClient } from "@/lib/supabase/admin";
import { signedUrl } from "@/lib/project-share-server";

/**
 * Project cover for emails (Gmail won't load signed Supabase URLs that expire,
 * so the image is proxied through the link). Not password-gated: it only
 * reveals the artwork, never audio. `?track=<id>` gives a prod's own artwork
 * (only for a prod of the shared project).
 */
export async function GET(req: Request, ctx: RouteContext<"/api/p/[token]/cover">) {
  const { token } = await ctx.params;
  const admin = createAdminClient();
  const { data: share } = await admin
    .from("project_shares")
    .select("project_id, expires_at")
    .eq("token", token)
    .maybeSingle();
  if (!share || (share.expires_at && new Date(share.expires_at) <= new Date()))
    return new Response(null, { status: 404 });
  const trackId = new URL(req.url).searchParams.get("track");
  let path: string | null = null;
  if (trackId) {
    if (!/^[0-9a-f-]{36}$/.test(trackId)) return new Response(null, { status: 404 });
    const { data: track } = await admin
      .from("tracks")
      .select("cover_path")
      .eq("id", trackId)
      .eq("project_id", share.project_id)
      .is("deleted_at", null)
      .maybeSingle();
    path = (track?.cover_path as string | null) ?? null;
  } else {
    const { data: project } = await admin
      .from("projects")
      .select("cover_path")
      .eq("id", share.project_id)
      .maybeSingle();
    path = (project?.cover_path as string | null) ?? null;
  }
  if (!path) return new Response(null, { status: 404 });
  const url = await signedUrl(path, 600);
  const img = url ? await fetch(url) : null;
  if (!img?.ok) return new Response(null, { status: 404 });
  return new Response(img.body, {
    headers: {
      "Content-Type": img.headers.get("content-type") ?? "image/jpeg",
      "Cache-Control": "public, max-age=86400",
    },
  });
}
