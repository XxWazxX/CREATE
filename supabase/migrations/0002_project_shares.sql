-- CREATE — sharing moves from single tracks to whole projects.
-- USER → PROJECT → PROJECT SHARE → public page /p/{token} → TRACKS

-- ---------------------------------------------------------------------------
-- project_shares
-- ---------------------------------------------------------------------------

create table public.project_shares (
  id                   uuid primary key default gen_random_uuid(),
  user_id              uuid not null default auth.uid() references auth.users (id) on delete cascade,
  project_id           uuid not null references public.projects (id) on delete cascade,
  token                text not null unique check (length(token) >= 24),
  label                text not null default '',
  allow_streaming      boolean not null default true,
  allow_mp3_download   boolean not null default true,
  allow_wav_download   boolean not null default false,
  allow_stems_download boolean not null default false,
  password_hash        text,
  expires_at           timestamptz,
  -- stats (no personal data: counters only)
  view_count           integer not null default 0,
  play_count           integer not null default 0,
  download_count       integer not null default 0,
  last_viewed_at       timestamptz,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);

create index project_shares_project_idx on public.project_shares (project_id, created_at desc);

create trigger project_shares_updated_at before update on public.project_shares
  for each row execute function public.set_updated_at();

alter table public.project_shares enable row level security;

-- The owner sees and manages their links. Visitors never query this table:
-- public pages resolve tokens server-side with the service role.
create policy "own project_shares" on public.project_shares
  for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

-- Stats counters, called only by the server (service role) when a visitor
-- views, plays or downloads. Not callable by browsers.
create or replace function public.project_share_hit(p_share_id uuid, p_kind text)
returns void language sql as $$
  update public.project_shares set
    view_count     = view_count     + (p_kind = 'view')::int,
    play_count     = play_count     + (p_kind = 'play')::int,
    download_count = download_count + (p_kind = 'download')::int,
    last_viewed_at = case when p_kind = 'view' then now() else last_viewed_at end
  where id = p_share_id;
$$;

revoke execute on function public.project_share_hit(uuid, text) from public, anon, authenticated;
grant execute on function public.project_share_hit(uuid, text) to service_role;

-- ---------------------------------------------------------------------------
-- Emails now point at project links
-- ---------------------------------------------------------------------------

alter table public.email_sends
  add column project_id uuid references public.projects (id) on delete set null,
  add column project_share_id uuid references public.project_shares (id) on delete set null;

create index email_sends_project_idx on public.email_sends (project_id);

-- ---------------------------------------------------------------------------
-- Track-level sharing is removed
-- ---------------------------------------------------------------------------

drop trigger if exists shares_log on public.shares;
drop function if exists public.shares_activity();
alter table public.email_sends drop column if exists share_id;
drop table if exists public.shares;
