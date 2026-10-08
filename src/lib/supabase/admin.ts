import "server-only";

import { createClient } from "@supabase/supabase-js";

/** Secret as pasted in a dashboard, minus accidental whitespace / quotes. */
export function serviceRoleKey(): string | undefined {
  const raw = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!raw) return undefined;
  return raw.trim().replace(/^["']|["']$/g, "").trim();
}

/**
 * Service-role client. Bypasses RLS — only for server code that must serve
 * public share pages. Never import this from a client component.
 */
export function createAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = serviceRoleKey();
  if (!url || !key) throw new Error("SUPABASE_SERVICE_ROLE_KEY is not configured");
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}
