/**
 * Analytics logic: bot / proxy detection, event dedupe windows, listened-time
 * accounting in the player, qualified / complete listens and email rates.
 *
 *   npx tsx scripts/test-analytics.ts
 */
import { classifyRequest, dedupeKey } from "../src/lib/analytics/classify";
import { ListenTracker, type ListenEvent } from "../src/lib/analytics/listen-tracker";
import {
  isComplete,
  isQualified,
  perTrack,
  sendStats,
  summarizeEmails,
  summarizePlays,
  type EmailEventRow,
  type PlayRow,
  type SendRow,
} from "../src/lib/analytics/stats";

let failures = 0;
function check(name: string, ok: boolean, extra?: unknown) {
  if (!ok) failures++;
  console.log(`${ok ? "✓" : "✗"} ${name}${ok || extra === undefined ? "" : ` → ${JSON.stringify(extra)}`}`);
}

const CHROME =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0 Safari/537.36";

// --- 13. Robots, previews, prefetch -------------------------------------------
check(
  "browser click after a minute is human",
  classifyRequest({ kind: "click", userAgent: CHROME, secondsSinceSend: 90 }) === "human",
);
check(
  "click 3 s after sending = scanner",
  classifyRequest({ kind: "click", userAgent: CHROME, secondsSinceSend: 3 }) === "automated",
);
check(
  "HEAD request = automated",
  classifyRequest({ kind: "click", method: "HEAD", userAgent: CHROME }) === "automated",
);
check(
  "prefetch header = automated",
  classifyRequest({ kind: "click", userAgent: CHROME, purpose: "prefetch" }) === "automated",
);
check(
  "Slack link preview = automated",
  classifyRequest({ kind: "click", userAgent: "Slackbot-LinkExpanding 1.0" }) === "automated",
);
check(
  "Outlook SafeLinks = automated",
  classifyRequest({ kind: "click", userAgent: "Microsoft Office/16.0 SafeLinks" }) === "automated",
);
check("empty user agent = automated", classifyRequest({ kind: "open", userAgent: "" }) === "automated");
check(
  "Gmail image proxy = proxy open",
  classifyRequest({
    kind: "open",
    userAgent: "Mozilla/5.0 (via ggpht.com GoogleImageProxy)",
    secondsSinceSend: 600,
  }) === "proxy",
);
check("listen from a browser is human", classifyRequest({ kind: "listen", userAgent: CHROME }) === "human");

// --- 3. Dedupe windows ---------------------------------------------------------
const t0 = new Date("2026-10-17T09:41:10Z");
check(
  "two opens in the same hour share a key",
  dedupeKey("open", "proxy", t0) === dedupeKey("open", "human", new Date("2026-10-17T09:59:00Z")),
);
check(
  "opens in different hours differ",
  dedupeKey("open", "human", t0) !== dedupeKey("open", "human", new Date("2026-10-17T10:00:01Z")),
);
check(
  "clicks are deduped per minute",
  dedupeKey("click", "human", t0) === dedupeKey("click", "human", new Date("2026-10-17T09:41:59Z")),
);
check(
  "automated events never merge with real ones",
  dedupeKey("click", "automated", t0) !== dedupeKey("click", "human", t0),
);

// --- 6/7. Player: start, pause, seek, listened time ---------------------------
let clock = 0;
let id = 0;
const tr = new ListenTracker(
  () => clock,
  () => `00000000-0000-4000-8000-${String(++id).padStart(12, "0")}`,
);
const A = "aaaaaaaa-0000-4000-8000-000000000001";
const B = "bbbbbbbb-0000-4000-8000-000000000002";
const play = (from: number, to: number, step = 0.25) => {
  for (let p = from + step; p <= to + 1e-9; p += step) tr.time(p);
};

tr.playing(A, 0, 120);
play(0, 20); // 20 s played
tr.pause(20);
play(20, 40); // paused: the position moves (scrubbing) but nothing is counted
tr.seeked(60); // jump forward
tr.playing(A, 60, 120); // resume
play(60, 75); // 15 s
tr.time(110); // big jump without "seeked": ignored
tr.ended(110);
let ev: ListenEvent[] = tr.drain();
const listened = ev.reduce((s, e) => s + e.listened, 0);
check(
  "events: start, pause, resume, end",
  ev.map((e) => e.type).join(",") === "start,pause,resume,end",
  ev.map((e) => e.type),
);
check("listened time = 35 s (pauses and seeks excluded)", Math.abs(listened - 35) < 0.01, listened);
check("one play id for the whole run", new Set(ev.map((e) => e.play)).size === 1);
check("idempotency keys are unique", new Set(ev.map((e) => e.key)).size === ev.length);

// Replay after the end = a new play; switching tracks closes the previous play.
tr.playing(A, 0, 120);
play(0, 10);
tr.tick();
tr.playing(B, 0, 45); // track change without pause
play(0, 30);
tr.ended(30);
ev = tr.drain();
const plays = new Set(ev.map((e) => e.play));
check("replay and track change give new plays", plays.size === 2, [...plays]);
check(
  "periodic tick reports progress",
  ev.some((e) => e.type === "progress" && e.track === A && Math.abs(e.listened - 10) < 0.01),
);

