import { createAdminClient } from "@/lib/supabase/admin";
import { signedUrl } from "@/lib/project-share-server";

/**
 * Sender logo for emails (Settings → E-mail → Design), proxied through the link
 * like the cover: email clients can't load expiring signed URLs. Only serves an
 * image from the link owner's own brand/ folder.
 */
export async function GET(_req: Request, ctx: RouteContext<"/api/p/[token]/logo">) {
  const { token } = await ctx.params;
  const admin = createAdminClient();
  const { data: share } = await admin
    .from("project_shares")
    .select("project_id, expires_at")
    .eq("token", token)
    .maybeSingle();
  if (!share || (share.expires_at && new Date(share.expires_at) <= new Date()))
    return new Response(null, { status: 404 });
  const { data: project } = await admin.from("projects").select("user_id").eq("id", share.project_id).maybeSingle();
  if (!project) return new Response(null, { status: 404 });
  const { data: profile } = await admin.from("profiles").select("settings").eq("id", project.user_id).maybeSingle();
  const logoPath = (profile?.settings as { emailDesign?: { logoPath?: unknown } } | null)?.emailDesign?.logoPath;
  if (typeof logoPath !== "string" || !logoPath.startsWith(`users/${project.user_id}/brand/`))
    return new Response(null, { status: 404 });
  const url = await signedUrl(logoPath, 600);
  const img = url ? await fetch(url) : null;
  if (!img?.ok) return new Response(null, { status: 404 });
  return new Response(img.body, {
    headers: {
      "Content-Type": img.headers.get("content-type") ?? "image/png",
      "Cache-Control": "public, max-age=86400",
    },
  });
}
