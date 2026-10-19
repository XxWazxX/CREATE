-- ---------------------------------------------------------------------------
-- Artist folders: group contacts (e.g. "RAP US") to browse them and pick a
-- whole list of recipients at once. An artist is in at most one folder.
-- ---------------------------------------------------------------------------

create table public.artist_folders (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null default auth.uid() references auth.users (id) on delete cascade,
  name       text not null check (length(btrim(name)) between 1 and 80),
  created_at timestamptz not null default now(),
  unique (user_id, name)
);

alter table public.artists
  add column folder_id uuid references public.artist_folders (id) on delete set null;

create index artists_folder_idx on public.artists (folder_id);

alter table public.artist_folders enable row level security;

create policy "own artist_folders" on public.artist_folders
  for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

-- A folder can only hold the owner's own artists.
create or replace function public.artists_folder_owner()
returns trigger language plpgsql as $$
begin
  if new.folder_id is not null and not exists (
    select 1 from public.artist_folders f where f.id = new.folder_id and f.user_id = new.user_id
  ) then
    raise exception 'Folder does not belong to this user';
  end if;
  return new;
end $$;

create trigger artists_folder_owner before insert or update of folder_id on public.artists
  for each row execute function public.artists_folder_owner();

revoke all on public.artist_folders from anon;
grant select, insert, update, delete on public.artist_folders to authenticated;

-- ---------------------------------------------------------------------------
-- One-time: the contacts already imported (contacts_rappeurs_instagram_emails.xlsx)
-- go into a "RAP US" folder.
-- ---------------------------------------------------------------------------

insert into public.artist_folders (user_id, name)
select distinct user_id, 'RAP US' from public.artists
on conflict (user_id, name) do nothing;

update public.artists a
set folder_id = f.id
from public.artist_folders f
where f.user_id = a.user_id and f.name = 'RAP US' and a.folder_id is null;
