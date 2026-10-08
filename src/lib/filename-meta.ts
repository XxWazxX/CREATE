import { normalizeKey } from "@/lib/music";
import { stripExtension } from "@/lib/utils";

/**
 * Reads BPM and key straight from a file name, the way producers name their
 * bounces: "Midnight Drive 142bpm F#m.wav", "midnight_drive_142_Am.wav",
 * "Dark Room - 140 BPM - G minor.wav", "Nuit (Fa# mineur) 98bpm.mp3"…
 * Returns the cleaned title (without the BPM / key parts).
 */
export type FilenameMeta = { title: string; bpm: number | null; key: string | null };

const SOLFEGE: Record<string, string> = { do: "C", re: "D", ré: "D", mi: "E", fa: "F", sol: "G", la: "A", si: "B" };

const NOTE = "(do|ré|re|mi|fa|sol|la|si|[a-g])";
const ACC = "(#|♯|b|♭|sharp|flat|dièse|diese|bémol|bemol)?";
const MODE = "(minor|mineur|major|majeur|min|maj|m|M)?";
// Note, optional accidental, optional mode — as a standalone token.
const KEY_RE = new RegExp(`(^|\\s)${NOTE}\\s?${ACC}\\s?${MODE}(?=\\s|$)`, "gi");

const BPM_EXPLICIT = /(^|\s)(?:(\d{2,3}(?:[.,]\d)?)\s?bpm|bpm\s?(\d{2,3}(?:[.,]\d)?))(?=\s|$)/i;
const BPM_BARE = /(^|\s)(\d{2,3})(?=\s|$)/g;

function toKey(note: string, acc: string | undefined, mode: string | undefined): string | null {
  const n = SOLFEGE[note.toLowerCase()] ?? note.toUpperCase();
  const a = !acc ? "" : /^(#|♯|sharp|dièse|diese)$/i.test(acc) ? "#" : "b";
  const m = !mode ? "" : mode === "M" || /^maj/i.test(mode) ? "" : "m";
  return normalizeKey(`${n}${a}${m}`);
}

export function parseFilenameMeta(filename: string): FilenameMeta {
  // Separators (_ - . , [] () {}) become spaces; keep "#" and accents.
  let s = ` ${stripExtension(filename)
    .replace(/[_\-–—.,()[\]{}+]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()} `;
  const remove: string[] = [];

  // BPM: explicit "142bpm" / "bpm 142" first, then a lone 2–3 digit number in a plausible range.
  let bpm: number | null = null;
  const explicit = s.match(BPM_EXPLICIT);
  if (explicit) {
    const v = Number((explicit[2] ?? explicit[3]).replace(",", "."));
    if (v >= 40 && v <= 300) {
      bpm = v;
      remove.push(explicit[0]);
    }
  } else {
    const bare = [...s.matchAll(BPM_BARE)].filter((m) => {
      const v = Number(m[2]);
      return v >= 60 && v <= 220;
    });
    if (bare.length) {
      const last = bare[bare.length - 1];
      bpm = Number(last[2]);
      remove.push(last[0]);
    }
  }
  for (const r of remove) s = s.replace(r, " ");

  // Key: words like "key" are noise.
  s = s.replace(/(^|\s)(key|tonalité|tonalite|in|en)(?=\s)/gi, " ");
  let key: string | null = null;
  const firstWord = s.trim().split(" ")[0];
  const candidates = [...s.matchAll(KEY_RE)].map((m) => {
    const [, , note, acc, mode] = m;
    const isLetter = note.length === 1;
    // A bare letter ("A") or solfège word ("La") with neither accidental nor mode is too ambiguous.
    // Exception: a lone uppercase letter next to a BPM, not opening the title ("Trap Loop 150 C").
    const strong = !!acc || !!mode;
    const ok = strong || (isLetter && note === note.toUpperCase() && bpm != null && m[0].trim() !== firstWord);
    return { text: m[0], key: ok ? toKey(note, acc, mode) : null, strong };
  });
  // The key usually comes last in a name: prefer explicit candidates, then the last one.
  const pick = candidates
    .filter((c) => c.key)
    .reverse()
    .sort((a, b) => Number(b.strong) - Number(a.strong))[0];
  if (pick) {
    key = pick.key;
    s = s.replace(pick.text, " ");
  }

  const title = s.replace(/\s+/g, " ").trim();
  return { title: title || stripExtension(filename), bpm, key };
}
