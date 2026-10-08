export const KEY_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"] as const;

export const ALL_KEYS: string[] = KEY_NAMES.flatMap((n) => [`${n} major`, `${n} minor`]);

const FLATS: Record<string, string> = { Db: "C#", Eb: "D#", Gb: "F#", Ab: "G#", Bb: "A#" };

// Camelot wheel: minor = A, major = B.
const CAMELOT_MINOR: Record<string, number> = {
  "G#": 1,
  "D#": 2,
  "A#": 3,
  F: 4,
  C: 5,
  G: 6,
  D: 7,
  A: 8,
  E: 9,
  B: 10,
  "F#": 11,
  "C#": 12,
};
const CAMELOT_MAJOR: Record<string, number> = {
  B: 1,
  "F#": 2,
  "C#": 3,
  "G#": 4,
  "D#": 5,
  "A#": 6,
  F: 7,
  C: 8,
  G: 9,
  D: 10,
  A: 11,
  E: 12,
};

/** Normalizes user input like "f#m", "Gb min", "A" into "F# minor" / "A major". */
export function normalizeKey(input: string | null | undefined): string | null {
  if (!input) return null;
  const s = input.trim();
  const m = s.match(/^([A-Ga-g])\s*([#♯b♭]?)\s*(.*)$/);
  if (!m) return null;
  let note = m[1].toUpperCase() + (m[2] === "♯" ? "#" : m[2] === "♭" ? "b" : m[2]);
  if (FLATS[note]) note = FLATS[note];
  if (note === "Cb") note = "B";
  if (note === "Fb") note = "E";
  if (note === "E#") note = "F";
  if (note === "B#") note = "C";
  if (!(KEY_NAMES as readonly string[]).includes(note)) return null;
  const q = m[3].toLowerCase();
  const minor = q === "m" || q.startsWith("min") || q === "-";
  return `${note} ${minor ? "minor" : "major"}`;
}

export function camelot(key: string | null | undefined): string | null {
  const k = normalizeKey(key);
  if (!k) return null;
  const [note, mode] = k.split(" ");
  return mode === "minor" ? `${CAMELOT_MINOR[note]}A` : `${CAMELOT_MAJOR[note]}B`;
}

/** Compact label: "F#m", "C". */
export function shortKey(key: string | null | undefined): string {
  const k = normalizeKey(key);
  if (!k) return "";
  const [note, mode] = k.split(" ");
  return mode === "minor" ? `${note}m` : note;
}

export const STEM_KINDS = ["drums", "808", "bass", "melody", "keys", "vocals", "fx", "other"] as const;
export type StemKind = (typeof STEM_KINDS)[number];

export const STEM_LABELS: Record<StemKind, string> = {
  drums: "Drums",
  "808": "808",
  bass: "Basse",
  melody: "Mélodie",
  keys: "Claviers",
  vocals: "Voix",
  fx: "FX",
  other: "Autre",
};

/** Guesses a stem kind from its filename ("Midnight_808.wav" -> "808"). */
export function guessStemKind(filename: string): StemKind {
  const n = filename.toLowerCase();
  if (/808/.test(n)) return "808";
  if (/(drum|kick|snare|hat|hh|perc|clap|cymbal|ride|tom)/.test(n)) return "drums";
  if (/bass/.test(n)) return "bass";
  if (/(vox|vocal|voice|acap|adlib)/.test(n)) return "vocals";
  if (/(key|piano|rhodes|organ|epiano)/.test(n)) return "keys";
  if (/(fx|sfx|riser|impact|sweep|noise|transition)/.test(n)) return "fx";
  if (/(melod|lead|synth|pad|guitar|string|bell|pluck|flute|choir|sample|arp)/.test(n)) return "melody";
  return "other";
}

/** French display label: "F# minor" -> "F# mineur". Stored values stay canonical. */
export function keyLabel(key: string | null | undefined): string {
  const k = normalizeKey(key);
  if (!k) return "";
  return k.replace("minor", "mineur").replace("major", "majeur");
}
