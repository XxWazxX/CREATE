import "server-only";

/**
 * Outgoing email, server only. Providers, in order:
 *  1. Gmail (GMAIL_USER + GMAIL_APP_PASSWORD): sends from the owner's own Gmail
 *     address over SMTP — appears in Gmail's "Sent" folder.
 *  2. Resend (RESEND_API_KEY + RESEND_FROM_EMAIL): needs a verified domain.
 * Secrets never leave the server.
 */

export type OutgoingEmail = {
  fromName: string;
  to: string;
  replyTo?: string;
  subject: string;
  html: string;
  text: string;
};

export type MailProvider = "gmail" | "resend";

function gmailCreds() {
  const user = process.env.GMAIL_USER?.trim();
  // Google shows app passwords as "abcd efgh ijkl mnop": spaces are not part of it.
  const pass = process.env.GMAIL_APP_PASSWORD?.replace(/\s+/g, "");
  return user && pass ? { user, pass } : null;
}

export function mailProvider(): MailProvider | null {
  if (gmailCreds()) return "gmail";
  if (process.env.RESEND_API_KEY && process.env.RESEND_FROM_EMAIL) return "resend";
  return null;
}

/** Address emails are sent from (for display in Settings). */
export function senderAddress(): string | null {
  const g = gmailCreds();
  if (g) return g.user;
  return process.env.RESEND_FROM_EMAIL ?? null;
}

const clean = (s: string) => s.replace(/[<>"\r\n]/g, "").trim();

function onCloudflare() {
  return typeof navigator !== "undefined" && navigator.userAgent === "Cloudflare-Workers";
}

async function sendWithGmail(m: OutgoingEmail, creds: { user: string; pass: string }) {
  if (onCloudflare()) {
    // Cloudflare Workers: SMTP over a TLS socket (port 25 is blocked, 465 is fine).
    const { smtpSend } = await import("./smtp-workers");
    const id = await smtpSend({
      host: "smtp.gmail.com",
      port: 465,
      user: creds.user,
      pass: creds.pass,
      fromName: clean(m.fromName),
      to: m.to,
      replyTo: m.replyTo && m.replyTo !== creds.user ? m.replyTo : undefined,
      subject: m.subject,
      html: m.html,
      text: m.text,
    });
    return { id };
  }
  // Node (local app).
  const nodemailer = await import("nodemailer");
  const transport = nodemailer.createTransport({
    host: "smtp.gmail.com",
    port: 465,
    secure: true,
    auth: { user: creds.user, pass: creds.pass },
  });
  const info = await transport.sendMail({
    from: { name: clean(m.fromName), address: creds.user },
    to: m.to,
    replyTo: m.replyTo && m.replyTo !== creds.user ? m.replyTo : undefined,
    subject: m.subject,
    html: m.html,
    text: m.text,
  });
  return { id: info.messageId ?? null };
}

async function sendWithResend(m: OutgoingEmail) {
  const { Resend } = await import("resend");
  const resend = new Resend(process.env.RESEND_API_KEY);
  const { data, error } = await resend.emails.send({
    from: `${clean(m.fromName)} <${process.env.RESEND_FROM_EMAIL}>`,
    to: [m.to],
    replyTo: m.replyTo,
    subject: m.subject,
    html: m.html,
    text: m.text,
    tags: [{ name: "app", value: "create" }],
  });
  if (error) throw new Error(error.message);
  return { id: data?.id ?? null };
}

/** Readable French message for the usual Gmail failures. */
function explain(e: unknown): Error {
  const msg = e instanceof Error ? e.message : String(e);
  if (/535|Username and Password not accepted|BadCredentials|Invalid login/i.test(msg)) {
    return new Error(
      "Gmail refuse l'identifiant : vérifie GMAIL_USER et le mot de passe d'application (GMAIL_APP_PASSWORD), pas ton mot de passe Gmail habituel.",
    );
  }
  if (/limit|quota|550 5\.4\.5/i.test(msg)) return new Error("Limite d'envoi Gmail atteinte pour aujourd'hui.");
  return e instanceof Error ? e : new Error(msg);
}

export async function sendEmail(m: OutgoingEmail): Promise<{ id: string | null; provider: MailProvider }> {
  const provider = mailProvider();
  if (!provider) {
    throw new Error("L'envoi d'e-mails n'est pas configuré : ajoute GMAIL_USER et GMAIL_APP_PASSWORD.");
  }
  try {
    const r = provider === "gmail" ? await sendWithGmail(m, gmailCreds()!) : await sendWithResend(m);
    return { ...r, provider };
  } catch (e) {
    throw explain(e);
  }
}