// Long hidden stretch: split under the server cap.
tr.playing(B, 0, 400);
play(0, 300, 1);
tr.pause(300);
ev = tr.drain();
check(
  "no event above the 110 s cap",
  ev.every((e) => e.listened <= 110),
  ev.map((e) => e.listened),
);
check("split events keep the total", Math.abs(ev.reduce((s, e) => s + e.listened, 0) - 300) < 0.01);

// --- 8. Qualified / complete ----------------------------------------------------
check("29 s of a 3 min track is not qualified", !isQualified(29, 180));
check("30 s of a 3 min track is qualified", isQualified(30, 180));
check("short track: half is enough", isQualified(20, 40) && !isQualified(19, 40));
check("complete at 90 %", isComplete(162, 180) && !isComplete(161, 180));
check("unknown duration is never complete", !isComplete(500, null));

// --- 9/10. Several tracks, sessions, loops, email link ---------------------------
const P = (o: Partial<PlayRow>): PlayRow => ({
  play_id: crypto.randomUUID(),
  session_id: "s1",
  track_id: A,
  project_id: "p1",
  project_share_id: "sh1",
  email_send_id: null,
  source: "direct",
  started_at: "2026-10-17T09:43:00Z",
  last_event_at: "2026-10-17T09:44:00Z",
  started: true,
  reached_end: false,
  duration_seconds: 180,
  max_position_seconds: 0,
  listened_seconds: 0,
  ...o,
});
const rows = [
  P({ listened_seconds: 175, reached_end: true }), // complete
  P({ listened_seconds: 60 }), // same session + track: a repeat
  P({ track_id: B, listened_seconds: 5 }), // started, not qualified
  P({ session_id: "s2", listened_seconds: 31, email_send_id: "e1", source: "email" }),
  P({ started: false, listened_seconds: 0 }), // nothing played: not a start
];
const sum = summarizePlays(rows);
check("starts exclude plays that never began", sum.starts === 4, sum);
check("qualified listens", sum.qualified === 3, sum);
check("complete listens", sum.complete === 1, sum);
check("distinct sessions", sum.sessions === 2, sum);
check("repeats (loops / replays) counted apart", sum.repeats === 1, sum);
check("listened time adds up", sum.listenedSeconds === 271, sum);
const byTrack = perTrack(rows);
check(
  "per-track ranking puts the most qualified first",
  byTrack[0].trackId === A && byTrack[0].qualified === 3,
  byTrack,
);
check("tracks are kept apart", byTrack.find((t) => t.trackId === B)?.qualified === 0);
check("only email-attributed plays carry a send id", rows.filter((r) => r.email_send_id).length === 1);

// --- 2/11/15. Email rates, automated excluded, no fake numbers ------------------
const sends: SendRow[] = [
  {
    id: "e1",
    recipient: "a@x.com",
    project_id: "p1",
    project_share_id: "sh1",
    status: "sent",
    created_at: "",
    track_title: "P",
  },
  {
    id: "e2",
    recipient: "b@x.com",
    project_id: "p1",
    project_share_id: "sh1",
    status: "sent",
    created_at: "",
    track_title: "P",
  },
  {
    id: "e3",
    recipient: "c@x.com",
    project_id: "p1",
    project_share_id: "sh1",
    status: "failed",
    created_at: "",
    track_title: "P",
  },
  {
    id: "e4",
    recipient: "d@x.com",
    project_id: "p1",
    project_share_id: "sh1",
    status: "sent",
    created_at: "",
    track_title: "P",
    tracked: false,
  },
];
const events: EmailEventRow[] = [
  { email_send_id: "e1", event_type: "open", origin: "proxy", occurred_at: "2026-10-17T09:41:00Z" },
  { email_send_id: "e1", event_type: "open", origin: "human", occurred_at: "2026-10-17T11:00:00Z" },
  { email_send_id: "e1", event_type: "click", origin: "human", occurred_at: "2026-10-17T09:42:00Z" },
  { email_send_id: "e2", event_type: "click", origin: "automated", occurred_at: "2026-10-17T09:30:02Z" },
];
const em = summarizeEmails(sends, events);
check("sent counts only accepted emails", em.sent === 3, em);
check("rates use tracked emails only", em.tracked === 2, em);
check("an automated click is not a click", em.clicked === 1 && em.clickRate === 0.5, em);
check("open rate", em.opened === 1 && em.openRate === 0.5, em);
const s1 = sendStats(events.filter((e) => e.email_send_id === "e1"));
check(
  "first / last open",
  s1.firstOpen === "2026-10-17T09:41:00Z" && s1.lastOpen === "2026-10-17T11:00:00Z" && s1.opens === 2,
  s1,
);
const s2 = sendStats(events.filter((e) => e.email_send_id === "e2"));
check("automated click kept apart", s2.clicks === 0 && s2.automatedClicks === 1, s2);
const empty = summarizePlays([]);
check(
  "no events → zeros, no invented averages",
  empty.starts === 0 && empty.qualified === 0 && empty.avgCompletion === null && empty.lastActivity === null,
);
const none = summarizeEmails([], []);
check("no emails → no rate", none.openRate === null && none.clickRate === null);

console.log(failures ? `\n${failures} check(s) failed` : "\nAll analytics checks passed");
process.exit(failures ? 1 : 0);
