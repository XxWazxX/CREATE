/**
 * Runs the Supabase migration against an embedded Postgres (PGlite) with
 * minimal stubs of Supabase's `auth` and `storage` schemas, then exercises
 * triggers, RPCs and Row Level Security.
 *
 *   npx tsx scripts/test-schema.ts
 */
import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const STUBS = `
create role anon nologin;
create role authenticated nologin;
create role service_role nologin bypassrls;
grant usage on schema public to service_role;
create schema auth;
create table auth.users (id uuid primary key, email text, raw_user_meta_data jsonb default '{}');
create or replace function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
$$;
create schema storage;
create table storage.buckets (id text primary key, name text, public boolean);
create table storage.objects (id uuid primary key default gen_random_uuid(), bucket_id text, name text);
alter table storage.objects enable row level security;
create or replace function storage.foldername(name text) returns text[] language sql immutable as $$
  select (string_to_array(name, '/'))[1:array_length(string_to_array(name, '/'), 1) - 1]
$$;
grant usage on schema auth, storage, public to authenticated;
grant execute on function auth.uid() to authenticated;
`;

const A = "11111111-1111-1111-1111-111111111111";
const B = "22222222-2222-2222-2222-222222222222";

let failures = 0;
function check(name: string, ok: boolean, extra?: unknown) {
  console.log(`${ok ? "✓" : "✗"} ${name}${!ok && extra !== undefined ? " — " + JSON.stringify(extra) : ""}`);
  if (!ok) failures++;
}

