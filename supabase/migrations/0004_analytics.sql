-- ---------------------------------------------------------------------------
-- Analytics: email opens / clicks and per-track listening on public links.
--
-- Everything here is written ONLY by the server (service role) from public
-- endpoints that validate the link first. The owner reads it through RLS.
-- Visitors never read these tables. No IP address, no fingerprint is stored.
-- ---------------------------------------------------------------------------

-- Each email gets its own unguessable tracking token (only its SHA-256 is stored).
alter table public.email_sends
  add column tracking_token_hash text unique;

-- ---------------------------------------------------------------------------
-- email_events: detected opens (pixel) and clicks (tracked link)
-- ---------------------------------------------------------------------------

create table public.email_events (
  id                uuid primary key default gen_random_uuid(),
  user_id           uuid not null references auth.users (id) on delete cascade,
  email_send_id     uuid not null references public.email_sends (id) on delete cascade,
  event_type        text not null check (event_type in ('open', 'click')),
  -- 'human' = nothing suspicious, 'proxy' = fetched by a mail provider's image
  -- proxy (Gmail, Yahoo…), 'automated' = scanner / link preview / prefetch.
  origin            text not null default 'human' check (origin in ('human', 'proxy', 'automated')),
  -- Set when the event comes from a provider webhook (Resend), for exact dedupe.
  provider_event_id text unique,
  -- Repeated identical events (same send, type and time window) collapse into one.
  dedupe_key        text not null,
  occurred_at       timestamptz not null default now(),
  metadata          jsonb not null default '{}'::jsonb,
  unique (email_send_id, event_type, dedupe_key)
);

create index email_events_send_idx on public.email_events (email_send_id, occurred_at);
create index email_events_user_idx on public.email_events (user_id, occurred_at desc);

-- ---------------------------------------------------------------------------
-- listening_sessions: one per browser tab on a public link
-- ---------------------------------------------------------------------------

create table public.listening_sessions (
  id                 uuid primary key default gen_random_uuid(),
  user_id            uuid not null references auth.users (id) on delete cascade,
  project_share_id   uuid not null references public.project_shares (id) on delete cascade,
  project_id         uuid not null references public.projects (id) on delete cascade,
  -- Only set when the visitor came through a tracked email link (signed cookie).
  email_send_id      uuid references public.email_sends (id) on delete set null,
  source             text not null check (source in ('email', 'direct')),
  session_token_hash text not null unique,
  started_at         timestamptz not null default now(),
  last_activity_at   timestamptz not null default now()
);

create index listening_sessions_share_idx on public.listening_sessions (project_share_id, started_at desc);
create index listening_sessions_project_idx on public.listening_sessions (project_id, started_at desc);
create index listening_sessions_send_idx on public.listening_sessions (email_send_id);
create index listening_sessions_user_idx on public.listening_sessions (user_id, started_at desc);

-- ---------------------------------------------------------------------------
-- listening_events: player events (start, resume, progress, pause, end)
-- ---------------------------------------------------------------------------

create table public.listening_events (
  id                    uuid primary key default gen_random_uuid(),
  user_id               uuid not null references auth.users (id) on delete cascade,
  session_id            uuid not null references public.listening_sessions (id) on delete cascade,
  track_id              uuid references public.tracks (id) on delete cascade,
  -- One "play" = one run of a track from start until it ends or another track starts.
  play_id               uuid not null,
  event_type            text not null check (event_type in ('start', 'resume', 'progress', 'pause', 'end')),
  -- Playback position when the event was emitted.
  position_seconds      real not null default 0 check (position_seconds >= 0),
  -- Audio actually played since the previous event of this play (pauses excluded).
  listened_seconds      real not null default 0 check (listened_seconds >= 0 and listened_seconds <= 120),
  -- Track duration as seen by the player.
  duration_seconds      real check (duration_seconds is null or duration_seconds >= 0),
  occurred_at           timestamptz not null default now(),
  event_idempotency_key text not null,
  unique (session_id, event_idempotency_key)
);

create index listening_events_session_idx on public.listening_events (session_id, occurred_at);
create index listening_events_track_idx on public.listening_events (track_id, occurred_at);
create index listening_events_user_idx on public.listening_events (user_id, occurred_at desc);
create index listening_events_play_idx on public.listening_events (play_id);

-- ---------------------------------------------------------------------------
-- listening_plays: one row per play, computed from the events (no stored aggregate)
-- ---------------------------------------------------------------------------

create view public.listening_plays with (security_invoker = true) as
select
  e.user_id,
  e.play_id,
  e.session_id,
  e.track_id,
  s.project_share_id,
  s.project_id,
  s.email_send_id,
  s.source,
  min(e.occurred_at)                                   as started_at,
  max(e.occurred_at)                                   as last_event_at,
  bool_or(e.event_type = 'start')                      as started,
  bool_or(e.event_type = 'end')                        as reached_end,
  max(e.duration_seconds)                              as duration_seconds,
  max(e.position_seconds)                              as max_position_seconds,
  -- Listened time never exceeds the track length (+5 %, rounding of timers).
  least(
    sum(e.listened_seconds),
    coalesce(max(e.duration_seconds) * 1.05, sum(e.listened_seconds))
  )                                                    as listened_seconds
from public.listening_events e
join public.listening_sessions s on s.id = e.session_id
group by e.user_id, e.play_id, e.session_id, e.track_id, s.project_share_id, s.project_id, s.email_send_id, s.source;

-- ---------------------------------------------------------------------------
-- Security: owner reads, nobody but the server writes
-- ---------------------------------------------------------------------------

alter table public.email_events       enable row level security;
alter table public.listening_sessions enable row level security;
alter table public.listening_events   enable row level security;

create policy "own email_events read" on public.email_events
  for select to authenticated using (user_id = (select auth.uid()));
create policy "own listening_sessions read" on public.listening_sessions
  for select to authenticated using (user_id = (select auth.uid()));
create policy "own listening_events read" on public.listening_events
  for select to authenticated using (user_id = (select auth.uid()));

revoke all on public.email_events, public.listening_sessions, public.listening_events from anon;
revoke all on public.listening_plays from anon;
revoke insert, update, delete on public.email_events, public.listening_sessions, public.listening_events
  from authenticated;
grant select on public.email_events, public.listening_sessions, public.listening_events, public.listening_plays
  to authenticated;
grant select, insert, update, delete on public.email_events, public.listening_sessions, public.listening_events
  to service_role;
grant select on public.listening_plays to service_role;
