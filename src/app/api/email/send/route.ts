import { z } from "zod";
import { mailProvider, sendEmail } from "@/lib/email/mailer";
import { renderProjectEmail } from "@/lib/email/template";
import { createClient } from "@/lib/supabase/server";
import { DEFAULT_SETTINGS, type Settings } from "@/lib/types";

const Body = z.object({
  shareId: z.uuid(),
  recipients: z.array(z.email()).min(1).max(20),
  subject: z.string().trim().min(1).max(200),
  message: z.string().max(5000),
});

/** Public address for emailed links: the serving address online, NEXT_PUBLIC_APP_URL from a local run. */
function appUrl(req: Request) {
  const u = new URL(req.url);
  const local = /^(localhost|127\.0\.0\.1|\[::1\])$/.test(u.hostname);
  return ((local && process.env.NEXT_PUBLIC_APP_URL) || u.origin).replace(/\/$/, "");
}

/**
 * Emails a project link (Gmail or Resend, see lib/email/mailer — secrets stay on the server).
 * The email points to /p/{token}: the whole project, never a single track.
 */
export async function POST(req: Request) {
  if (!mailProvider()) {
    return Response.json(
      { error: "L'envoi d'e-mails n'est pas configuré : ajoute GMAIL_USER et GMAIL_APP_PASSWORD." },
      { status: 500 },
    );
  }

  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return Response.json({ error: "Non autorisé" }, { status: 401 });

  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return Response.json({ error: parsed.error.issues.map((i) => i.message).join(", ") }, { status: 400 });
  }
  const { shareId, recipients, subject, message } = parsed.data;

  // RLS: the link and the project must belong to the signed-in owner.
  const { data: share } = await supabase
    .from("project_shares")
    .select("id, token, project_id, password_hash, expires_at")
    .eq("id", shareId)
    .maybeSingle();
  if (!share) return Response.json({ error: "Lien introuvable" }, { status: 404 });
  if (share.expires_at && new Date(share.expires_at) <= new Date()) {
    return Response.json({ error: "Ce lien a expiré : crée un nouveau lien avant d'envoyer." }, { status: 409 });
  }
  const [{ data: project }, { data: tracks }, { data: profile }] = await Promise.all([
    supabase.from("projects").select("id, name, cover_path").eq("id", share.project_id).maybeSingle(),
    supabase
      .from("tracks")
      .select("title")
      .eq("project_id", share.project_id)
      .is("deleted_at", null)
      .not("file_path", "is", null)
      .order("created_at", { ascending: true }),
    supabase.from("profiles").select("display_name, settings").eq("id", auth.user.id).maybeSingle(),
  ]);
  if (!project) return Response.json({ error: "Projet introuvable" }, { status: 404 });

  const settings: Settings["email"] = {
    ...DEFAULT_SETTINGS.email,
    ...((profile?.settings as Settings | null)?.email ?? {}),
  };
  const senderName = settings.fromName || profile?.display_name || auth.user.email?.split("@")[0] || "Moi";
  const replyTo = settings.replyTo || auth.user.email || undefined;
  const base = appUrl(req);
  const titles = (tracks ?? []).map((t) => t.title as string);

  const { html, text } = renderProjectEmail({
    projectName: project.name,
    trackCount: titles.length,
    trackTitles: titles,
    message,
    signature: settings.signature,
    senderName,
    coverUrl: project.cover_path ? `${base}/api/p/${share.token}/cover` : null,
    listenUrl: `${base}/p/${share.token}`,
    passwordProtected: !!share.password_hash,
    expiresLabel: share.expires_at
      ? new Date(share.expires_at).toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" })
      : null,
  });

  const results: { recipient: string; ok: boolean; error?: string }[] = [];
  for (const recipient of recipients) {
    const { data: row } = await supabase
      .from("email_sends")
      .insert({
        project_id: project.id,
        project_share_id: share.id,
        track_title: project.name,
        recipient,
        subject,
        message,
        html,
        options: { kind: "project" },
        status: "queued",
      })
      .select("id")
      .single();

    let error: string | null = null;
    let providerId: string | null = null;
    try {
      const sent = await sendEmail({ fromName: senderName, to: recipient, replyTo, subject, html, text });
      providerId = sent.id;
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    }
    if (row) {
      await supabase
        .from("email_sends")
        .update(error ? { status: "failed", error } : { status: "sent", provider_id: providerId })
        .eq("id", row.id);
    }
    results.push(error ? { recipient, ok: false, error } : { recipient, ok: true });
  }

  const failed = results.filter((r) => !r.ok);
  if (failed.length === results.length) {
    return Response.json({ error: failed[0]?.error ?? "Échec de l'envoi", results }, { status: 502 });
  }
  return Response.json({ results });
}
