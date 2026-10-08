"use client";

/** Custom drag payload types (in-app drags vs. files from the OS). */
export const DND_TRACKS = "application/x-crate-tracks";
export const DND_PROJECT = "application/x-crate-project";

export function setTrackDrag(e: React.DragEvent, ids: string[], label: string) {
  e.dataTransfer.setData(DND_TRACKS, JSON.stringify(ids));
  e.dataTransfer.setData("text/plain", label);
  e.dataTransfer.effectAllowed = "move";
  const ghost = document.createElement("div");
  ghost.textContent = ids.length > 1 ? `${ids.length} tracks` : label;
  ghost.style.cssText =
    "position:fixed;top:-100px;left:-100px;padding:6px 10px;border-radius:8px;background:#1b1b1f;color:#ececee;font:500 13px system-ui;border:1px solid #2b2b31;";
  document.body.appendChild(ghost);
  e.dataTransfer.setDragImage(ghost, 10, 10);
  setTimeout(() => ghost.remove(), 0);
}

export function readTrackDrag(e: React.DragEvent): string[] | null {
  const raw = e.dataTransfer.getData(DND_TRACKS);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as string[];
  } catch {
    return null;
  }
}

export function hasType(e: React.DragEvent | DragEvent, type: string) {
  return Array.from(e.dataTransfer?.types ?? []).includes(type);
}
