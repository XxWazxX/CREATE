-- CREATE — initial schema
-- Single-user personal beat library. Every row belongs to auth.uid() and is
-- protected by Row Level Security. Files live in the private "media" bucket.

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------

create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

-- ---------------------------------------------------------------------------
-- profiles ("users")
-- ---------------------------------------------------------------------------

create table public.profiles (
  id           uuid primary key references auth.users (id) on delete cascade,
  display_name text,
  settings     jsonb not null default '{}'::jsonb,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create trigger profiles_updated_at before update on public.profiles
  for each row execute function public.set_updated_at();

create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, display_name)
  values (new.id, coalesce(nullif(btrim(new.raw_user_meta_data ->> 'display_name'), ''), split_part(new.email, '@', 1)))
  on conflict (id) do nothing;
  return new;
end $$;

create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------------------
-- projects (projects and folders share one tree)
-- ---------------------------------------------------------------------------

create table public.projects (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null default auth.uid() references auth.users (id) on delete cascade,
  parent_id   uuid references public.projects (id) on delete cascade,
  kind        text not null default 'project' check (kind in ('project', 'folder')),
  name        text not null check (length(btrim(name)) > 0),
  description text not null default '',
  color       text,
  cover_path  text,
  position    double precision not null default 0,
  deleted_at  timestamptz,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  constraint projects_not_own_parent check (parent_id is distinct from id)
);

create index projects_user_idx on public.projects (user_id, updated_at desc);
create index projects_parent_idx on public.projects (parent_id);

create trigger projects_updated_at before update on public.projects
  for each row execute function public.set_updated_at();

-- Prevent cycles when moving a project into one of its descendants.
create or replace function public.projects_prevent_cycle()
returns trigger language plpgsql as $$
begin
  if new.parent_id is not null and exists (
    with recursive ancestors as (
      select id, parent_id from public.projects where id = new.parent_id
      union all
      select p.id, p.parent_id from public.projects p
      join ancestors a on p.id = a.parent_id
    )
    select 1 from ancestors where id = new.id
  ) then
    raise exception 'A project cannot be moved inside itself';
  end if;
  return new;
end $$;

create trigger projects_no_cycle before insert or update of parent_id on public.projects
  for each row execute function public.projects_prevent_cycle();

-- ---------------------------------------------------------------------------
-- tracks (a song; its audio lives in track_versions, the current version is
-- denormalized onto the track for fast listing)
-- ---------------------------------------------------------------------------

