import { mailProvider, senderAddress } from "@/lib/email/mailer";
import { createClient } from "@/lib/supabase/server";

/** Tells the settings page whether email sending is configured (never returns the key). */
export async function GET() {
  const supabase = await createClient();
  const { data } = await supabase.auth.getUser();
  if (!data.user) return Response.json({ error: "Non autorisé" }, { status: 401 });
  return Response.json({
    configured: mailProvider() !== null,
    provider: mailProvider(),
    from: senderAddress(),
    appUrl: process.env.NEXT_PUBLIC_APP_URL ?? null,
  });
}
