-- ---------------------------------------------------------------------------
-- Artists: the owner's private address book (name + email), used to pick
-- recipients when emailing a project link. Never exposed publicly.
-- ---------------------------------------------------------------------------

create table public.artists (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null default auth.uid() references auth.users (id) on delete cascade,
  artist_name text not null check (length(btrim(artist_name)) between 1 and 200),
  email       text not null check (
                length(email) <= 254
                and email = lower(btrim(email))
                and email ~ '^[^\s@<>(),;:"]+@[^\s@<>(),;:"]+\.[a-z]{2,}$'
              ),
  created_at  timestamptz not null default now(),
  -- One entry per address and owner (emails are stored lower-cased).
  unique (user_id, email)
);

create index artists_user_name_idx on public.artists (user_id, artist_name);

alter table public.artists enable row level security;

create policy "own artists" on public.artists
  for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

-- No access at all for anonymous visitors (public share pages never read this table).
revoke all on public.artists from anon;
grant select, insert, update, delete on public.artists to authenticated;
