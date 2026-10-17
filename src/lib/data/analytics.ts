"use client";

import { useQuery } from "@tanstack/react-query";
import type { EmailEventRow, PlayRow, SendRow } from "@/lib/analytics/stats";
import { supabase } from "@/lib/supabase/client";

export type SessionRow = {
  id: string;
  project_share_id: string;
  project_id: string;
  email_send_id: string | null;
  source: "email" | "direct";
  started_at: string;
  last_activity_at: string;
};

export type ListenEventRow = {
  session_id: string;
  track_id: string | null;
  play_id: string;
  event_type: "start" | "resume" | "progress" | "pause" | "end";
  position_seconds: number;
  occurred_at: string;
};

export type ShareRowLite = {
  id: string;
  project_id: string;
  label: string;
  view_count: number;
  created_at: string;
};

export type AnalyticsData = {
  sends: SendRow[];
  emailEvents: EmailEventRow[];
  sessions: SessionRow[];
  plays: PlayRow[];
  /** Most recent player events (timeline), progress excluded. */
  events: ListenEventRow[];
  shares: ShareRowLite[];
};

export const analyticsKey = ["analytics"] as const;

/** Readable message when the analytics migration hasn't been applied yet. */
function analyticsError(e: { code?: string; message?: string }): Error {
  if (
    e.code === "PGRST205" ||
    e.code === "42P01" ||
    e.code === "42703" ||
    /schema cache|does not exist/.test(e.message ?? "")
  ) {
    return new Error(
      "Il manque les tables d’analytics : exécute supabase/migrations/0004_analytics.sql dans Supabase → SQL Editor.",
    );
  }
  return new Error(e.message ?? "Erreur de chargement");
}

/** Reads every row (PostgREST returns 1000 at most per request). */
async function all<T>(
  query: (from: number, to: number) => PromiseLike<{ data: unknown; error: unknown }>,
  cap = 20_000,
) {
  const out: T[] = [];
  for (let from = 0; from < cap; from += 1000) {
    const { data, error } = await query(from, from + 999);
    if (error) throw analyticsError(error as { code?: string; message?: string });
    const rows = (data ?? []) as T[];
    out.push(...rows);
    if (rows.length < 1000) break;
  }
  return out;
}

export async function fetchAnalytics(): Promise<AnalyticsData> {
  const sb = supabase();
  const [sends, emailEvents, sessions, plays, events, shares] = await Promise.all([
    all<SendRow & { tracking_token_hash: string | null }>((a, b) =>
      sb
        .from("email_sends")
        .select(
          "id, recipient, project_id, project_share_id, status, created_at, track_title, options, tracking_token_hash",
        )
        .order("created_at", { ascending: false })
        .range(a, b),
    ),
    all<EmailEventRow>((a, b) =>
      sb.from("email_events").select("email_send_id, event_type, origin, occurred_at").order("occurred_at").range(a, b),
    ),
    all<SessionRow>((a, b) =>
      sb
        .from("listening_sessions")
        .select("id, project_share_id, project_id, email_send_id, source, started_at, last_activity_at")
        .order("started_at", { ascending: false })
        .range(a, b),
    ),
    all<PlayRow>((a, b) =>
      sb.from("listening_plays").select("*").order("started_at", { ascending: false }).range(a, b),
    ),
    all<ListenEventRow>(
      (a, b) =>
        sb
          .from("listening_events")
          .select("session_id, track_id, play_id, event_type, position_seconds, occurred_at")
          .neq("event_type", "progress")
          .order("occurred_at", { ascending: false })
          .range(a, b),
      2000,
    ),
    all<ShareRowLite>((a, b) =>
      sb.from("project_shares").select("id, project_id, label, view_count, created_at").range(a, b),
    ),
  ]);
  return {
    // `tracked`: sent with a tracking token (emails sent before this feature can't report opens).
    sends: sends.map(({ tracking_token_hash, ...s }) => ({ ...s, tracked: !!tracking_token_hash })),
    emailEvents,
    sessions,
    plays: plays.map((p) => ({ ...p, listened_seconds: Number(p.listened_seconds) || 0 })),
    events,
    shares,
  };
}

export function useAnalytics() {
  return useQuery({ queryKey: analyticsKey, queryFn: fetchAnalytics, staleTime: 30_000, retry: false });
}

// ---------------------------------------------------------------------------
// Filters
// ---------------------------------------------------------------------------

export type Period = "7" | "30" | "90" | "all";

export const PERIODS: { id: Period; label: string }[] = [
  { id: "7", label: "7 jours" },
  { id: "30", label: "30 jours" },
  { id: "90", label: "90 jours" },
  { id: "all", label: "Tout" },
];

export function since(period: Period): string | null {
  return period === "all" ? null : new Date(Date.now() - Number(period) * 86_400_000).toISOString();
}

/** Keeps the rows of a period (and optionally one project / one link). */
export function filterAnalytics(
  d: AnalyticsData,
  f: { period: Period; projectId?: string | null; shareId?: string | null; sendIds?: Set<string> | null },
): AnalyticsData {
  const from = since(f.period);
  const inTime = (iso: string) => !from || iso >= from;
  const okShare = (projectId: string | null, shareId: string | null) =>
    (!f.projectId || projectId === f.projectId) && (!f.shareId || shareId === f.shareId);
  const sends = d.sends.filter(
    (s) => inTime(s.created_at) && okShare(s.project_id, s.project_share_id) && (!f.sendIds || f.sendIds.has(s.id)),
  );
  const sendIds = new Set(sends.map((s) => s.id));
  // Sessions of a filtered recipient = those attributed to their emails only.
  const sessions = d.sessions.filter(
    (s) =>
      inTime(s.started_at) &&
      okShare(s.project_id, s.project_share_id) &&
      (!f.sendIds || (s.email_send_id != null && f.sendIds.has(s.email_send_id))),
  );
  const sessionIds = new Set(sessions.map((s) => s.id));
  return {
    sends,
    emailEvents: d.emailEvents.filter((e) => sendIds.has(e.email_send_id) && inTime(e.occurred_at)),
    sessions,
    plays: d.plays.filter((p) => sessionIds.has(p.session_id) && inTime(p.started_at)),
    events: d.events.filter((e) => sessionIds.has(e.session_id) && inTime(e.occurred_at)),
    shares: d.shares.filter(
      (s) => (!f.projectId || s.project_id === f.projectId) && (!f.shareId || s.id === f.shareId),
    ),
  };
}
