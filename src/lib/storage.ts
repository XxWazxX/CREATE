"use client";

import { supabase } from "@/lib/supabase/client";

export const BUCKET = "media";

/** Storage layout: users/{uid}/tracks|stems|covers|brand/... */
export const paths = {
  version: (uid: string, trackId: string, versionId: string, ext: string) =>
    `users/${uid}/tracks/${trackId}/${versionId}.${ext || "bin"}`,
  preview: (uid: string, trackId: string, versionId: string) =>
    `users/${uid}/tracks/${trackId}/${versionId}.preview.mp3`,
  stem: (uid: string, trackId: string, stemId: string, ext: string) =>
    `users/${uid}/stems/${trackId}/${stemId}.${ext || "bin"}`,
  cover: (uid: string, ownerId: string) => `users/${uid}/covers/${ownerId}-${Date.now().toString(36)}.jpg`,
  logo: (uid: string) => `users/${uid}/brand/logo-${Date.now().toString(36)}.png`,
  trackFolder: (uid: string, trackId: string) => `users/${uid}/tracks/${trackId}`,
  stemFolder: (uid: string, trackId: string) => `users/${uid}/stems/${trackId}`,
};

// ---------------------------------------------------------------------------
// Signed URL cache with request batching (one round-trip for a whole list).
// ---------------------------------------------------------------------------

const TTL_SECONDS = 60 * 60;
const cache = new Map<string, { url: string; expires: number }>();
let pending = new Map<string, ((url: string | null) => void)[]>();
let timer: ReturnType<typeof setTimeout> | null = null;

function flush() {
  const batch = pending;
  pending = new Map();
  timer = null;
  const keys = [...batch.keys()];
  if (!keys.length) return;
  supabase()
    .storage.from(BUCKET)
    .createSignedUrls(keys, TTL_SECONDS)
    .then(({ data, error }) => {
      const now = Date.now();
      const byPath = new Map<string, string | null>();
      if (!error && data) {
        for (const item of data) {
          if (item.path && item.signedUrl) {
            byPath.set(item.path, item.signedUrl);
            cache.set(item.path, { url: item.signedUrl, expires: now + (TTL_SECONDS - 300) * 1000 });
          }
        }
      }
      for (const [path, cbs] of batch) cbs.forEach((cb) => cb(byPath.get(path) ?? null));
    })
    .catch(() => {
      for (const cbs of batch.values()) cbs.forEach((cb) => cb(null));
    });
}

export function peekSignedUrl(path: string | null | undefined): string | null {
  if (!path) return null;
  const hit = cache.get(path);
  return hit && hit.expires > Date.now() ? hit.url : null;
}

export function signedUrl(path: string): Promise<string | null> {
  const hit = peekSignedUrl(path);
  if (hit) return Promise.resolve(hit);
  return new Promise((resolve) => {
    const list = pending.get(path) ?? [];
    list.push(resolve);
    pending.set(path, list);
    if (!timer) timer = setTimeout(flush, 10);
  });
}

/** Signed URL that forces a download with the given filename. */
export async function downloadUrl(path: string, filename: string): Promise<string> {
  const { data, error } = await supabase().storage.from(BUCKET).createSignedUrl(path, 600, { download: filename });
  if (error || !data) throw error ?? new Error("Impossible de créer le lien de téléchargement");
  return data.signedUrl;
}

export function triggerDownload(url: string, filename?: string) {
  const a = document.createElement("a");
  a.href = url;
  if (filename) a.download = filename;
  a.rel = "noopener";
  document.body.appendChild(a);
  a.click();
  a.remove();
}

export async function removeFiles(pathsToRemove: (string | null | undefined)[]) {
  const list = pathsToRemove.filter((p): p is string => !!p);
  if (!list.length) return;
  for (let i = 0; i < list.length; i += 100) {
    await supabase()
      .storage.from(BUCKET)
      .remove(list.slice(i, i + 100));
  }
}

/** Removes every object under a folder (Supabase storage has no recursive delete). */
export async function removeFolder(prefix: string) {
  const { data } = await supabase().storage.from(BUCKET).list(prefix, { limit: 1000 });
  if (data?.length) await removeFiles(data.map((f) => `${prefix}/${f.name}`));
}
