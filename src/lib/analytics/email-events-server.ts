import "server-only";

import { classifyRequest, dedupeKey, type Origin } from "@/lib/analytics/classify";
import { hashToken, requestInfo, TRACKING_TOKEN_RE } from "@/lib/analytics/tracking-server";
import { createAdminClient } from "@/lib/supabase/admin";

export type TrackedSend = { id: string; user_id: string; project_share_id: string | null; created_at: string };

/** The email behind a tracking token (service role: the token itself is the authorization). */
export async function findTrackedSend(token: string): Promise<TrackedSend | null> {
  if (!TRACKING_TOKEN_RE.test(token)) return null;
  const { data } = await createAdminClient()
    .from("email_sends")
    .select("id, user_id, project_share_id, created_at")
    .eq("tracking_token_hash", hashToken(token))
    .maybeSingle();
  return (data as TrackedSend | null) ?? null;
}

/** Records one open / click (deduplicated per time window). Never throws. */
export async function recordEmailEvent(send: TrackedSend, kind: "open" | "click", req: Request): Promise<Origin> {
  const info = requestInfo(req);
  const now = new Date();
  const origin = classifyRequest({
    kind,
    ...info,
    secondsSinceSend: (now.getTime() - new Date(send.created_at).getTime()) / 1000,
  });
  try {
    await createAdminClient()
      .from("email_events")
      .upsert(
        {
          user_id: send.user_id,
          email_send_id: send.id,
          event_type: kind,
          origin,
          dedupe_key: dedupeKey(kind, origin, now),
          occurred_at: now.toISOString(),
          // Coarse context only (no IP, no full user agent).
          metadata: { method: info.method, via: origin === "proxy" ? "image-proxy" : undefined },
        },
        { onConflict: "email_send_id,event_type,dedupe_key", ignoreDuplicates: true },
      );
  } catch (e) {
    console.error("[tracking] could not record", kind, e);
  }
  return origin;
}
