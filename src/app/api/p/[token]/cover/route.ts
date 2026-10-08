import { createAdminClient } from "@/lib/supabase/admin";
import { signedUrl } from "@/lib/project-share-server";

/**
 * Project cover for emails (Gmail won't load signed Supabase URLs that expire,
 * so the image is proxied through the link). Not password-gated: it only
 * reveals the artwork, never audio.
 */
export async function GET(_req: Request, ctx: RouteContext<"/api/p/[token]/cover">) {
  const { token } = await ctx.params;
  const admin = createAdminClient();
  const { data: share } = await admin
    .from("project_shares")
    .select("project_id, expires_at")
    .eq("token", token)
    .maybeSingle();
  if (!share || (share.expires_at && new Date(share.expires_at) <= new Date()))
    return new Response(null, { status: 404 });
  const { data: project } = await admin.from("projects").select("cover_path").eq("id", share.project_id).maybeSingle();
  if (!project?.cover_path) return new Response(null, { status: 404 });
  const url = await signedUrl(project.cover_path, 600);
  const img = url ? await fetch(url) : null;
  if (!img?.ok) return new Response(null, { status: 404 });
  return new Response(img.body, {
    headers: {
      "Content-Type": img.headers.get("content-type") ?? "image/jpeg",
      "Cache-Control": "public, max-age=86400",
    },
  });
}
