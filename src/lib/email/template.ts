/**
 * Project email template. The default design is plain, personal-looking HTML
 * (better deliverability than a newsletter layout); colors, font, button, cover
 * and logo come from Settings → E-mail → Design. Pure function: used by the
 * server to send and by Settings / the composer to preview.
 */

import { DEFAULT_EMAIL_DESIGN, EMAIL_FONTS, type EmailDesign } from "@/lib/types";

function esc(s: string) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/** Design values come from user settings: never trust them inside style attributes. */
function color(v: unknown, fallback: string) {
  return typeof v === "string" && /^#[0-9a-f]{6}$/i.test(v) ? v : fallback;
}

export function normalizeDesign(d: Partial<EmailDesign> | null | undefined): EmailDesign {
  const x = { ...DEFAULT_EMAIL_DESIGN, ...(d ?? {}) };
  return {
    font: x.font in EMAIL_FONTS ? x.font : DEFAULT_EMAIL_DESIGN.font,
    textColor: color(x.textColor, DEFAULT_EMAIL_DESIGN.textColor),
    accentColor: color(x.accentColor, DEFAULT_EMAIL_DESIGN.accentColor),
    background: color(x.background, DEFAULT_EMAIL_DESIGN.background),
    cta: x.cta === "button" ? "button" : "link",
    ctaLabel: String(x.ctaLabel ?? "").trim().slice(0, 60) || DEFAULT_EMAIL_DESIGN.ctaLabel,
    showCover: !!x.showCover,
    logoPath: typeof x.logoPath === "string" && x.logoPath ? x.logoPath : null,
    logoWidth: Math.min(300, Math.max(40, Math.round(Number(x.logoWidth) || DEFAULT_EMAIL_DESIGN.logoWidth))),
    logoAlign: x.logoAlign === "center" ? "center" : "left",
  };
}

/** Black or white text, whichever reads better on the given background. */
function onColor(hex: string) {
  const n = parseInt(hex.slice(1), 16);
  const lum = (0.299 * ((n >> 16) & 255) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) / 255;
  return lum > 0.6 ? "#111111" : "#ffffff";
}

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
  design?: Partial<EmailDesign> | null;
  /** Public URLs of the images (only used when the design shows them). */
  coverUrl?: string | null;
  logoUrl?: string | null;
};

export function renderProjectEmail(i: ProjectEmailInput): { html: string; text: string } {
  const d = normalizeDesign(i.design);
  const font = EMAIL_FONTS[d.font].stack;
  const p = `margin:0 0 14px;font-size:15px;line-height:1.6;color:${d.textColor};font-family:${font};`;
  const paragraphs = (text: string) =>
    text
      .trim()
      .split(/\n{2,}/)
      .filter(Boolean)
      .map((x) => `<p style="${p}">${esc(x).replace(/\n/g, "<br>")}</p>`)
      .join("\n");

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
  const href = esc(i.listenUrl);

  const logo =
    d.logoPath && i.logoUrl
      ? `<p style="margin:0 0 20px;text-align:${d.logoAlign};"><img src="${esc(i.logoUrl)}" width="${d.logoWidth}" alt="${esc(i.senderName)}" style="display:inline-block;width:${d.logoWidth}px;max-width:100%;height:auto;border:0;"></p>`
      : "";
  const cover =
    d.showCover && i.coverUrl
      ? `<p style="margin:0 0 14px;"><a href="${href}"><img src="${esc(i.coverUrl)}" width="160" height="160" alt="${esc(i.projectName)}" style="display:block;width:160px;height:160px;border-radius:10px;border:0;"></a></p>`
      : "";
  const cta =
    d.cta === "button"
      ? `<p style="margin:4px 0 14px;"><a href="${href}" style="display:inline-block;padding:11px 22px;border-radius:999px;background:${d.accentColor};color:${onColor(d.accentColor)};font-family:${font};font-size:14px;font-weight:bold;text-decoration:none;">${esc(d.ctaLabel)}</a></p>`
      : `<p style="${p}"><a href="${href}" style="color:${d.accentColor};">${esc(d.ctaLabel)}</a></p>`;

  const body = [
    logo,
    paragraphs(i.message),
    cover,
    `<p style="${p}"><b>${esc(i.projectName)}</b> (${count})${list ? `<br>${list}` : ""}</p>`,
    cta,
    notes ? `<p style="${p}font-size:13px;opacity:0.7;">${esc(notes)}</p>` : "",
    paragraphs(i.signature ? `${i.signature}\n${i.senderName}` : i.senderName),
  ]
    .filter(Boolean)
    .join("\n");

  const html =
    d.background.toLowerCase() === "#ffffff"
      ? `<div dir="ltr" style="font-family:${font};">\n${body}\n</div>`
      : `<div dir="ltr" style="background:${d.background};padding:24px;border-radius:12px;font-family:${font};">\n${body}\n</div>`;

  const text = [
    i.message.trim(),
    "",
    `${i.projectName} (${count})`,
    ...shown,
    moreLabel,
    "",
    `${d.ctaLabel} : ${i.listenUrl}`,
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
