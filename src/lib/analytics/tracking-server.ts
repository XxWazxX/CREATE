import "server-only";

import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import { ACCESS_COOKIE, hasAccess } from "@/lib/access";

/** 24 random bytes → 32-char URL-safe token, one per email. Only its hash is stored. */
export function newTrackingToken() {
  return randomBytes(24).toString("base64url");
}

export const TRACKING_TOKEN_RE = /^[A-Za-z0-9_-]{32}$/;
export const SESSION_TOKEN_RE = /^[A-Za-z0-9_-]{32,128}$/;

export function hashToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

function secret() {
  const s = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!s) throw new Error("SUPABASE_SERVICE_ROLE_KEY n'est pas défini");
  return s;
}

// ---------------------------------------------------------------------------
// Attribution: a click on an email link leaves a signed, HttpOnly cookie that
// ties the listening sessions of THAT link to THAT email. Nothing readable.
// ---------------------------------------------------------------------------

export const ATTRIBUTION_MAX_AGE = 60 * 60 * 24 * 30;

export function attributionCookieName(shareId: string) {
  return `cr_src_${shareId.replace(/-/g, "").slice(0, 16)}`;
}

function sign(shareId: string, sendId: string) {
  return createHmac("sha256", secret()).update(`attr:${shareId}:${sendId}`).digest("base64url");
}

export function attributionValue(shareId: string, sendId: string) {
  return `${sendId}.${sign(shareId, sendId)}`;
}

/** The email id carried by a valid attribution cookie for this link, else null. */
export function readAttribution(shareId: string, value: string | undefined): string | null {
  if (!value) return null;
  const [sendId, mac] = value.split(".");
  if (!sendId || !mac || !/^[0-9a-f-]{36}$/.test(sendId)) return null;
  const want = sign(shareId, sendId);
  return mac.length === want.length && timingSafeEqual(Buffer.from(mac), Buffer.from(want)) ? sendId : null;
}

// ---------------------------------------------------------------------------
// The owner's own visits (from a device that unlocked the app) are not counted.
// ---------------------------------------------------------------------------

export async function isOwnerRequest(): Promise<boolean> {
  if (!process.env.APP_ACCESS_CODE) return true; // local app: only the owner uses it
  const jar = await cookies();
  const v = jar.get(ACCESS_COOKIE)?.value;
  return !!v && (await hasAccess(v));
}

export function requestInfo(req: Request) {
  return {
    method: req.method,
    userAgent: req.headers.get("user-agent"),
    purpose: req.headers.get("sec-purpose") ?? req.headers.get("purpose") ?? req.headers.get("x-purpose"),
  };
}
