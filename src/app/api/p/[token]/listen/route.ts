import { cookies } from "next/headers";
import { z } from "zod";
import { classifyRequest } from "@/lib/analytics/classify";
import {
  attributionCookieName,
  hashToken,
  isOwnerRequest,
  readAttribution,
  requestInfo,
  SESSION_TOKEN_RE,
} from "@/lib/analytics/tracking-server";
import { resolveProjectShare } from "@/lib/project-share-server";
import { createAdminClient } from "@/lib/supabase/admin";

const Event = z.object({
  key: z.string().min(1).max(80),
  track: z.uuid(),
  play: z.uuid(),
  type: z.enum(["start", "resume", "progress", "pause", "end"]),
  pos: z.number().min(0).max(86_400),
  listened: z.number().min(0).max(110),
  dur: z.number().min(0).max(86_400).nullable(),
  at: z.number(),
});

const Body = z.object({
  session: z.string().regex(SESSION_TOKEN_RE),
  events: z.array(Event).min(1).max(100),
  now: z.number(),
});

/** Max events stored per listening session (abuse guard). */
const MAX_EVENTS_PER_SESSION = 5000;

const noContent = () => new Response(null, { status: 204 });

/**
 * Player events from a public project page. The link is checked like any
 * other request (exists, not expired, unlocked, streaming allowed), tracks
 * must belong to the project, and identical events are stored once.
 * The owner's own visits and obvious robots are ignored.
 */
export async function POST(req: Request, ctx: RouteContext<"/api/p/[token]/listen">) {
  const { token } = await ctx.params;
  // sendBeacon posts text/plain: parse the raw body.
  const parsed = Body.safeParse(
    await req
      .text()
      .then((t) => JSON.parse(t))
      .catch(() => null),
  );
  if (!parsed.success) return Response.json({ error: "Requête invalide" }, { status: 400 });
  if (classifyRequest({ kind: "listen", ...requestInfo(req) }) === "automated") return noContent();
  if (await isOwnerRequest()) return noContent();

  const r = await resolveProjectShare(token);
  if (r.status !== "ok" || !r.share.allow_streaming) return noContent();
  const { share } = r;
  const admin = createAdminClient();

  const [{ data: owner }, { data: tracks }] = await Promise.all([
    admin.from("project_shares").select("user_id").eq("id", share.id).single(),
    admin.from("tracks").select("id").eq("project_id", share.project_id).is("deleted_at", null),
  ]);
  if (!owner) return noContent();
  const allowed = new Set((tracks ?? []).map((t) => t.id as string));
  const events = parsed.data.events.filter((e) => allowed.has(e.track));
  if (!events.length) return noContent();

  // Session: one per browser tab (random token kept in sessionStorage, hashed here).
  const tokenHash = hashToken(parsed.data.session);
  let { data: session } = await admin
    .from("listening_sessions")
    .select("id, project_share_id")
    .eq("session_token_hash", tokenHash)
    .maybeSingle();
  if (session && session.project_share_id !== share.id)
    return Response.json({ error: "Session invalide" }, { status: 400 });
  if (!session) {
    const jar = await cookies();
    const sendId = readAttribution(share.id, jar.get(attributionCookieName(share.id))?.value);
    // The email must really be one of this link's emails.
    const { data: send } = sendId
      ? await admin.from("email_sends").select("id").eq("id", sendId).eq("project_share_id", share.id).maybeSingle()
      : { data: null };
    const { data: created, error } = await admin
      .from("listening_sessions")
      .upsert(
        {
          user_id: owner.user_id,
          project_share_id: share.id,
          project_id: share.project_id,
          email_send_id: send?.id ?? null,
          source: send ? "email" : "direct",
          session_token_hash: tokenHash,
        },
        { onConflict: "session_token_hash" },
      )
      .select("id, project_share_id")
      .single();
    if (error || !created) {
      console.error("[listen] session", error);
      return noContent();
    }
    session = created;
  } else {
    const { count } = await admin
      .from("listening_events")
      .select("id", { count: "exact", head: true })
      .eq("session_id", session.id);
    if ((count ?? 0) >= MAX_EVENTS_PER_SESSION) return noContent();
  }

  // Dates come from the server; the client only says how old each event is (max 10 min).
  const serverNow = Date.now();
  const rows = events.map((e) => {
    const age = Math.min(600_000, Math.max(0, parsed.data.now - e.at));
    return {
      user_id: owner.user_id,
      session_id: session.id,
      track_id: e.track,
      play_id: e.play,
      event_type: e.type,
      position_seconds: e.pos,
      listened_seconds: e.listened,
      duration_seconds: e.dur,
      occurred_at: new Date(serverNow - age).toISOString(),
      event_idempotency_key: e.key,
    };
  });
  const { error } = await admin
    .from("listening_events")
    .upsert(rows, { onConflict: "session_id,event_idempotency_key", ignoreDuplicates: true });
  if (error) console.error("[listen] events", error);
  await admin
    .from("listening_sessions")
    .update({ last_activity_at: new Date(serverNow).toISOString() })
    .eq("id", session.id);
  return noContent();
}
