-- ---------------------------------------------------------------------------
-- Manual order of the prods inside a project (drag & drop in the project page).
-- Also used by the listening link and the project email.
-- ---------------------------------------------------------------------------

alter table public.tracks add column if not exists position double precision;

-- Current order kept: oldest first, as before.
update public.tracks t
set position = o.rn
from (
  select id, row_number() over (partition by project_id order by created_at) as rn
  from public.tracks
  where project_id is not null
) o
where t.id = o.id and t.position is null;

create index if not exists tracks_project_position_idx on public.tracks (project_id, position);

-- Reordering is not an edit: it does not change "Modifiés récemment".
create or replace function public.tracks_set_updated_at()
returns trigger language plpgsql as $$
declare
  ignored text[] := array['updated_at', 'play_count', 'last_played_at', 'status', 'preview_path',
                          'duration', 'file_size', 'mime_type', 'original_filename', 'file_path', 'position'];
begin
  if (to_jsonb(new) - ignored) is distinct from (to_jsonb(old) - ignored) then
    new.updated_at = now();
  else
    new.updated_at = old.updated_at;
  end if;
  return new;
end $$;
