/**
 * Tells apart requests that are probably a person from those made by software
 * (mail security scanners, link previews, prefetch) and image proxies.
 * Heuristics only: nothing here identifies anyone, and the result is shown as
 * "détecté", never as a certainty.
 */

export type Origin = "human" | "proxy" | "automated";

const AUTOMATED_UA =
  /bot\b|bot\/|crawler|spider|slurp|preview|scanner|safelinks|proofpoint|barracuda|mimecast|messagelabs|symantec|trendmicro|forcepoint|ironport|sophos|python-|python\/|curl\/|wget|go-http|java\/|okhttp|axios|node-fetch|undici|headless|phantomjs|facebookexternalhit|slack|discord|whatsapp|telegram|skypeuripreview|linkedin|twitter|embedly|iframely|microsoft office|ms-office|outlook-ios/i;

/** Mail providers that fetch images on the reader's behalf (it still means the email was displayed). */
const IMAGE_PROXY_UA = /googleimageproxy|ggpht\.com|yahoomailproxy|yahoo! slurp|mail\.ru|outlookimageproxy/i;

/** Clicks this soon after sending are almost always a security scanner following every link. */
export const SCANNER_CLICK_SECONDS = 10;
/** Same for opens (pre-fetch on delivery). */
export const SCANNER_OPEN_SECONDS = 2;

export function classifyRequest(r: {
  kind: "open" | "click" | "listen";
  method?: string;
  userAgent?: string | null;
  /** `Purpose` / `Sec-Purpose` header (browser prefetch / prerender). */
  purpose?: string | null;
  /** Seconds between the email being sent and this request (when known). */
  secondsSinceSend?: number | null;
}): Origin {
  const ua = (r.userAgent ?? "").trim();
  if (r.method && r.method.toUpperCase() === "HEAD") return "automated";
  if (r.purpose && /prefetch|prerender|preview/i.test(r.purpose)) return "automated";
  if (r.kind === "open" && IMAGE_PROXY_UA.test(ua)) {
    return r.secondsSinceSend != null && r.secondsSinceSend < SCANNER_OPEN_SECONDS ? "automated" : "proxy";
  }
  if (!ua || AUTOMATED_UA.test(ua)) return "automated";
  if (r.secondsSinceSend != null && r.secondsSinceSend >= 0) {
    if (r.kind === "click" && r.secondsSinceSend < SCANNER_CLICK_SECONDS) return "automated";
    if (r.kind === "open" && r.secondsSinceSend < SCANNER_OPEN_SECONDS) return "automated";
  }
  return "human";
}

/**
 * Identical events inside the same window collapse into one row:
 * opens per hour, clicks per minute (and automated ones apart from the rest).
 */
export function dedupeKey(kind: "open" | "click", origin: Origin, at: Date): string {
  const iso = at.toISOString(); // 2026-10-17T09:41:23.000Z
  const bucket = kind === "open" ? iso.slice(0, 13) : iso.slice(0, 16);
  return `${origin === "automated" ? "auto" : "seen"}:${bucket}`;
}
