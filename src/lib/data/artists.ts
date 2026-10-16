"use client";

import { useQuery } from "@tanstack/react-query";
import { ARTIST_EMAIL_RE, cleanName, type ArtistEntry } from "@/lib/artists/parse";
import { getQueryClient, qk } from "@/lib/data/client";
import { supabase } from "@/lib/supabase/client";
import type { Artist } from "@/lib/types";

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

export async function fetchArtists(): Promise<Artist[]> {
  const out: Artist[] = [];
  // PostgREST caps a response at 1000 rows: page through.
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase()
      .from("artists")
      .select("id, artist_name, email, created_at")
      .order("artist_name")
      .order("email")
      .range(from, from + 999);
    if (error) throw artistDbError(error);
    out.push(...((data ?? []) as Artist[]));
    if (!data || data.length < 1000) return out;
  }
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

export async function createArtist(input: { artist_name: string; email: string }) {
  const { error } = await supabase().from("artists").insert(validated(input));
  if (error) throw artistDbError(error);
  await refresh();
}

export async function updateArtist(id: string, input: { artist_name: string; email: string }) {
  const { error } = await supabase().from("artists").update(validated(input)).eq("id", id);
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
export async function importArtists(entries: ArtistEntry[], mode: "keep" | "update") {
  const rows = entries.map(validated);
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
