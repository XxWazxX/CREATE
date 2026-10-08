"use client";

import { importFiles } from "./uploads";

export const AUDIO_ACCEPT = "audio/*,.wav,.mp3,.aif,.aiff,.m4a,.flac,.ogg,.aac";

/** Opens the OS file picker synchronously (must run inside a user gesture). */
export function pickFiles(onFiles: (files: File[]) => void, opts: { multiple?: boolean; accept?: string } = {}) {
  const input = document.createElement("input");
  input.type = "file";
  input.multiple = opts.multiple ?? true;
  input.accept = opts.accept ?? AUDIO_ACCEPT;
  input.style.display = "none";
  input.onchange = () => {
    const files = Array.from(input.files ?? []);
    input.remove();
    if (files.length) onFiles(files);
  };
  document.body.appendChild(input);
  input.click();
}

export function pickAndImport(projectId: string | null = null) {
  pickFiles((files) => void importFiles(files, { projectId }));
}
