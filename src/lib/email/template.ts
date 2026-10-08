/**
 * Project email template — plain personal-looking HTML (better
 * deliverability than a newsletter layout). Pure function: used by the server to send and by
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
  listenUrl: string;
  passwordProtected?: boolean;
  expiresLabel?: string | null;
};

export function renderProjectEmail(i: ProjectEmailInput): { html: string; text: string } {
  // Deliberately plain, like a hand-written Gmail message: no hidden preheader, no remote
  // image, no layout tables or button — newsletter-looking mail is what spam filters flag.
  const count = `${i.trackCount} production${i.trackCount > 1 ? "s" : ""}`;
  const shown = i.trackTitles.slice(0, 6);
  const more = i.trackTitles.length - shown.length;
  const moreLabel = more > 0 ? `+ ${more} autre${more > 1 ? "s" : ""}` : "";
  const notes = [
    i.passwordProtected ? "Lien protégé par mot de passe." : null,
    i.expiresLabel ? `Lien valable jusqu’au ${i.expiresLabel}.` : null,
  ]
    .filter(Boolean)
    .join(" ");
  const list = [...shown.map(esc), moreLabel].filter(Boolean).join("<br>");

  const html = `<div dir="ltr" style="font-family:Arial,Helvetica,sans-serif;">
${paragraphs(i.message)}
<p style="margin:0 0 14px;font-size:15px;line-height:1.6;color:#2b2b2f;"><b>${esc(i.projectName)}</b> (${count})${list ? `<br>${list}` : ""}</p>
<p style="margin:0 0 14px;font-size:15px;line-height:1.6;color:#2b2b2f;"><a href="${esc(i.listenUrl)}">Écouter le projet</a>${notes ? `<br><span style="font-size:13px;color:#666;">${esc(notes)}</span>` : ""}</p>
${paragraphs(i.signature ? `${i.signature}\n${i.senderName}` : i.senderName)}
</div>`;

  const text = [
    i.message.trim(),
    "",
    `${i.projectName} (${count})`,
    ...shown,
    moreLabel,
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
