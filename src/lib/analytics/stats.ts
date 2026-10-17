/**
 * Analytics figures, computed only from recorded events (no estimate is ever
 * invented: no events → zeros and "aucune donnée"). Pure functions.
 */

export type PlayRow = {
  play_id: string;
  session_id: string;
  track_id: string | null;
  project_id: string;
  project_share_id: string;
  email_send_id: string | null;
  source: "email" | "direct";
  started_at: string;
  last_event_at: string;
  started: boolean;
  reached_end: boolean;
  duration_seconds: number | null;
  max_position_seconds: number | null;
  listened_seconds: number;
};

export type EmailEventRow = {
  email_send_id: string;
  event_type: "open" | "click";
  origin: "human" | "proxy" | "automated";
  occurred_at: string;
};

export type SendRow = {
  id: string;
  recipient: string;
  project_id: string | null;
  project_share_id: string | null;
  status: "queued" | "sent" | "failed";
  created_at: string;
  track_title: string;
  options?: { artist_name?: string | null } | null;
  tracked?: boolean;
};

/** Qualified listen: ≥ 30 s actually played, or half the track when it lasts under a minute. */
export function isQualified(listened: number, duration: number | null): boolean {
  const need = duration && duration > 0 && duration < 60 ? duration / 2 : 30;
  return listened >= need;
}

/** Complete listen: ≥ 90 % of the track actually played. */
export function isComplete(listened: number, duration: number | null): boolean {
  return !!duration && duration > 0 && listened >= 0.9 * duration;
}

/** A play counts as a start when playback really began. */
export const isStart = (p: PlayRow) => p.started || p.listened_seconds > 0;

export function completion(p: PlayRow): number | null {
  if (!p.duration_seconds || p.duration_seconds <= 0) return null;
  return Math.min(1, p.listened_seconds / p.duration_seconds);
}

export type ListenSummary = {
  starts: number;
  qualified: number;
  complete: number;
  listenedSeconds: number;
  /** Distinct listening sessions (browser tabs) with at least one start. */
  sessions: number;
  /** Starts beyond the first one for the same track in the same session (loops, replays). */
  repeats: number;
  /** Mean share of the track played, over plays with a known duration. */
  avgCompletion: number | null;
  lastActivity: string | null;
};

export function summarizePlays(plays: PlayRow[]): ListenSummary {
  const started = plays.filter(isStart);
  const pairs = new Set(started.map((p) => `${p.session_id}:${p.track_id}`));
  const ratios = started.map(completion).filter((x): x is number => x != null);
  return {
    starts: started.length,
    qualified: started.filter((p) => isQualified(p.listened_seconds, p.duration_seconds)).length,
    complete: started.filter((p) => isComplete(p.listened_seconds, p.duration_seconds)).length,
    listenedSeconds: started.reduce((s, p) => s + p.listened_seconds, 0),
    sessions: new Set(started.map((p) => p.session_id)).size,
    repeats: started.length - pairs.size,
    avgCompletion: ratios.length ? ratios.reduce((a, b) => a + b, 0) / ratios.length : null,
    lastActivity: plays.reduce<string | null>((m, p) => (!m || p.last_event_at > m ? p.last_event_at : m), null),
  };
}

export type TrackStats = ListenSummary & { trackId: string };

/** Per-track figures, most qualified listens first (then listened time). */
export function perTrack(plays: PlayRow[]): TrackStats[] {
  const by = new Map<string, PlayRow[]>();
  for (const p of plays) {
    if (!p.track_id) continue;
    by.set(p.track_id, [...(by.get(p.track_id) ?? []), p]);
  }
  return [...by]
    .map(([trackId, list]) => ({ trackId, ...summarizePlays(list) }))
    .filter((t) => t.starts > 0)
    .sort((a, b) => b.qualified - a.qualified || b.listenedSeconds - a.listenedSeconds);
}

export type SendStats = {
  opens: number;
  firstOpen: string | null;
  lastOpen: string | null;
  clicks: number;
  lastClick: string | null;
  automatedClicks: number;
  automatedOpens: number;
};

/** Opens / clicks of one email. Automated events (scanners, previews) are counted apart. */
export function sendStats(events: EmailEventRow[]): SendStats {
  const seen = (e: EmailEventRow) => e.origin !== "automated";
  const opens = events
    .filter((e) => e.event_type === "open" && seen(e))
    .map((e) => e.occurred_at)
    .sort();
  const clicks = events
    .filter((e) => e.event_type === "click" && seen(e))
    .map((e) => e.occurred_at)
    .sort();
  return {
    opens: opens.length,
    firstOpen: opens[0] ?? null,
    lastOpen: opens.at(-1) ?? null,
    clicks: clicks.length,
    lastClick: clicks.at(-1) ?? null,
    automatedClicks: events.filter((e) => e.event_type === "click" && !seen(e)).length,
    automatedOpens: events.filter((e) => e.event_type === "open" && !seen(e)).length,
  };
}

export type EmailSummary = {
  sent: number;
  /** Sent emails that can report opens / clicks (sent after tracking was enabled). */
  tracked: number;
  opened: number;
  clicked: number;
  /** opened / tracked */
  openRate: number | null;
  /** clicked / tracked */
  clickRate: number | null;
};

export function summarizeEmails(sends: SendRow[], events: EmailEventRow[]): EmailSummary {
  const sent = sends.filter((s) => s.status === "sent");
  const tracked = sent.filter((s) => s.tracked !== false);
  const ids = new Set(tracked.map((s) => s.id));
  const opened = new Set<string>();
  const clicked = new Set<string>();
  for (const e of events) {
    if (!ids.has(e.email_send_id) || e.origin === "automated") continue;
    (e.event_type === "open" ? opened : clicked).add(e.email_send_id);
  }
  return {
    sent: sent.length,
    tracked: tracked.length,
    opened: opened.size,
    clicked: clicked.size,
    openRate: tracked.length ? opened.size / tracked.length : null,
    clickRate: tracked.length ? clicked.size / tracked.length : null,
  };
}

export function formatListened(seconds: number): string {
  const s = Math.round(seconds);
  if (s < 60) return `${s} s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} min${s % 60 && m < 10 ? ` ${s % 60} s` : ""}`;
  return `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, "0")} min`;
}

export const formatRate = (r: number | null) => (r == null ? "—" : `${Math.round(r * 100)} %`);