create table public.tracks (
  id                 uuid primary key default gen_random_uuid(),
  user_id            uuid not null default auth.uid() references auth.users (id) on delete cascade,
  project_id         uuid references public.projects (id) on delete set null,
  parent_track_id    uuid references public.tracks (id) on delete set null,
  title              text not null check (length(btrim(title)) > 0),
  artist             text,
  producer           text,
  bpm                numeric(6, 2) check (bpm is null or (bpm > 0 and bpm < 1000)),
  key                text,
  genre              text,
  notes              text not null default '',
  favorite           boolean not null default false,
  favorited_at       timestamptz,
  cover_path         text,
  -- current version (kept in sync by triggers below)
  current_version_id uuid,
  version_number     integer not null default 1,
  file_path          text,
  preview_path       text,
  original_filename  text,
  file_size          bigint,
  mime_type          text,
  duration           real,
  status             text not null default 'ready'
                       check (status in ('uploading', 'processing', 'ready', 'error')),
  -- usage
  last_played_at     timestamptz,
  play_count         integer not null default 0,
  deleted_at         timestamptz,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

create index tracks_user_created_idx on public.tracks (user_id, created_at desc);
create index tracks_project_idx on public.tracks (project_id);
create index tracks_deleted_idx on public.tracks (user_id, deleted_at);

-- updated_at reflects real edits: plays and upload/processing bookkeeping
-- don't count as a modification.
create or replace function public.tracks_set_updated_at()
returns trigger language plpgsql as $$
declare
  ignored text[] := array['updated_at', 'play_count', 'last_played_at', 'status', 'preview_path',
                          'duration', 'file_size', 'mime_type', 'original_filename', 'file_path'];
begin
  if (to_jsonb(new) - ignored) is distinct from (to_jsonb(old) - ignored) then
    new.updated_at = now();
  else
    new.updated_at = old.updated_at;
  end if;
  return new;
end $$;

create trigger tracks_updated_at before update on public.tracks
  for each row execute function public.tracks_set_updated_at();

-- ---------------------------------------------------------------------------
-- track_versions
-- ---------------------------------------------------------------------------

create table public.track_versions (
  id                uuid primary key default gen_random_uuid(),
  user_id           uuid not null default auth.uid() references auth.users (id) on delete cascade,
  track_id          uuid not null references public.tracks (id) on delete cascade,
  version_number    integer not null,
  label             text not null,
  file_path         text not null,
  preview_path      text,
  original_filename text,
  file_size         bigint,
  mime_type         text,
  duration          real,
  peaks             jsonb,
  bpm               numeric(6, 2),
  key               text,
  notes             text not null default '',
  status            text not null default 'uploading'
                      check (status in ('uploading', 'processing', 'ready', 'error')),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  unique (track_id, version_number)
);

create index track_versions_track_idx on public.track_versions (track_id, version_number);

create trigger track_versions_updated_at before update on public.track_versions
  for each row execute function public.set_updated_at();

alter table public.tracks
  add constraint tracks_current_version_fk
  foreign key (current_version_id) references public.track_versions (id) on delete set null;

-- When tracks.current_version_id changes, copy the version's file fields.
create or replace function public.tracks_pull_current_version()
returns trigger language plpgsql as $$
declare v public.track_versions;
begin
  if new.current_version_id is not null and
     (tg_op = 'INSERT' or new.current_version_id is distinct from old.current_version_id) then
    select * into v from public.track_versions where id = new.current_version_id;
    if found then
      if v.track_id <> new.id then
        raise exception 'Version does not belong to this track';
      end if;
      new.version_number    := v.version_number;
      new.file_path         := v.file_path;
      new.preview_path      := v.preview_path;
      new.original_filename := v.original_filename;
      new.file_size         := v.file_size;
      new.mime_type         := v.mime_type;
      new.duration          := v.duration;
      new.status            := v.status;
    end if;
  end if;
  return new;
end $$;

create trigger tracks_current_version before insert or update of current_version_id on public.tracks
  for each row execute function public.tracks_pull_current_version();

-- When the current version itself changes (upload finished, preview ready…),
-- push the file fields to the track.
create or replace function public.track_versions_push_to_track()
returns trigger language plpgsql as $$
begin
  update public.tracks t set
    version_number    = new.version_number,
    file_path         = new.file_path,
    preview_path      = new.preview_path,
    original_filename = new.original_filename,
    file_size         = new.file_size,
    mime_type         = new.mime_type,
    duration          = new.duration,
    status            = new.status
  where t.id = new.track_id and t.current_version_id = new.id;
  return new;
end $$;

create trigger track_versions_sync after update on public.track_versions
  for each row execute function public.track_versions_push_to_track();

-- ---------------------------------------------------------------------------
-- stems
-- ---------------------------------------------------------------------------

create table public.stems (
  id                uuid primary key default gen_random_uuid(),
  user_id           uuid not null default auth.uid() references auth.users (id) on delete cascade,
  track_id          uuid not null references public.tracks (id) on delete cascade,
  version_id        uuid references public.track_versions (id) on delete set null,
  kind              text not null default 'other'
                      check (kind in ('drums', '808', 'bass', 'melody', 'keys', 'vocals', 'fx', 'other')),
  name              text not null,
  file_path         text not null,
  original_filename text,
  file_size         bigint,
  mime_type         text,
  duration          real,
  position          integer not null default 0,
  status            text not null default 'uploading'
                      check (status in ('uploading', 'ready', 'error')),
  created_at        timestamptz not null default now()
);

create index stems_track_idx on public.stems (track_id, position);

-- ---------------------------------------------------------------------------
-- tags
-- ---------------------------------------------------------------------------

create table public.tags (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null default auth.uid() references auth.users (id) on delete cascade,
  name       text not null check (length(btrim(name)) > 0),
  color      text,
  created_at timestamptz not null default now()
);

create unique index tags_user_name_idx on public.tags (user_id, lower(name));

create table public.track_tags (
  track_id   uuid not null references public.tracks (id) on delete cascade,
  tag_id     uuid not null references public.tags (id) on delete cascade,
  user_id    uuid not null default auth.uid() references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (track_id, tag_id)
);

create index track_tags_tag_idx on public.track_tags (tag_id);

-- ---------------------------------------------------------------------------
-- shares (private listening links)
-- ---------------------------------------------------------------------------

create table public.shares (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null default auth.uid() references auth.users (id) on delete cascade,
  track_id       uuid not null references public.tracks (id) on delete cascade,
  token          text not null unique check (length(token) >= 24),
  allow_download boolean not null default true,
  allow_wav      boolean not null default false,
  allow_stems    boolean not null default false,
  recipient      text,
  expires_at     timestamptz,
  revoked_at     timestamptz,
  view_count     integer not null default 0,
  last_viewed_at timestamptz,
  created_at     timestamptz not null default now()
);

create index shares_track_idx on public.shares (track_id, created_at desc);

-- ---------------------------------------------------------------------------
-- email_sends
-- ---------------------------------------------------------------------------

create table public.email_sends (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null default auth.uid() references auth.users (id) on delete cascade,
  track_id    uuid references public.tracks (id) on delete set null,
  share_id    uuid references public.shares (id) on delete set null,
  track_title text not null,
  recipient   text not null,
  subject     text not null,
  message     text not null default '',
  html        text,
  options     jsonb not null default '{}'::jsonb,
  status      text not null default 'queued' check (status in ('queued', 'sent', 'failed')),
  provider_id text,
  error       text,
  created_at  timestamptz not null default now()
);

create index email_sends_user_idx on public.email_sends (user_id, created_at desc);

-- ---------------------------------------------------------------------------
-- activity
-- ---------------------------------------------------------------------------

create table public.activity (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null default auth.uid() references auth.users (id) on delete cascade,
  track_id   uuid references public.tracks (id) on delete cascade,
  project_id uuid references public.projects (id) on delete set null,
  type       text not null,
  data       jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index activity_track_idx on public.activity (track_id, created_at desc);

create or replace function public.log_activity(
  p_user uuid, p_track uuid, p_type text, p_data jsonb default '{}'::jsonb
) returns void language sql as $$
  insert into public.activity (user_id, track_id, type, data)
  values (p_user, p_track, p_type, coalesce(p_data, '{}'::jsonb));
$$;

create or replace function public.tracks_activity()
returns trigger language plpgsql as $$
declare changed text[] := '{}';
begin
  if tg_op = 'INSERT' then
    perform public.log_activity(new.user_id, new.id, 'created',
      jsonb_build_object('filename', new.original_filename));
    return new;
  end if;

  if new.title      is distinct from old.title      then changed := array_append(changed, 'title'); end if;
  if new.artist     is distinct from old.artist     then changed := array_append(changed, 'artist'); end if;
  if new.producer   is distinct from old.producer   then changed := array_append(changed, 'producer'); end if;
  if new.bpm        is distinct from old.bpm        then changed := array_append(changed, 'bpm'); end if;
  if new.key        is distinct from old.key        then changed := array_append(changed, 'key'); end if;
  if new.genre      is distinct from old.genre      then changed := array_append(changed, 'genre'); end if;
  if new.cover_path is distinct from old.cover_path then changed := array_append(changed, 'cover'); end if;
  if array_length(changed, 1) > 0 then
    perform public.log_activity(new.user_id, new.id, 'edited', jsonb_build_object('fields', changed));
  end if;

  if new.project_id is distinct from old.project_id then
    perform public.log_activity(new.user_id, new.id, 'moved',
      jsonb_build_object('project_id', new.project_id,
        'project_name', (select name from public.projects where id = new.project_id)));
  end if;

  if new.current_version_id is distinct from old.current_version_id
     and old.current_version_id is not null then
    perform public.log_activity(new.user_id, new.id, 'current_version',
      jsonb_build_object('version_id', new.current_version_id,
        'label', (select label from public.track_versions where id = new.current_version_id)));
  end if;

  if new.deleted_at is not null and old.deleted_at is null then
    perform public.log_activity(new.user_id, new.id, 'trashed');
  elsif new.deleted_at is null and old.deleted_at is not null then
    perform public.log_activity(new.user_id, new.id, 'restored');
  end if;

  return new;
end $$;

create trigger tracks_log after insert or update on public.tracks
  for each row execute function public.tracks_activity();

create or replace function public.versions_activity()
returns trigger language plpgsql as $$
begin
  if new.version_number > 1 then
    perform public.log_activity(new.user_id, new.track_id, 'version_added',
      jsonb_build_object('version_id', new.id, 'label', new.label));
  end if;
  return new;
end $$;

create trigger versions_log after insert on public.track_versions
  for each row execute function public.versions_activity();

create or replace function public.stems_activity()
returns trigger language plpgsql as $$
begin
  perform public.log_activity(new.user_id, new.track_id, 'stem_added',
    jsonb_build_object('name', new.name, 'kind', new.kind));
  return new;
end $$;

create trigger stems_log after insert on public.stems
  for each row execute function public.stems_activity();

create or replace function public.shares_activity()
returns trigger language plpgsql as $$
begin
  if tg_op = 'INSERT' then
    perform public.log_activity(new.user_id, new.track_id, 'shared',
      jsonb_build_object('share_id', new.id, 'recipient', new.recipient));
  elsif new.view_count > old.view_count and old.view_count = 0 then
    perform public.log_activity(new.user_id, new.track_id, 'share_opened',
      jsonb_build_object('share_id', new.id, 'recipient', new.recipient));
  elsif new.revoked_at is not null and old.revoked_at is null then
    perform public.log_activity(new.user_id, new.track_id, 'share_revoked',
      jsonb_build_object('share_id', new.id));
  end if;
  return new;
end $$;

create trigger shares_log after insert or update on public.shares
  for each row execute function public.shares_activity();

create or replace function public.email_activity()
returns trigger language plpgsql as $$
begin
  if new.track_id is not null and new.status = 'sent'
     and (tg_op = 'INSERT' or old.status is distinct from 'sent') then
    perform public.log_activity(new.user_id, new.track_id, 'emailed',
      jsonb_build_object('recipient', new.recipient, 'email_id', new.id));
  end if;
  return new;
end $$;

create trigger email_log after insert or update on public.email_sends
  for each row execute function public.email_activity();

-- Touch the parent project when tracks are added to / moved into it, so
-- "recent projects" reflects real activity.
create or replace function public.tracks_touch_project()
returns trigger language plpgsql as $$
begin
  if new.project_id is not null and
     (tg_op = 'INSERT' or new.project_id is distinct from old.project_id) then
    update public.projects set updated_at = now() where id = new.project_id;
  end if;
  return new;
end $$;

create trigger tracks_touch_project after insert or update of project_id on public.tracks
  for each row execute function public.tracks_touch_project();

-- ---------------------------------------------------------------------------
-- RPCs
-- ---------------------------------------------------------------------------

-- Create a track and its first version atomically (instant library entry).
create or replace function public.create_track(
  p_track_id uuid,
  p_version_id uuid,
  p_title text,
  p_file_path text,
  p_original_filename text,
  p_file_size bigint,
  p_mime_type text,
  p_project_id uuid default null
) returns public.tracks language plpgsql as $$
declare t public.tracks;
begin
  insert into public.tracks (id, title, project_id, original_filename, file_size, mime_type, status)
  values (p_track_id, p_title, p_project_id, p_original_filename, p_file_size, p_mime_type, 'uploading');

  insert into public.track_versions
    (id, track_id, version_number, label, file_path, original_filename, file_size, mime_type, status)
  values
    (p_version_id, p_track_id, 1, 'V1', p_file_path, p_original_filename, p_file_size, p_mime_type, 'uploading');

  update public.tracks set current_version_id = p_version_id
  where id = p_track_id
  returning * into t;
  return t;
end $$;

-- Add a new version to an existing track and make it current.
create or replace function public.add_track_version(
  p_track_id uuid,
  p_version_id uuid,
  p_file_path text,
  p_original_filename text,
  p_file_size bigint,
  p_mime_type text,
  p_label text default null
) returns public.track_versions language plpgsql as $$
declare
  n integer;
  v public.track_versions;
begin
  select coalesce(max(version_number), 0) + 1 into n
  from public.track_versions where track_id = p_track_id;

  insert into public.track_versions
    (id, track_id, version_number, label, file_path, original_filename, file_size, mime_type, status)
  values
    (p_version_id, p_track_id, n, coalesce(nullif(btrim(p_label), ''), 'V' || n),
     p_file_path, p_original_filename, p_file_size, p_mime_type, 'uploading')
  returning * into v;

  update public.tracks set current_version_id = p_version_id where id = p_track_id;
  return v;
end $$;

create or replace function public.record_play(p_track_id uuid)
returns void language sql as $$
  update public.tracks
  set play_count = play_count + 1, last_played_at = now()
  where id = p_track_id;
$$;

-- Soft-delete / restore a project, its sub-projects and their tracks together.
create or replace function public.trash_project(p_project_id uuid)
returns void language plpgsql as $$
declare ts timestamptz := now();
begin
  with recursive tree as (
    select id from public.projects where id = p_project_id
    union all
    select p.id from public.projects p join tree on p.parent_id = tree.id
  )
  update public.projects set deleted_at = ts where id in (select id from tree) and deleted_at is null;

  with recursive tree as (
    select id from public.projects where id = p_project_id
    union all
    select p.id from public.projects p join tree on p.parent_id = tree.id
  )
  update public.tracks set deleted_at = ts
  where project_id in (select id from tree) and deleted_at is null;
end $$;

create or replace function public.restore_project(p_project_id uuid)
returns void language plpgsql as $$
declare ts timestamptz;
begin
  select deleted_at into ts from public.projects where id = p_project_id;
  if ts is null then return; end if;

  with recursive tree as (
    select id from public.projects where id = p_project_id
    union all
    select p.id from public.projects p join tree on p.parent_id = tree.id
  )
  update public.tracks set deleted_at = null
  where project_id in (select id from tree) and deleted_at = ts;

  with recursive tree as (
    select id from public.projects where id = p_project_id
    union all
    select p.id from public.projects p join tree on p.parent_id = tree.id
  )
  update public.projects set deleted_at = null where id in (select id from tree) and deleted_at = ts;

  -- Restoring a child whose parent is still in the trash: lift it to the root.
  update public.projects p set parent_id = null
  where p.id = p_project_id and p.parent_id is not null
    and exists (select 1 from public.projects q where q.id = p.parent_id and q.deleted_at is not null);
end $$;

-- ---------------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------------

alter table public.profiles       enable row level security;
alter table public.projects       enable row level security;
alter table public.tracks         enable row level security;
alter table public.track_versions enable row level security;
alter table public.stems          enable row level security;
alter table public.tags           enable row level security;
alter table public.track_tags     enable row level security;
alter table public.shares         enable row level security;
alter table public.email_sends    enable row level security;
alter table public.activity       enable row level security;

create policy "own profile" on public.profiles
  for all to authenticated
  using (id = (select auth.uid())) with check (id = (select auth.uid()));

create policy "own projects" on public.projects
  for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

create policy "own tracks" on public.tracks
  for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

create policy "own versions" on public.track_versions
  for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

create policy "own stems" on public.stems
  for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

create policy "own tags" on public.tags
  for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

create policy "own track_tags" on public.track_tags
  for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

create policy "own shares" on public.shares
  for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

create policy "own email_sends" on public.email_sends
  for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

create policy "own activity" on public.activity
  for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

-- ---------------------------------------------------------------------------
-- Storage: private bucket, files under users/{user_id}/...
-- ---------------------------------------------------------------------------

insert into storage.buckets (id, name, public)
values ('media', 'media', false)
on conflict (id) do nothing;

create policy "media read own" on storage.objects
  for select to authenticated
  using (bucket_id = 'media'
    and (storage.foldername(name))[1] = 'users'
    and (storage.foldername(name))[2] = (select auth.uid())::text);

create policy "media insert own" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'media'
    and (storage.foldername(name))[1] = 'users'
    and (storage.foldername(name))[2] = (select auth.uid())::text);

create policy "media update own" on storage.objects
  for update to authenticated
  using (bucket_id = 'media'
    and (storage.foldername(name))[1] = 'users'
    and (storage.foldername(name))[2] = (select auth.uid())::text);

create policy "media delete own" on storage.objects
  for delete to authenticated
  using (bucket_id = 'media'
    and (storage.foldername(name))[1] = 'users'
    and (storage.foldername(name))[2] = (select auth.uid())::text);