async function main() {
  const db = new PGlite();
  await db.exec(STUBS);
  const migration = (n: string) => readFileSync(join(__dirname, "../supabase/migrations", n), "utf8");
  // Supabase grants every new function/table to API roles by default; simulate that between migrations.
  const grantAll = `
    grant select, insert, update, delete on all tables in schema public to authenticated, service_role;
    grant select, insert, update, delete on storage.objects to authenticated;
  `;
  await db.exec(migration("0001_init.sql"));
  await db.exec(grantAll + "grant execute on all functions in schema public to authenticated;");
  await db.exec(migration("0002_project_shares.sql"));
  await db.exec(grantAll);
  check("migrations 0001 + 0002 applied", true);

  await db.exec(`insert into auth.users (id, email) values ('${A}', 'a@x.com'), ('${B}', 'b@x.com')`);
  const profiles = await db.query<{ n: number }>("select count(*)::int n from public.profiles");
  check("profiles created by trigger", profiles.rows[0].n === 2);

  const as = async (uid: string, sql: string, params: unknown[] = []) => {
    await db.exec(`set role authenticated; select set_config('request.jwt.claim.sub', '${uid}', false);`);
    try {
      return await db.query<Record<string, unknown>>(sql, params);
    } finally {
      await db.exec("reset role;");
    }
  };

  const T1 = "aaaaaaaa-0000-0000-0000-000000000001";
  const V1 = "bbbbbbbb-0000-0000-0000-000000000001";
  const V2 = "bbbbbbbb-0000-0000-0000-000000000002";

  const created = await as(A, "select * from public.create_track($1,$2,$3,$4,$5,$6,$7)", [
    T1,
    V1,
    "Midnight Drive",
    `users/${A}/tracks/${T1}/${V1}.wav`,
    "midnight.wav",
    1000,
    "audio/wav",
  ]);
  check("create_track returns track", created.rows[0]?.current_version_id === V1, created.rows[0]);
  check("track pulled file fields", created.rows[0]?.file_path === `users/${A}/tracks/${T1}/${V1}.wav`);

  await as(A, "update public.track_versions set status='ready', duration=120.5 where id=$1", [V1]);
  const t1 = await as(A, "select status, duration from public.tracks where id=$1", [T1]);
  check("version update pushed to track", t1.rows[0]?.status === "ready" && t1.rows[0]?.duration === 120.5, t1.rows[0]);

  const v2 = await as(A, "select * from public.add_track_version($1,$2,$3,$4,$5,$6)", [
    T1,
    V2,
    `users/${A}/tracks/${T1}/${V2}.wav`,
    "midnight v2.wav",
    2000,
    "audio/wav",
  ]);
  check("add_track_version numbers V2", v2.rows[0]?.label === "V2" && v2.rows[0]?.version_number === 2);
  const t1b = await as(A, "select version_number, file_size, status from public.tracks where id=$1", [T1]);
  check(
    "new version became current",
    t1b.rows[0]?.version_number === 2 && Number(t1b.rows[0]?.file_size) === 2000,
    t1b.rows[0],
  );

  await as(A, "update public.tracks set current_version_id=$2 where id=$1", [T1, V1]);
  const t1c = await as(A, "select version_number, duration from public.tracks where id=$1", [T1]);
  check("switch current version back to V1", t1c.rows[0]?.version_number === 1 && t1c.rows[0]?.duration === 120.5);

  await as(A, "update public.tracks set bpm=142, key='F# minor' where id=$1", [T1]);
  const act = await as(A, "select type, data from public.activity where track_id=$1 order by created_at", [T1]);
  const types = act.rows.map((r) => r.type);
  check(
    "activity logged",
    ["created", "version_added", "current_version", "edited"].every((t) => types.includes(t)),
    types,
  );

  // RLS isolation
  const bSees = await as(B, "select count(*)::int n from public.tracks");
  check("RLS: other user sees no tracks", bSees.rows[0].n === 0);
  let blocked = false;
  try {
    await as(B, "insert into public.tracks (user_id, title) values ($1, 'x')", [A]);
  } catch {
    blocked = true;
  }
  check("RLS: cannot insert rows for another user", blocked);
  const bUpd = await as(B, "update public.tracks set title='hacked' where id=$1 returning id", [T1]);
  check("RLS: cannot update other user's track", bUpd.rows.length === 0);

  // Storage policies
  const okObj = await as(A, "insert into storage.objects (bucket_id, name) values ('media', $1) returning id", [
    `users/${A}/tracks/${T1}/x.wav`,
  ]);
  check("storage: owner can write own folder", okObj.rows.length === 1);
  let stBlocked = false;
  try {
    await as(B, "insert into storage.objects (bucket_id, name) values ('media', $1)", [`users/${A}/tracks/evil.wav`]);
  } catch {
    stBlocked = true;
  }
  check("storage: cannot write into another user's folder", stBlocked);
  const bObj = await as(B, "select count(*)::int n from storage.objects");
  check("storage: cannot read another user's files", bObj.rows[0].n === 0);

  // Projects: cycle prevention + trash/restore
  const P1 = "cccccccc-0000-0000-0000-000000000001";
  const P2 = "cccccccc-0000-0000-0000-000000000002";
  await as(A, "insert into public.projects (id, name) values ($1, 'Album 2026')", [P1]);
  await as(A, "insert into public.projects (id, name, parent_id) values ($1, 'Demos', $2)", [P2, P1]);
  let cycle = false;
  try {
    await as(A, "update public.projects set parent_id=$2 where id=$1", [P1, P2]);
  } catch {
    cycle = true;
  }
  check("projects: cycles rejected", cycle);
  await as(A, "update public.tracks set project_id=$2 where id=$1", [T1, P2]);
  await as(A, "select public.trash_project($1)", [P1]);
  const trashed = await as(
    A,
    "select (select deleted_at is not null from public.tracks where id=$1) t, (select count(*)::int from public.projects where deleted_at is not null) p",
    [T1],
  );
  check(
    "trash_project trashes subtree + tracks",
    trashed.rows[0].t === true && trashed.rows[0].p === 2,
    trashed.rows[0],
  );
  await as(A, "select public.restore_project($1)", [P1]);
  const restored = await as(
    A,
    "select (select deleted_at is null from public.tracks where id=$1) t, (select count(*)::int from public.projects where deleted_at is null) p",
    [T1],
  );
  check(
    "restore_project restores subtree + tracks",
    restored.rows[0].t === true && restored.rows[0].p === 2,
    restored.rows[0],
  );

  // Tags
  await as(A, "insert into public.tags (name) values ('Trap')");
  let dupTag = false;
  try {
    await as(A, "insert into public.tags (name) values ('trap')");
  } catch {
    dupTag = true;
  }
  check("tags: case-insensitive unique", dupTag);

  // Project shares
  const legacy = await db.query<{ n: number }>("select count(*)::int n from pg_tables where tablename = 'shares'");
  check("track-level shares table removed", legacy.rows[0].n === 0);
  const sh = await as(
    A,
    "insert into public.project_shares (project_id, token, label, password_hash) values ($1, $2, 'Artist A', 'scrypt$x$y') returning id, allow_streaming, allow_mp3_download, allow_wav_download, allow_stems_download",
    [P1, "x".repeat(32)],
  );
  const d = sh.rows[0];
  check(
    "project share defaults (stream + MP3 on, WAV + stems off)",
    d.allow_streaming === true && d.allow_mp3_download === true && d.allow_wav_download === false && d.allow_stems_download === false,
    d,
  );
  let shortToken = false;
  try {
    await as(A, "insert into public.project_shares (project_id, token) values ($1, 'short')", [P1]);
  } catch {
    shortToken = true;
  }
  check("project shares: short tokens rejected", shortToken);
  const bShares = await as(B, "select count(*)::int n from public.project_shares");
  check("RLS: other user can't see project shares", bShares.rows[0].n === 0);
  let bInsert = false;
  try {
    await as(B, "insert into public.project_shares (project_id, token, user_id) values ($1, $2, $3)", [P1, "y".repeat(32), A]);
  } catch {
    bInsert = true;
  }
  check("RLS: other user can't create links for my projects", bInsert);
  let hitBlocked = false;
  try {
    await as(A, "select public.project_share_hit($1, 'view')", [d.id ?? sh.rows[0].id]);
  } catch {
    hitBlocked = true;
  }
  check("stats function not callable from the browser", hitBlocked);
  const shareId = (await db.query<{ id: string }>("select id from public.project_shares limit 1")).rows[0].id;
  await db.exec(`set role service_role; select public.project_share_hit('${shareId}', 'view'); select public.project_share_hit('${shareId}', 'play'); select public.project_share_hit('${shareId}', 'play'); select public.project_share_hit('${shareId}', 'download'); reset role;`);
  const stats = await db.query<Record<string, unknown>>("select view_count, play_count, download_count, last_viewed_at is not null as seen from public.project_shares where id = $1", [shareId]);
  const st = stats.rows[0];
  check("stats counters (server only)", st.view_count === 1 && st.play_count === 2 && st.download_count === 1 && st.seen === true, st);
  await as(
    A,
    "insert into public.email_sends (track_id, project_id, project_share_id, track_title, recipient, subject, status) values ($1,$2,$3,'Album 2026','john@x.com','New beats','sent')",
    [T1, P1, shareId],
  );
  const sentRow = await as(A, "select count(*)::int n from public.email_sends where project_share_id is not null");
  check("emails reference project links", sentRow.rows[0].n === 1);

  await db.exec(
    `alter table public.tracks disable trigger tracks_updated_at; update public.tracks set updated_at = '2020-01-01' where id = '${T1}'; alter table public.tracks enable trigger tracks_updated_at;`,
  );
  await as(A, "select public.record_play($1)", [T1]);
  const pc = await as(A, "select play_count, updated_at < '2021-01-01' as untouched from public.tracks where id=$1", [
    T1,
  ]);
  check("record_play increments", pc.rows[0].play_count === 1);
  check("plays don't count as modifications", pc.rows[0].untouched === true, pc.rows[0]);
  await as(A, "update public.tracks set genre='Drill' where id=$1", [T1]);
  const ed = await as(A, "select updated_at > '2021-01-01' as touched from public.tracks where id=$1", [T1]);
  check("edits bump updated_at", ed.rows[0].touched === true);

  // Stems + hard delete cascades cleanly
  await as(
    A,
    "insert into public.stems (track_id, kind, name, file_path) values ($1, '808', '808', 'users/a/stems/x.wav')",
    [T1],
  );
  await as(A, "delete from public.tracks where id=$1", [T1]);
  const left = await as(
    A,
    "select (select count(*)::int from public.track_versions) v, (select count(*)::int from public.stems) s, (select count(*)::int from public.activity where track_id is not null) a, (select count(*)::int from public.email_sends) e",
  );
  check(
    "hard delete cascades (versions, stems, activity) and keeps email history",
    left.rows[0].v === 0 && left.rows[0].s === 0 && left.rows[0].a === 0 && left.rows[0].e === 1,
    left.rows[0],
  );

  console.log(failures ? `\n${failures} check(s) failed` : "\nAll schema checks passed");
  process.exit(failures ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
