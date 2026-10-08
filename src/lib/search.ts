import { camelot, normalizeKey, shortKey } from "@/lib/music";
import type { Project, Tag, Track } from "@/lib/types";

/**
 * In-memory search over the whole library index. A personal library is a few
 * thousand rows at most, so this answers in well under a frame — faster than
 * any network round-trip.
 */
export type SearchIndex = { track: Track; hay: string; title: string }[];

export function buildIndex(tracks: Track[], projects: Project[], tags: Tag[]): SearchIndex {
  const pName = new Map(projects.map((p) => [p.id, p.name]));
  const tName = new Map(tags.map((t) => [t.id, t.name]));
  return tracks.map((t) => {
    const parts = [
      t.title,
      t.artist,
      t.producer,
      t.genre,
      t.project_id ? pName.get(t.project_id) : null,
      ...t.tag_ids.map((id) => tName.get(id)),
      t.bpm != null ? `${Math.round(t.bpm)}bpm ${Math.round(t.bpm)} bpm` : null,
      t.key,
      shortKey(t.key),
      camelot(t.key),
      t.notes,
      t.original_filename,
    ];
    return {
      track: t,
      hay: fold(parts.filter(Boolean).join(" \u0001 ").toLowerCase()),
      title: fold(t.title.toLowerCase()),
    };
  });
}

function fold(s: string) {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "");
}

export function searchTracks(index: SearchIndex, query: string, limit = Infinity): Track[] {
  const q = fold(query.trim().toLowerCase());
  if (!q) return index.slice(0, limit).map((x) => x.track);
  const tokens = q.split(/\s+/).filter(Boolean);
  const results: { track: Track; score: number }[] = [];

  for (const item of index) {
    const hay = item.hay;
    let score = 0;
    let ok = true;
    for (const tok of tokens) {
      // "140" → BPM match (exact or ±1), "f#m" / "a minor" → key match
      if (/^\d{2,3}(\.\d)?$/.test(tok) && item.track.bpm != null) {
        const diff = Math.abs(item.track.bpm - Number(tok));
        if (diff <= 1) {
          score += diff === 0 ? 6 : 3;
          continue;
        }
      }
      const key = /^[a-g][#b]?m?$/.test(tok) ? normalizeKey(tok) : null;
      if (key && normalizeKey(item.track.key) === key) {
        score += 5;
        continue;
      }
      const at = hay.indexOf(tok);
      if (at === -1) {
        ok = false;
        break;
      }
      const t = item.title;
      if (t.startsWith(tok)) score += 10;
      else if (t.includes(tok)) score += 7;
      else score += at < 80 ? 3 : 1;
    }
    if (ok) results.push({ track: item.track, score });
  }
  results.sort((a, b) => b.score - a.score || b.track.created_at.localeCompare(a.track.created_at));
  return results.slice(0, limit).map((r) => r.track);
}

// ---------------------------------------------------------------------------
// Structured filters (Library)
// ---------------------------------------------------------------------------

export type Filters = {
  bpmMin?: number | null;
  bpmMax?: number | null;
  keys?: string[];
  genres?: string[];
  tagIds?: string[];
  projectId?: string | "none" | null;
  dateFrom?: string | null;
  dateTo?: string | null;
  favorites?: boolean;
};

export function applyFilters(tracks: Track[], f: Filters): Track[] {
  const keys = f.keys?.length ? new Set(f.keys) : null;
  const genres = f.genres?.length ? new Set(f.genres.map((g) => g.toLowerCase())) : null;
  const from = f.dateFrom ? new Date(f.dateFrom).getTime() : null;
  const to = f.dateTo ? new Date(f.dateTo).getTime() + 86_400_000 : null;
  return tracks.filter((t) => {
    if (f.favorites && !t.favorite) return false;
    if (f.bpmMin != null && (t.bpm == null || t.bpm < f.bpmMin)) return false;
    if (f.bpmMax != null && (t.bpm == null || t.bpm > f.bpmMax)) return false;
    if (keys && !keys.has(normalizeKey(t.key) ?? "")) return false;
    if (genres && !genres.has((t.genre ?? "").toLowerCase())) return false;
    if (f.tagIds?.length && !f.tagIds.every((id) => t.tag_ids.includes(id))) return false;
    if (f.projectId === "none" && t.project_id) return false;
    if (f.projectId && f.projectId !== "none" && t.project_id !== f.projectId) return false;
    const created = new Date(t.created_at).getTime();
    if (from != null && created < from) return false;
    if (to != null && created >= to) return false;
    return true;
  });
}

export function activeFilterCount(f: Filters): number {
  return [
    f.bpmMin != null || f.bpmMax != null,
    !!f.keys?.length,
    !!f.genres?.length,
    !!f.tagIds?.length,
    !!f.projectId,
    !!(f.dateFrom || f.dateTo),
    !!f.favorites,
  ].filter(Boolean).length;
}
