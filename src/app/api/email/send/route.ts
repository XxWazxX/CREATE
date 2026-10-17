import { z } from "zod";
import { hashToken, newTrackingToken } from "@/lib/analytics/tracking-server";
import { mailProvider, sendEmail } from "@/lib/email/mailer";
import { renderProjectEmail, type EmailTrack } from "@/lib/email/template";
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
  const { shareId, subject, message } = parsed.data;
  // One email per distinct address (case-insensitive).
  const recipients = [...new Set(parsed.data.recipients.map((r) => r.trim().toLowerCase()))];

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
      .select("id, title, bpm, key, duration, cover_path, current_version_id")
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
  const design = (profile?.settings as Settings | null)?.emailDesign ?? null;
  const base = appUrl(req);
  const titles = (tracks ?? []).map((t) => t.title as string);
  // Waveforms for the Studio layout (peaks of each prod's current version).
  const versionIds = (tracks ?? []).map((t) => t.current_version_id as string | null).filter((x): x is string => !!x);
  const { data: versions } = versionIds.length
    ? await supabase.from("track_versions").select("id, peaks").in("id", versionIds)
    : { data: [] };
  const peaksOf = new Map((versions ?? []).map((v) => [v.id as string, (v.peaks as number[] | null) ?? null]));
  const projectCover = project.cover_path ? `${base}/api/p/${share.token}/cover` : null;
  /** One row per prod; each ▶ opens the listening page on that prod (through the tracked link). */
  const emailTracks = (listenUrl: string): EmailTrack[] =>
    (tracks ?? []).map((t) => ({
      id: t.id as string,
      title: t.title as string,
      bpm: t.bpm == null ? null : Number(t.bpm),
      key: (t.key as string | null) ?? null,
      duration: (t.duration as number | null) ?? null,
      peaks: t.current_version_id ? (peaksOf.get(t.current_version_id as string) ?? null) : null,
      coverUrl: t.cover_path ? `${base}/api/p/${share.token}/cover?track=${t.id}` : projectCover,
      playUrl: `${listenUrl}?t=${t.id}`,
    }));

  // Names come from the owner's address book (RLS), never from the request.
  // Missing table (migration not applied yet) just means no names.
  const { data: known } = await supabase.from("artists").select("artist_name, email").in("email", recipients);
  const artistName = new Map((known ?? []).map((a) => [a.email as string, a.artist_name as string]));

  const emailFor = (listenUrl: string, trackingPixelUrl: string | null) =>
    renderProjectEmail({
      projectName: project.name,
      trackCount: titles.length,
      trackTitles: titles,
      message,
      signature: settings.signature,
      instagram: settings.instagram,
      senderName,
      listenUrl,
      trackingPixelUrl,
      tracks: emailTracks(listenUrl),
      design,
      coverUrl: projectCover,
      heroUrl: `${base}/brand/studio.jpg`,
      logoUrl: design?.logoPath ? `${base}/api/p/${share.token}/logo` : null,
      passwordProtected: !!share.password_hash,
      expiresLabel: share.expires_at
        ? new Date(share.expires_at).toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" })
        : null,
    });
  // Copy kept in the history: plain link, no pixel (viewing it in "Envoyés" must not count as an open).
  const archived = emailFor(`${base}/p/${share.token}`, null).html;

  const results: { recipient: string; ok: boolean; error?: string }[] = [];
  for (const recipient of recipients) {
    // Each email has its own random token: tracked link (/l/…) + open pixel (/api/t/o/…).
    const tracking = newTrackingToken();
    const row0 = {
      project_id: project.id,
      project_share_id: share.id,
      track_title: project.name,
      recipient,
      subject,
      message,
      html: archived,
      options: { kind: "project", artist_name: artistName.get(recipient) ?? null },
      status: "queued",
    };
    let tracked = true;
    const first = await supabase
      .from("email_sends")
      .insert({ ...row0, tracking_token_hash: hashToken(tracking) })
      .select("id")
      .single();
    let row = first.data;
    if (first.error && /tracking_token_hash/.test(first.error.message)) {
      // Analytics migration (0004) not applied yet: send untracked rather than not at all.
      tracked = false;
      ({ data: row } = await supabase.from("email_sends").insert(row0).select("id").single());
    }
    const { html, text } = tracked
      ? emailFor(`${base}/l/${tracking}`, `${base}/api/t/o/${tracking}`)
      : emailFor(`${base}/p/${share.token}`, null);

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
