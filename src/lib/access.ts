/**
 * Device access code for the private app (APP_ACCESS_CODE).
 * WebCrypto only, so it runs in the Edge middleware and in Node routes alike.
 */

export const ACCESS_COOKIE = "create_access";
export const ACCESS_MAX_AGE = 60 * 60 * 24 * 365;

function b64url(buf: ArrayBuffer) {
  let s = "";
  new Uint8Array(buf).forEach((b) => (s += String.fromCharCode(b)));
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** Cookie value proving the device entered the current code (changing the code logs every device out). */
export async function accessToken(code: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(code),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return b64url(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode("create-access-v1")));
}

export function safeEqual(a: string, b: string) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export async function hasAccess(cookieValue: string | undefined): Promise<boolean> {
  const code = process.env.APP_ACCESS_CODE;
  if (!code) return true; // not configured (local use): open
  if (!cookieValue) return false;
  return safeEqual(cookieValue, await accessToken(code));
}
