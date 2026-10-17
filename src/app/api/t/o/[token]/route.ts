import { findTrackedSend, recordEmailEvent } from "@/lib/analytics/email-events-server";
import { isOwnerRequest } from "@/lib/analytics/tracking-server";

// 1×1 transparent GIF.
const PIXEL = Uint8Array.from(atob("R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7"), (c) => c.charCodeAt(0));

function pixel() {
  return new Response(PIXEL, {
    headers: {
      "content-type": "image/gif",
      "cache-control": "no-store, no-cache, must-revalidate, private",
      "referrer-policy": "no-referrer",
    },
  });
}

/**
 * Open pixel. Always answers the same image, whatever happens: an unknown
 * token learns nothing. Image proxies (Gmail…) and scanners are labelled.
 */
export async function GET(req: Request, ctx: RouteContext<"/api/t/o/[token]">) {
  const { token } = await ctx.params;
  const send = await findTrackedSend(token.replace(/\.gif$/i, "")).catch(() => null);
  if (send && !(await isOwnerRequest())) await recordEmailEvent(send, "open", req);
  return pixel();
}
