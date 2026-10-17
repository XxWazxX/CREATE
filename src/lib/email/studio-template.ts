/**
 * "Studio" project email: dark card, centred logo, white "Écouter les prods"
 * button, project artwork, then one row per prod (artwork, BPM · key,
 * waveform, duration, ▶). Email-safe HTML only: tables + inline styles, no
 * SVG / script / audio (Gmail and Outlook strip them), so each ▶ is a link that
 * opens the listening page on that prod.
 */
import { normalizeKey } from "@/lib/music";

export type EmailTrack = {
  id: string;
  title: string;
  bpm: number | null;
  key: string | null;
  duration: number | null;
  /** Waveform peaks (0–1) from the analysis; a neutral shape is drawn when missing. */
  peaks: number[] | null;
  /** Public artwork URL (track cover, else the project's). */
  coverUrl: string | null;
  /** Opens the listening page on this prod. */
  playUrl: string;
};

export type StudioInput = {
  senderName: string;
  message: string;
  signature: string;
  instagramHandle: string | null;
  ctaLabel: string;
  listenUrl: string;
  projectName: string;
  coverUrl: string | null;
  showCover: boolean;
  logoUrl: string | null;
  logoWidth: number;
  tracks: EmailTrack[];
  notes: string;
  trackingPixelUrl: string | null;
};

/** Keeps the email under Gmail's ~100 KB clipping limit. */
export const MAX_EMAIL_TRACKS = 12;
const BARS = 30;

const C = {
  page: "#0b0b0c",
  card: "#141416",
  line: "#26262a",
  text: "#ececee",
  muted: "#9b9ba3",
  faint: "#6b6b73",
  wave: "#5a5a62",
};
const FONT = "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";
// White play triangle drawn with borders: a ▶ character gets turned into an
// orange emoji by Gmail / iOS whatever the font.
const PLAY = `<span style="display:block;width:0;height:0;margin:11px 0 0 14px;border-top:7px solid transparent;border-bottom:7px solid transparent;border-left:11px solid #ffffff;font-size:0;line-height:0;"></span>`;

function esc(s: string) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

export function keyText(key: string | null): string | null {
  const k = normalizeKey(key);
  if (!k) return null;
  const [note, mode] = k.split(" ");
  return `${note} ${mode === "minor" ? "MIN" : "MAJ"}`;
}

export function durationText(s: number | null): string | null {
  if (!s || !Number.isFinite(s) || s <= 0) return null;
  const t = Math.round(s);
  return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, "0")}`;
}

/** BARS heights (px) from the peaks; a soft generic shape when there are none. */
export function waveHeights(peaks: number[] | null, seed: string): number[] {
  const out: number[] = [];
  if (peaks && peaks.length >= BARS) {
    const per = peaks.length / BARS;
    const raw = Array.from({ length: BARS }, (_, i) => {
      const slice = peaks.slice(Math.floor(i * per), Math.max(Math.floor(i * per) + 1, Math.floor((i + 1) * per)));
      return Math.max(...slice.map((v) => Math.abs(Number(v) || 0)));
    });
    const max = Math.max(...raw, 0.0001);
    for (const v of raw) out.push(Math.max(2, Math.round((v / max) * 26)));
    return out;
  }
  let h = 0;
  for (const c of seed) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  for (let i = 0; i < BARS; i++) {
    h = (h * 1103515245 + 12345) >>> 0;
    const envelope = Math.sin((Math.PI * (i + 0.5)) / BARS);
    out.push(Math.max(2, Math.round((0.35 + 0.65 * ((h >>> 16) / 65535)) * envelope * 22)));
  }
  return out;
}

function waveform(heights: number[]) {
  const cells = heights
    .map((h) => `<td style="padding:0 1px"><div style="width:2px;height:${h}px;background:${C.wave}"></div></td>`)
    .join("");
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" height="30" style="height:30px;"><tr>${cells}</tr></table>`;
}

function paragraphs(text: string, style: string) {
  return text
    .trim()
    .split(/\n{2,}/)
    .filter(Boolean)
    .map((x) => `<p style="${style}">${esc(x).replace(/\n/g, "<br>")}</p>`)
    .join("\n");
}

