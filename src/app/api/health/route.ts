import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Deployment check: which variables the server sees (true/false only — never
 * values) and whether the database answers. Safe to expose publicly.
 */
export async function GET() {
  const env = {
    NEXT_PUBLIC_SUPABASE_URL: !!process.env.NEXT_PUBLIC_SUPABASE_URL,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: !!process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    SUPABASE_SERVICE_ROLE_KEY: !!process.env.SUPABASE_SERVICE_ROLE_KEY,
    OWNER_EMAIL: !!process.env.OWNER_EMAIL,
    APP_ACCESS_CODE: !!process.env.APP_ACCESS_CODE,
    RESEND_API_KEY: !!process.env.RESEND_API_KEY,
    RESEND_FROM_EMAIL: !!process.env.RESEND_FROM_EMAIL,
  };
  let database = "unknown";
  try {
    const { error, status } = await createAdminClient().from("project_shares").select("id").limit(1);
    database = error ? `error ${status}: ${error.code ?? ""} ${error.message} ${error.hint ?? ""}`.slice(0, 200) : "ok";
  } catch (e) {
    database = `error: ${e instanceof Error ? e.message : String(e)}`.slice(0, 160);
  }
  return Response.json({ env, database }, { headers: { "Cache-Control": "no-store" } });
}
