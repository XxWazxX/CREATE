"use client";

import { useQuery } from "@tanstack/react-query";
import { ARTIST_EMAIL_RE, cleanName, type ArtistEntry } from "@/lib/artists/parse";
import { getQueryClient, qk } from "@/lib/data/client";
import { supabase } from "@/lib/supabase/client";
import type { Artist, ArtistFolder } from "@/lib/types";

/** Readable message, including the "migration not applied yet" case. */
export function artistDbError(e: unknown): Error {
  const err = e as { code?: string; message?: string } | null;
  const msg = err?.message ?? String(e);
  if (
    err?.code === "42P01" ||
    err?.code === "PGRST205" ||
    (/artists/.test(msg) && /does not exist|schema cache/.test(msg))
  ) {
    return new Error(
      "Il manque la table « artists » : exécute supabase/migrations/0003_artists.sql dans Supabase → SQL Editor.",
    );
  }
  if (err?.code === "23505") return new Error("Cette adresse e-mail est déjà dans tes artistes.");
  if (err?.code === "23514") return new Error("Nom ou adresse e-mail invalide.");
  return e instanceof Error ? e : new Error(msg);
}

/** Column / table missing because migration 0005 (folders) isn't applied yet. */
const foldersMissing = (e: { code?: string; message?: string } | null) =>
  !!e && (e.code === "42703" || e.code === "PGRST204" || e.code === "PGRST205" || /folder/.test(e.message ?? ""));

export async function fetchArtists(): Promise<Artist[]> {
  const out: Artist[] = [];
  let columns = "id, artist_name, email, created_at, folder_id";
  // PostgREST caps a response at 1000 rows: page through.
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase()
      .from("artists")
      .select(columns)
      .order("artist_name")
      .order("email")
      .range(from, from + 999);
    if (error && from === 0 && columns.includes("folder_id") && foldersMissing(error)) {
      columns = "id, artist_name, email, created_at"; // before migration 0005: no folders
      from -= 1000;
      continue;
    }
    if (error) throw artistDbError(error);
    out.push(...((data ?? []) as unknown as Artist[]).map((a) => ({ ...a, folder_id: a.folder_id ?? null })));
    if (!data || data.length < 1000) return out;
  }
}

// ---------------------------------------------------------------------------
// Folders
// ---------------------------------------------------------------------------

export type FoldersState = { available: boolean; folders: ArtistFolder[] };

export async function fetchArtistFolders(): Promise<FoldersState> {
  const { data, error } = await supabase().from("artist_folders").select("id, name, created_at").order("name");
  if (error && foldersMissing(error)) return { available: false, folders: [] };
  if (error) throw artistDbError(error);
  return { available: true, folders: (data ?? []) as ArtistFolder[] };
}

export function useArtistFolders() {
  return useQuery({ queryKey: qk.artistFolders, queryFn: fetchArtistFolders, staleTime: 60_000, retry: false });
}

const refreshFolders = () =>
  Promise.all([
    getQueryClient().invalidateQueries({ queryKey: qk.artistFolders }),
    getQueryClient().invalidateQueries({ queryKey: qk.artists }),
  ]);

function folderName(name: string) {
  const n = name.replace(/\s+/g, " ").trim().slice(0, 80);
  if (!n) throw new Error("Donne un nom au dossier.");
  return n;
}

function folderError(e: { code?: string; message?: string }) {
  if (e.code === "23505") return new Error("Un dossier porte déjà ce nom.");
  if (foldersMissing(e))
    return new Error(
      "Il manque les dossiers d’artistes : exécute supabase/migrations/0005_artist_folders.sql dans Supabase → SQL Editor.",
    );
  return artistDbError(e);
}

export async function createArtistFolder(name: string): Promise<ArtistFolder> {
  const { data, error } = await supabase()
    .from("artist_folders")
    .insert({ name: folderName(name) })
    .select("id, name, created_at")
    .single();
  if (error) throw folderError(error);
  await refreshFolders();
  return data as ArtistFolder;
}

export async function renameArtistFolder(id: string, name: string) {
  const { error } = await supabase()
    .from("artist_folders")
    .update({ name: folderName(name) })
    .eq("id", id);
  if (error) throw folderError(error);
  await refreshFolders();
}

/** Deletes the folder only: its artists stay, without folder. */
export async function deleteArtistFolder(id: string) {
  const { error } = await supabase().from("artist_folders").delete().eq("id", id);
  if (error) throw folderError(error);
  await refreshFolders();
}

export async function moveArtists(ids: string[], folderId: string | null) {
  for (let i = 0; i < ids.length; i += 200) {
    const { error } = await supabase()
      .from("artists")
      .update({ folder_id: folderId })
      .in("id", ids.slice(i, i + 200));
    if (error) throw folderError(error);
  }
  await refreshFolders();
}

export function useArtists() {
  return useQuery({ queryKey: qk.artists, queryFn: fetchArtists, staleTime: 60_000, retry: false });
}

function validated(input: { artist_name: string; email: string }) {
  const artist_name = cleanName(input.artist_name);
  const email = input.email.trim().toLowerCase();
  if (!artist_name) throw new Error("Le nom de l'artiste est obligatoire.");
  if (!ARTIST_EMAIL_RE.test(email) || email.length > 254) throw new Error("Adresse e-mail invalide.");
  return { artist_name, email };
}

const refresh = () => getQueryClient().invalidateQueries({ queryKey: qk.artists });

export async function createArtist(input: { artist_name: string; email: string; folder_id?: string | null }) {
  const { error } = await supabase()
    .from("artists")
    .insert({ ...validated(input), ...(input.folder_id ? { folder_id: input.folder_id } : {}) });
  if (error) throw artistDbError(error);
  await refresh();
}

export async function updateArtist(
  id: string,
  input: { artist_name: string; email: string; folder_id?: string | null },
) {
  const { error } = await supabase()
    .from("artists")
    .update({ ...validated(input), ...(input.folder_id !== undefined ? { folder_id: input.folder_id } : {}) })
    .eq("id", id);
  if (error) throw artistDbError(error);
  await refresh();
}

export async function deleteArtists(ids: string[]) {
  for (let i = 0; i < ids.length; i += 200) {
    const { error } = await supabase()
      .from("artists")
      .delete()
      .in("id", ids.slice(i, i + 200));
    if (error) throw artistDbError(error);
  }
  await refresh();
}

/**
 * Saves imported entries. Addresses already in the base are either left as they
 * are ("keep") or get the name from the file ("update"); nothing is duplicated.
 */
export async function importArtists(entries: ArtistEntry[], mode: "keep" | "update", folderId: string | null = null) {
  // With "update", addresses already in the base also move to the chosen folder.
  const rows = entries.map((e) => ({ ...validated(e), ...(folderId ? { folder_id: folderId } : {}) }));
  for (let i = 0; i < rows.length; i += 500) {
    const { error } = await supabase()
      .from("artists")
      .upsert(rows.slice(i, i + 500), { onConflict: "user_id,email", ignoreDuplicates: mode === "keep" });
    if (error) throw artistDbError(error);
  }
  await refresh();
}

const foldText = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

/** Search by name or email, accent- and case-insensitive (every word must match). */
export function filterArtists(list: Artist[], query: string): Artist[] {
  const words = foldText(query).split(/\s+/).filter(Boolean);
  if (!words.length) return list;
  return list.filter((a) => {
    const hay = foldText(`${a.artist_name} ${a.email}`);
    return words.every((w) => hay.includes(w));
  });
}
