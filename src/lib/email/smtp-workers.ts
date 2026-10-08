import "server-only";

/**
 * Minimal SMTP client for Cloudflare Workers (implicit TLS, AUTH PLAIN),
 * built on `cloudflare:sockets`. Just what sending a mail through Gmail
 * (smtp.gmail.com:465) needs — no dependency, no Node APIs.
 */

export type SmtpMessage = {
  host: string;
  port: number;
  user: string;
  pass: string;
  fromName: string;
  to: string;
  replyTo?: string;
  subject: string;
  html: string;
  text: string;
};

const enc = new TextEncoder();

function b64(s: string): string {
  const bytes = enc.encode(s);
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

/** RFC 2047 encoded-word for non-ASCII header text. */
function header(s: string) {
  return /^[\x20-\x7e]*$/.test(s) ? s : `=?UTF-8?B?${b64(s)}?=`;
}

function wrap76(s: string) {
  return s.replace(/.{1,76}/g, "$&\r\n").trimEnd();
}

const addr = (s: string) => s.replace(/[<>\r\n\s]/g, "");

export function buildMime(m: SmtpMessage): string {
  const boundary = `create-${crypto.randomUUID()}`;
  const domain = m.user.split("@")[1] ?? "localhost";
  const lines = [
    `From: ${header(m.fromName.replace(/["\r\n]/g, ""))} <${addr(m.user)}>`,
    `To: <${addr(m.to)}>`,
    ...(m.replyTo ? [`Reply-To: <${addr(m.replyTo)}>`] : []),
    `Subject: ${header(m.subject.replace(/[\r\n]/g, " "))}`,
    `Date: ${new Date().toUTCString().replace("GMT", "+0000")}`,
    `Message-ID: <${crypto.randomUUID()}@${domain}>`,
    "MIME-Version: 1.0",
    `Content-Type: multipart/alternative; boundary="${boundary}"`,
    "",
    `--${boundary}`,
    "Content-Type: text/plain; charset=UTF-8",
    "Content-Transfer-Encoding: base64",
    "",
    wrap76(b64(m.text)),
    `--${boundary}`,
    "Content-Type: text/html; charset=UTF-8",
    "Content-Transfer-Encoding: base64",
    "",
    wrap76(b64(m.html)),
    `--${boundary}--`,
    "",
  ];
  // Base64 bodies never start a line with ".", so no dot-stuffing is needed.
  return lines.join("\r\n");
}

export async function smtpSend(m: SmtpMessage, timeoutMs = 25_000): Promise<string> {
  const { connect } = await import(/* webpackIgnore: true */ /* turbopackIgnore: true */ "cloudflare:sockets");
  const socket = connect({ hostname: m.host, port: m.port }, { secureTransport: "on" });
  const writer = socket.writable.getWriter();
  const reader = socket.readable.getReader();
  const dec = new TextDecoder();
  let buf = "";

  async function reply(): Promise<{ code: number; text: string }> {
    for (;;) {
      const lines = buf.split("\r\n");
      for (let i = 0; i < lines.length - 1; i++) {
        if (/^\d{3} /.test(lines[i])) {
          const text = lines.slice(0, i + 1).join("\n");
          buf = lines.slice(i + 1).join("\r\n");
          return { code: Number(lines[i].slice(0, 3)), text };
        }
      }
      const { value, done } = await reader.read();
      if (done) throw new Error("Connexion SMTP fermée par le serveur");
      buf += dec.decode(value, { stream: true });
    }
  }

  async function expect(codes: number[], line?: string) {
    if (line !== undefined) await writer.write(enc.encode(line + "\r\n"));
    const r = await reply();
    if (!codes.includes(r.code)) throw new Error(`SMTP ${r.code} ${r.text}`);
    return r;
  }

  const session = (async () => {
    await expect([220]);
    await expect([250], "EHLO create.app");
    await expect([235], `AUTH PLAIN ${b64(`\0${m.user}\0${m.pass}`)}`);
    await expect([250], `MAIL FROM:<${addr(m.user)}>`);
    await expect([250, 251], `RCPT TO:<${addr(m.to)}>`);
    await expect([354], "DATA");
    const done = await expect([250], buildMime(m) + "\r\n.");
    await expect([221], "QUIT").catch(() => undefined);
    return done.text;
  })();

  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, rej) => {
    timer = setTimeout(() => rej(new Error("Délai dépassé en contactant le serveur e-mail")), timeoutMs);
  });
  try {
    return await Promise.race([session, timeout]);
  } finally {
    clearTimeout(timer);
    await socket.close().catch(() => undefined);
  }
}
