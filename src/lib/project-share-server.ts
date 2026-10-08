import "server-only";

import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import { createAdminClient } from "@/lib/supabase/admin";

// ---------------------------------------------------------------------------
// Tokens & passwords
// ---------------------------------------------------------------------------

/** 32 random bytes → 43-char URL-safe token. Never derived from the project id. */
export function newShareToken() {
  return randomBytes(32).toString("base64url");
}

// PBKDF2-SHA256 through WebCrypto: native in Cloudflare Workers and Node, cheap on
// CPU time (Workers limit), and the stored value never contains the password.
const PBKDF2_ITERATIONS = 100_000;

async function pbkdf2(password: string, salt: Uint8Array, iterations: number): Promise<Buffer> {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", hash: "SHA-256", salt: salt as Uint8Array<ArrayBuffer>, iterations },
    key,
    256,
  );
  return Buffer.from(bits);
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const hash = await pbkdf2(password, salt, PBKDF2_ITERATIONS);
  return ["pbkdf2-sha256", PBKDF2_ITERATIONS, salt.toString("base64url"), hash.toString("base64url")].join("$");
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [algo, iter, saltB64, hashB64] = stored.split("$");
  if (algo !== "pbkdf2-sha256" || !iter || !saltB64 || !hashB64) return false;
  const expected = Buffer.from(hashB64, "base64url");
  const actual = await pbkdf2(password, Buffer.from(saltB64, "base64url"), Number(iter));
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

/**
 * Unlock cookie for password-protected links: an HMAC of the share id and the
 * current password hash, so changing the password invalidates old unlocks.
 */
function unlockValue(shareId: string, passwordHash: string) {
  const secret = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!secret) throw new Error("SUPABASE_SERVICE_ROLE_KEY n'est pas défini");
  return createHmac("sha256", secret).update(`${shareId}:${passwordHash}`).digest("base64url");
}

export function unlockCookieName(shareId: string) {
  return `ps_${shareId.replace(/-/g, "").slice(0, 16)}`;
}

export async function setUnlockCookie(share: { id: string; password_hash: string | null; expires_at: string | null }) {
  if (!share.password_hash) return;
  const jar = await cookies();
  const maxAge = share.expires_at
    ? Math.max(60, Math.floor((new Date(share.expires_at).getTime() - Date.now()) / 1000))
    : 60 * 60 * 24 * 30;
  jar.set(unlockCookieName(share.id), unlockValue(share.id, share.password_hash), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge,
  });
}

async function isUnlocked(share: { id: string; password_hash: string | null }) {
  if (!share.password_hash) return true;
  const jar = await cookies();
  const got = jar.get(unlockCookieName(share.id))?.value;
  if (!got) return false;
  const want = unlockValue(share.id, share.password_hash);
  return got.length === want.length && timingSafeEqual(Buffer.from(got), Buffer.from(want));
}

// ---------------------------------------------------------------------------
// Resolution
// ---------------------------------------------------------------------------

export type ShareRow = {
  id: string;
  project_id: string;
  token: string;
  allow_streaming: boolean;
  allow_mp3_download: boolean;
  allow_wav_download: boolean;
  allow_stems_download: boolean;
  password_hash: string | null;
  expires_at: string | null;
};

export type ShareProject = { id: string; name: string; kind: string; cover_path: string | null };

export type Resolved =
  | { status: "not_found" }
  | { status: "expired"; project: ShareProject }
  | { status: "locked"; share: ShareRow; project: ShareProject }
  | { status: "ok"; share: ShareRow; project: ShareProject };

const TOKEN_RE = /^[A-Za-z0-9_-]{24,128}$/;

/** Checks the token, the link, its expiry and the password (via the unlock cookie). */
export async function resolveProjectShare(token: string): Promise<Resolved> {
  if (!TOKEN_RE.test(token)) return { status: "not_found" };
  const admin = createAdminClient();
  const { data: share } = await admin
    .from("project_shares")
    .select(
      "id, project_id, token, allow_streaming, allow_mp3_download, allow_wav_download, allow_stems_download, password_hash, expires_at",
    )
    .eq("token", token)
    .maybeSingle();
  if (!share) return { status: "not_found" };
  const { data: project } = await admin
    .from("projects")
    .select("id, name, kind, cover_path, deleted_at")
    .eq("id", share.project_id)
    .maybeSingle();
  if (!project || project.deleted_at) return { status: "not_found" };
  const p: ShareProject = { id: project.id, name: project.name, kind: project.kind, cover_path: project.cover_path };
  if (share.expires_at && new Date(share.expires_at) <= new Date()) return { status: "expired", project: p };
  if (!(await isUnlocked(share))) return { status: "locked", share, project: p };
  return { status: "ok", share, project: p };
}