function trackRow(t: EmailTrack, last: boolean) {
  const meta = [t.bpm ? `${Math.round(t.bpm)} BPM` : null, keyText(t.key)].filter(Boolean).join(" &bull; ");
  const art = t.coverUrl
    ? `<img src="${esc(t.coverUrl)}" width="56" height="56" alt="" style="display:block;width:56px;height:56px;border-radius:6px;border:0;object-fit:cover;">`
    : `<div style="width:56px;height:56px;border-radius:6px;background:#202024;"></div>`;
  const href = esc(t.playUrl);
  return `<tr>
<td style="padding:12px 0 12px 16px;${last ? "" : `border-bottom:1px solid ${C.line};`}" width="56"><a href="${href}" style="text-decoration:none;">${art}</a></td>
<td style="padding:12px 12px;${last ? "" : `border-bottom:1px solid ${C.line};`}">
  <a href="${href}" style="text-decoration:none;color:${C.text};"><div style="font-family:${FONT};font-size:13px;font-weight:600;letter-spacing:0.14em;text-transform:uppercase;color:${C.text};">${esc(t.title)}</div></a>
  ${meta ? `<div style="font-family:${FONT};font-size:11px;letter-spacing:0.14em;color:${C.muted};margin-top:6px;">${meta}</div>` : ""}
</td>
<td class="wf" style="padding:12px 8px;${last ? "" : `border-bottom:1px solid ${C.line};`}" width="${BARS * 4}">${waveform(waveHeights(t.peaks, t.id))}</td>
<td class="dur" align="right" style="padding:12px 8px;font-family:${FONT};font-size:12px;color:${C.muted};white-space:nowrap;${last ? "" : `border-bottom:1px solid ${C.line};`}">${durationText(t.duration) ?? ""}</td>
<td style="padding:12px 16px 12px 4px;${last ? "" : `border-bottom:1px solid ${C.line};`}" width="44">
  <a href="${href}" style="display:block;width:36px;height:36px;margin-left:auto;border:2px solid #ffffff;border-radius:50%;text-align:left;text-decoration:none;font-size:0;line-height:0;" aria-label="Écouter ${esc(t.title)}">${PLAY}</a>
</td>
</tr>`;
}

export function renderStudioEmail(i: StudioInput): string {
  const p = `margin:0 0 14px;font-family:${FONT};font-size:16px;line-height:1.6;color:${C.text};`;
  const shown = i.tracks.slice(0, MAX_EMAIL_TRACKS);
  const more = i.tracks.length - shown.length;
  const logo = i.logoUrl
    ? `<img src="${esc(i.logoUrl)}" width="${i.logoWidth}" alt="${esc(i.senderName)}" style="display:block;margin:0 auto;width:${i.logoWidth}px;max-width:100%;height:auto;border:0;">`
    : `<div style="font-family:${FONT};font-size:24px;font-weight:300;letter-spacing:0.45em;padding-left:0.45em;color:${C.text};text-transform:uppercase;">${esc(i.senderName)}</div>
<div style="margin-top:10px;font-size:0;line-height:0;">${[6, 12, 18, 24, 14, 20, 10, 16, 8]
        .map(
          (h) =>
            `<span style="display:inline-block;width:2px;height:${h}px;margin:0 2px;background:${C.text};border-radius:1px;vertical-align:middle;"></span>`,
        )
        .join("")}</div>`;

  return `<!doctype html>
<html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="dark"><meta name="supported-color-schemes" content="dark">
<style>
@media only screen and (max-width:520px){
  .wf{display:none!important;}
  .pad{padding-left:20px!important;padding-right:20px!important;}
}
</style></head>
<body style="margin:0;padding:0;background:${C.page};">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${C.page}" style="background:${C.page};">
<tr><td align="center" style="padding:28px 10px;">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" bgcolor="${C.card}" style="width:100%;max-width:600px;background:${C.card};border-radius:16px;">
<tr><td align="center" style="padding:40px 32px 12px;">${logo}</td></tr>
<tr><td class="pad" style="padding:20px 56px 6px;">${paragraphs(i.message, p)}</td></tr>
${i.notes ? `<tr><td class="pad" style="padding:0 56px 10px;font-family:${FONT};font-size:12px;color:${C.faint};">${esc(i.notes)}</td></tr>` : ""}
<tr><td style="padding:0 0 16px;font-size:0;line-height:0;">&nbsp;</td></tr>
${
  i.showCover && i.coverUrl
    ? `<tr><td style="padding:0 24px 18px;"><a href="${esc(i.listenUrl)}"><img src="${esc(i.coverUrl)}" width="552" alt="${esc(i.projectName)}" style="display:block;width:100%;max-width:552px;height:auto;border:0;border-radius:12px;"></a></td></tr>`
    : ""
}
${
  shown.length
    ? `<tr><td style="padding:0 24px 8px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border:1px solid ${C.line};border-radius:12px;border-collapse:separate;">
${shown.map((t, n) => trackRow(t, n === shown.length - 1)).join("\n")}
</table>
${more > 0 ? `<p style="margin:12px 0 0;text-align:center;font-family:${FONT};font-size:12px;"><a href="${esc(i.listenUrl)}" style="color:${C.muted};">+ ${more} autre${more > 1 ? "s" : ""} prod${more > 1 ? "s" : ""} à écouter</a></p>` : ""}
</td></tr>`
    : ""
}
<tr><td style="padding:22px 24px 0;"><div style="border-top:1px solid ${C.line};font-size:0;line-height:0;">&nbsp;</div></td></tr>
<tr><td align="center" style="padding:22px 32px 34px;font-family:${FONT};font-size:14px;line-height:1.6;color:${C.muted};">
${esc(i.signature || "").replace(/\n/g, "<br>")}${i.signature ? "<br>" : ""}${esc(i.senderName)}
${i.instagramHandle ? `<br><a href="https://www.instagram.com/${i.instagramHandle}/" style="color:${C.muted};text-decoration:underline;">Instagram · @${esc(i.instagramHandle)}</a>` : ""}
</td></tr>
</table>
</td></tr>
</table>${
    i.trackingPixelUrl
      ? `\n<img src="${esc(i.trackingPixelUrl)}" width="1" height="1" alt="" style="display:block;width:1px;height:1px;border:0;opacity:0;">`
      : ""
  }
</body></html>`;
}
