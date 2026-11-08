import { normalizeKey } from "@/lib/music";
import { DEFAULT_ARTIST } from "@/lib/utils";

/** Characters Windows / macOS refuse in file names. */
function clean(s: string) {
  return s
    .replace(/[\\/:*?"<>|]+/g, "-")
    .replace(/\s+/g, " ")
    .trim();
}

/** "D# minor" → "D#min", "C major" → "Cmaj" (same style as the producer's own files). */
export function scaleTag(key: string | null | undefined): string | null {
  const k = normalizeKey(key);
  if (!k) return null;
  const [note, mode] = k.split(" ");
  return `${note}${mode === "minor" ? "min" : "maj"}`;
}

/**
 * Name of a downloaded prod, without extension: WAZ_BPM_Gamme_Nom de la prod
 * (e.g. "WAZ_142_D#min_Midnight Drive"). Missing BPM or key are left out.
 */
export function prodFileName(t: { title: string; bpm: number | string | null; key: string | null }): string {
  const bpm = t.bpm == null || t.bpm === "" ? null : Number(t.bpm);
  const parts = [
    DEFAULT_ARTIST,
    bpm && Number.isFinite(bpm) ? String(Math.round(bpm * 10) / 10) : null,
    scaleTag(t.key),
    clean(t.title) || "prod",
  ];
  return parts.filter(Boolean).join("_");
}