// ---------------------------------------------------------------------------
// Project content (only what the link allows, never private fields)
// ---------------------------------------------------------------------------

export type ShareTrackFiles = {
  id: string;
  title: string;
  file_path: string;
  preview_path: string | null;
  mime_type: string | null;
  original_filename: string | null;
  stems: { id: string; name: string; kind: string; file_path: string; original_filename: string | null }[];
};

export type PublicTrack = {
  id: string;
  number: number;
  title: string;
  bpm: number | null;
  key: string | null;
  genre: string | null;
  duration: number | null;
  coverUrl: string | null;
  streamUrl: string | null;
  peaks: number[] | null;
  hasMp3: boolean;
  hasWav: boolean;
  stems: { id: string; name: string; kind: string }[];
};

export function isLosslessMime(mime: string | null | undefined) {
  return !!mime && /(wav|aiff|flac)/.test(mime);
}

/** Tracks of the shared project, in a stable order (oldest first = 01, 02…). */
export async function projectTrackFiles(projectId: string): Promise<(ShareTrackFiles & Record<string, unknown>)[]> {
  const admin = createAdminClient();
  const { data: tracks } = await admin
    .from("tracks")
    .select(
      "id, title, bpm, key, genre, duration, cover_path, file_path, preview_path, mime_type, original_filename, current_version_id, status",
    )
    .eq("project_id", projectId)
    .is("deleted_at", null)
    .not("file_path", "is", null)
    .neq("status", "uploading")
    .order("created_at", { ascending: true });
  const list = tracks ?? [];
  const { data: stems } = list.length
    ? await admin
        .from("stems")
        .select("id, track_id, name, kind, file_path, original_filename, position")
        .in(
          "track_id",
          list.map((t) => t.id),
        )
        .eq("status", "ready")
        .order("position")
    : { data: [] };
  return list.map((t) => ({
    ...t,
    stems: (stems ?? []).filter((s) => s.track_id === t.id),
  })) as (ShareTrackFiles & Record<string, unknown>)[];
}

export async function publicProjectTracks(share: ShareRow): Promise<PublicTrack[]> {
  const admin = createAdminClient();
  const files = await projectTrackFiles(share.project_id);
  if (!files.length) return [];
  const versionIds = files.map((t) => t.current_version_id as string | null).filter((x): x is string => !!x);
  const { data: versions } = versionIds.length
    ? await admin.from("track_versions").select("id, peaks").in("id", versionIds)
    : { data: [] };

  // One round-trip for every signed URL the page needs (6 h validity).
  const toSign: string[] = [];
  for (const t of files) {
    if (t.cover_path) toSign.push(t.cover_path as string);
    if (share.allow_streaming) toSign.push(t.preview_path ?? t.file_path);
  }
  const signedMap = new Map<string, string>();
  if (toSign.length) {
    const { data } = await admin.storage.from("media").createSignedUrls([...new Set(toSign)], 60 * 60 * 6);
    for (const s of data ?? []) if (s.path && s.signedUrl) signedMap.set(s.path, s.signedUrl);
  }

  return files.map((t, i) => ({
    id: t.id,
    number: i + 1,
    title: t.title,
    bpm: t.bpm == null ? null : Number(t.bpm),
    key: (t.key as string | null) ?? null,
    genre: (t.genre as string | null) ?? null,
    duration: (t.duration as number | null) ?? null,
    coverUrl: t.cover_path ? (signedMap.get(t.cover_path as string) ?? null) : null,
    streamUrl: share.allow_streaming ? (signedMap.get(t.preview_path ?? t.file_path) ?? null) : null,
    peaks: (versions?.find((v) => v.id === t.current_version_id)?.peaks as number[] | null) ?? null,
    hasMp3: !!t.preview_path || t.mime_type === "audio/mpeg",
    hasWav: isLosslessMime(t.mime_type),
    stems: t.stems.map((s) => ({ id: s.id, name: s.name, kind: s.kind })),
  }));
}

export async function signedUrl(path: string, seconds: number, download?: string) {
  const admin = createAdminClient();
  const { data } = await admin.storage
    .from("media")
    .createSignedUrl(path, seconds, download ? { download } : undefined);
  return data?.signedUrl ?? null;
}

export async function shareHit(shareId: string, kind: "view" | "play" | "download") {
  const admin = createAdminClient();
  await admin.rpc("project_share_hit", { p_share_id: shareId, p_kind: kind });
}
