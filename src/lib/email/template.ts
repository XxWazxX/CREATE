/**
 * Project email template — table-based HTML that renders consistently in Gmail,
 * Apple Mail and Outlook. Pure function: used by the server to send and by
 * the composer to preview.
 */

function esc(s: string) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function paragraphs(text: string) {
  return text
    .trim()
    .split(/\n{2,}/)
    .map(
      (p) =>
        `<p style="margin:0 0 14px;font-size:15px;line-height:1.6;color:#2b2b2f;">${esc(p).replace(/\n/g, "<br>")}</p>`,
    )
    .join("");
}

function button(href: string, label: string, primary: boolean) {
  const bg = primary ? "#0b0b0c" : "#ffffff";
  const fg = primary ? "#ffffff" : "#0b0b0c";
  const border = primary ? "#0b0b0c" : "#d9d9de";
  return `<a href="${esc(href)}" target="_blank" style="display:inline-block;padding:12px 22px;margin:0 8px 8px 0;border-radius:999px;background:${bg};color:${fg};border:1px solid ${border};font-size:13px;font-weight:600;letter-spacing:0.04em;text-decoration:none;">${esc(label)}</a>`;
}

// ---------------------------------------------------------------------------
// Project link email
// ---------------------------------------------------------------------------

export type ProjectEmailInput = {
  projectName: string;
  trackCount: number;
  trackTitles: string[];
  message: string;
  signature: string;
  senderName: string;
  coverUrl?: string | null;
  listenUrl: string;
  passwordProtected?: boolean;
  expiresLabel?: string | null;
};

export function renderProjectEmail(i: ProjectEmailInput): { html: string; text: string } {
  const count = `${i.trackCount} production${i.trackCount > 1 ? "s" : ""}`;
  const shown = i.trackTitles.slice(0, 6);
  const more = i.trackTitles.length - shown.length;
  const cover = i.coverUrl
    ? `<img src="${esc(i.coverUrl)}" width="96" height="96" alt="" style="display:block;width:96px;height:96px;border-radius:12px;object-fit:cover;background:#ececef;">`
    : `<div style="width:96px;height:96px;border-radius:12px;background:#141416;"></div>`;
  const list = shown.length
    ? `<tr><td colspan="2" style="padding:0 16px 14px;">${shown
        .map(
          (t, n) =>
            `<div style="font-size:13px;color:#2b2b2f;line-height:1.9;"><span style="display:inline-block;width:24px;color:#a0a0a8;font-family:ui-monospace,Menlo,Consolas,monospace;font-size:11px;">${String(n + 1).padStart(2, "0")}</span>${esc(t)}</div>`,
        )
        .join(
          "",
        )}${more > 0 ? `<div style="font-size:12px;color:#8a8a92;padding-left:24px;">+ ${more} autre${more > 1 ? "s" : ""}</div>` : ""}</td></tr>`
    : "";
  const notes = [
    i.passwordProtected ? "Lien protégé par mot de passe." : null,
    i.expiresLabel ? `Lien valable jusqu’au ${i.expiresLabel}.` : null,
  ]
    .filter(Boolean)
    .join(" ");

  const html = `<!doctype html>
<html lang="fr">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light only"><title>${esc(i.projectName)}</title></head>
<body style="margin:0;padding:0;background:#f5f5f7;">
<span style="display:none!important;opacity:0;color:transparent;max-height:0;overflow:hidden;">${esc(i.projectName)} — ${count}</span>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f5f5f7;">
  <tr><td align="center" style="padding:32px 16px;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#ffffff;border-radius:18px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;">
      <tr><td style="padding:32px 32px 8px;">${paragraphs(i.message)}</td></tr>
      <tr><td style="padding:8px 32px;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #ececef;border-radius:14px;">
          <tr>
            <td style="padding:16px;" width="96" valign="top"><a href="${esc(i.listenUrl)}" target="_blank" style="text-decoration:none;">${cover}</a></td>
            <td style="padding:16px 16px 16px 0;" valign="middle">
              <div style="font-size:11px;letter-spacing:0.12em;color:#8a8a92;text-transform:uppercase;">Projet</div>
              <div style="font-size:20px;font-weight:700;color:#0b0b0c;line-height:1.3;margin-top:2px;">${esc(i.projectName)}</div>
              <div style="font-size:13px;color:#6b6b73;margin-top:4px;">${count}</div>
            </td>
          </tr>
          ${list}
        </table>
      </td></tr>
      <tr><td style="padding:16px 32px 4px;">${button(i.listenUrl, "ÉCOUTER LE PROJET", true)}</td></tr>
      ${notes ? `<tr><td style="padding:4px 32px 0;font-size:12px;color:#8a8a92;">${esc(notes)}</td></tr>` : ""}
      <tr><td style="padding:16px 32px 32px;">${paragraphs(i.signature ? `${i.signature}\n${i.senderName}` : i.senderName)}</td></tr>
    </table>
    <p style="margin:16px 0 0;font-family:-apple-system,'Segoe UI',Helvetica,Arial,sans-serif;font-size:11px;color:#a0a0a8;">Lien privé — merci de ne pas le partager publiquement.</p>
  </td></tr>
</table>
</body>
</html>`;

  const text = [
    i.message.trim(),
    "",
    `${i.projectName} — ${count}`,
    ...shown.map((t, n) => `${String(n + 1).padStart(2, "0")}  ${t}`),
    more > 0 ? `+ ${more} autre${more > 1 ? "s" : ""}` : "",
    "",
    `Écouter : ${i.listenUrl}`,
    notes,
    "",
    i.signature,
    i.senderName,
  ]
    .filter((l, idx, arr) => !(l === "" && arr[idx - 1] === ""))
    .join("\n")
    .trim();

  return { html, text };
}
