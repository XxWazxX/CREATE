import { NextResponse } from "next/server";
import { findTrackedSend, recordEmailEvent } from "@/lib/analytics/email-events-server";
import {
  ATTRIBUTION_MAX_AGE,
  attributionCookieName,
  attributionValue,
  isOwnerRequest,
} from "@/lib/analytics/tracking-server";
import { createAdminClient } from "@/lib/supabase/admin";

function gone() {
  return new Response("Ce lien n’est plus disponible.", {
    status: 404,
    headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" },
  });
}

/**
 * Tracked "Écouter le projet" link from an email: records the click, then
 * redirects to the public project page. The URL only holds a random token.
 * A real click also leaves a signed cookie so the listens that follow are tied
 * to this email; scanners and link previews never get it.
 */
async function handle(req: Request, ctx: RouteContext<"/l/[token]">) {
  const { token } = await ctx.params;
  const send = await findTrackedSend(token).catch(() => null);
  if (!send?.project_share_id) return gone();
  const { data: share } = await createAdminClient()
    .from("project_shares")
    .select("id, token")
    .eq("id", send.project_share_id)
    .maybeSingle();
  if (!share) return gone();

  const res = NextResponse.redirect(new URL(`/p/${share.token}`, req.url), 302);
  res.headers.set("cache-control", "no-store");
  res.headers.set("referrer-policy", "no-referrer");
  if (!(await isOwnerRequest())) {
    const origin = await recordEmailEvent(send, "click", req);
    if (origin !== "automated" && req.method === "GET") {
      res.cookies.set(attributionCookieName(share.id), attributionValue(share.id, send.id), {
        httpOnly: true,
        sameSite: "lax",
        secure: process.env.NODE_ENV === "production",
        path: "/",
        maxAge: ATTRIBUTION_MAX_AGE,
      });
    }
  }
  return res;
}

export const GET = handle;
export const HEAD = handle;
