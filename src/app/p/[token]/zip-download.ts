"use client";

import { downloadZip } from "client-zip";

type Manifest = { zipName: string; files: { name: string; url: string }[] };

type SaveFilePicker = (opts: {
  suggestedName?: string;
  types?: { description: string; accept: Record<string, string[]> }[];
}) => Promise<{ createWritable: () => Promise<WritableStream<Uint8Array>> }>;

/**
 * Builds the ZIP in the browser from signed URLs the server allowed.
 * Chrome / Edge stream straight to disk (no memory limit); other browsers
 * (Safari, Firefox, mobile) assemble the archive in memory, then save it.
 */
export async function zipDownload(
  manifestUrl: string,
  fallbackName: string,
  onProgress?: (done: number, total: number) => void,
) {
  const picker = (window as unknown as { showSaveFilePicker?: SaveFilePicker }).showSaveFilePicker;
  // The picker must open within the click gesture, before any await on the network.
  const handlePromise = picker
    ? picker.call(window, {
        suggestedName: fallbackName,
        types: [{ description: "Archive ZIP", accept: { "application/zip": [".zip"] } }],
      })
    : null;
  let handle: Awaited<ReturnType<SaveFilePicker>> | null = null;
  if (handlePromise) {
    try {
      handle = await handlePromise;
    } catch {
      return; // user cancelled the save dialog
    }
  }

  const res = await fetch(manifestUrl);
  if (!res.ok) throw new Error((await res.text()) || "Téléchargement impossible");
  const manifest = (await res.json()) as Manifest;
  if (!manifest.files.length) throw new Error("Rien à télécharger");

  let done = 0;
  onProgress?.(0, manifest.files.length);
  async function* files() {
    for (const f of manifest.files) {
      const r = await fetch(f.url);
      if (!r.ok || !r.body) throw new Error(`Impossible de récupérer ${f.name}`);
      yield { name: f.name, input: r, lastModified: new Date() };
      onProgress?.(++done, manifest.files.length);
    }
  }
  const zip = downloadZip(files());

  if (handle) {
    await zip.body!.pipeTo(await handle.createWritable());
    return;
  }
  const blob = await zip.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = manifest.zipName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}
