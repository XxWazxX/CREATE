import { resolveProjectShare, shareHit } from "@/lib/project-share-server";

/** Counts a listen (called once per track per visit by the public player). */
export async function POST(_req: Request, ctx: RouteContext<"/api/p/[token]/play">) {
  const { token } = await ctx.params;
  const r = await resolveProjectShare(token);
  if (r.status !== "ok" || !r.share.allow_streaming) return new Response(null, { status: 204 });
  await shareHit(r.share.id, "play");
  return new Response(null, { status: 204 });
}
