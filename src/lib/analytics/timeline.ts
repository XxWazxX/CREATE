/**
 * Chronology of what was really received or measured: email events (sending,
 * detected opens / clicks) and player events (started, paused, resumed, end
 * reached). Wording never claims more than the data shows.
 */
import type { EmailEventRow, SendRow } from "./stats";

export type TimelineSource = "send" | "email" | "player";

export type TimelineItem = {
  id: string;
  at: string;
  source: TimelineSource;
  label: string;
  detail: string | null;
  muted?: boolean;
};

type ListenEv = {
  session_id: string;
  track_id: string | null;
  play_id: string;
  event_type: "start" | "resume" | "progress" | "pause" | "end";
  occurred_at: string;
};

type Session = { id: string; email_send_id: string | null; project_id: string };

const LISTEN_LABEL: Record<string, string> = {
  start: "Lecture lancée",
  resume: "Reprise de lecture",
  pause: "Pause",
  end: "Fin du morceau atteinte",
};

export function buildTimeline(input: {
  sends: SendRow[];
  emailEvents: EmailEventRow[];
  sessions: Session[];
  events: ListenEv[];
  trackTitle: (id: string | null) => string;
  projectName: (id: string | null) => string;
  limit?: number;
}): TimelineItem[] {
  const who = (s: SendRow | undefined) => (s ? s.options?.artist_name || s.recipient : "destinataire inconnu");
  const sendById = new Map(input.sends.map((s) => [s.id, s]));
  const sessionById = new Map(input.sessions.map((s) => [s.id, s]));
  const items: TimelineItem[] = [];

  for (const s of input.sends) {
    items.push({
      id: `send:${s.id}`,
      at: s.created_at,
      source: "send",
      label: s.status === "failed" ? `Échec d’envoi à ${who(s)}` : `E-mail envoyé à ${who(s)}`,
      detail: s.track_title,
      muted: s.status === "failed",
    });
  }

  input.emailEvents.forEach((e, i) => {
    const s = sendById.get(e.email_send_id);
    const auto = e.origin === "automated";
    const label =
      e.event_type === "open"
        ? auto
          ? "Ouverture automatique (scanner / préchargement)"
          : "Ouverture détectée"
        : auto
          ? "Clic probablement automatique (scanner / aperçu)"
          : "Clic sur le lien du projet";
    items.push({
      id: `ee:${e.email_send_id}:${i}`,
      at: e.occurred_at,
      source: "email",
      label,
      detail: `${who(s)}${s ? ` · ${s.track_title}` : ""}`,
      muted: auto,
    });
  });

  // A pause fired by the browser right before "ended" is noise.
  const sorted = [...input.events].sort((a, b) => a.occurred_at.localeCompare(b.occurred_at));
  sorted.forEach((e, i) => {
    if (e.event_type === "progress") return;
    const next = sorted[i + 1];
    if (
      e.event_type === "pause" &&
      next?.play_id === e.play_id &&
      next.event_type === "end" &&
      new Date(next.occurred_at).getTime() - new Date(e.occurred_at).getTime() < 3000
    )
      return;
    const sess = sessionById.get(e.session_id);
    const send = sess?.email_send_id ? sendById.get(sess.email_send_id) : undefined;
    items.push({
      id: `le:${e.play_id}:${e.event_type}:${e.occurred_at}`,
      at: e.occurred_at,
      source: "player",
      label: `${LISTEN_LABEL[e.event_type]} : ${input.trackTitle(e.track_id)}`,
      detail: [
        input.projectName(sess?.project_id ?? null),
        send ? `via l’e-mail à ${who(send)}` : "lien direct (auditeur non identifié)",
      ].join(" · "),
    });
  });

  return items.sort((a, b) => b.at.localeCompare(a.at)).slice(0, input.limit ?? 200);
}
