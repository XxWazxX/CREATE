"use client";

import { createBrowserClient } from "@supabase/ssr";
import { SUPABASE_ANON_KEY, SUPABASE_URL } from "@/lib/public-env";
import type { SupabaseClient } from "@supabase/supabase-js";

let client: SupabaseClient | undefined;

/** Browser Supabase client (singleton). Uses the anon key + the user's session; RLS applies. */
export function supabase(): SupabaseClient {
  if (!client) {
    client = createBrowserClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  }
  return client;
}

let cachedUserId: string | null = null;

/** Current user id (cached after the first lookup). */
export async function currentUserId(): Promise<string> {
  if (cachedUserId) return cachedUserId;
  const { data } = await supabase().auth.getSession();
  const id = data.session?.user.id;
  if (!id) throw new Error("Session introuvable");
  cachedUserId = id;
  return id;
}

export async function accessToken(): Promise<string> {
  const { data } = await supabase().auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new Error("Session introuvable");
  return token;
}
