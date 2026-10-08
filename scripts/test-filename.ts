/**
 * Checks BPM / key extraction from file names.
 *   npx tsx --tsconfig tsconfig.json scripts/test-filename.ts
 */
import { parseFilenameMeta } from "../src/lib/filename-meta";

const cases: [string, string, number | null, string | null][] = [
  ["Midnight Drive 142bpm F#m.wav", "Midnight Drive", 142, "F# minor"],
  ["midnight_drive_142_Am.wav", "midnight drive", 142, "A minor"],
  ["Dark Room - 140 BPM - G minor.wav", "Dark Room", 140, "G minor"],
  ["Nuit (Fa# mineur) 98bpm.mp3", "Nuit", 98, "F# minor"],
  ["Werenoi Type Beat 145 Bbm.wav", "Werenoi Type Beat", 145, "A# minor"],
  ["Club Night [128] Cmaj.aif", "Club Night", 128, "C major"],
  ["beat 01 - 160bpm - Ebmin.wav", "beat 01", 160, "D# minor"],
  ["Sunset Eb Major 90bpm.m4a", "Sunset", 90, "D# major"],
  ["Trap Loop 150 C.wav", "Trap Loop", 150, "C major"],
  ["Drill key Dm 142.wav", "Drill", 142, "D minor"],
  ["La nuit 140bpm Sol mineur.wav", "La nuit", 140, "G minor"],
  ["Untitled 12.wav", "Untitled 12", null, null],
  ["A beat for you.wav", "A beat for you", null, null],
  ["Album 2026 Track 03.wav", "Album 2026 Track 03", null, null],
  ["I Am Legend 140 F#m.wav", "I Am Legend", 140, "F# minor"],
];

let fail = 0;
for (const [name, title, bpm, key] of cases) {
  const r = parseFilenameMeta(name);
  const ok = r.title === title && r.bpm === bpm && r.key === key;
  if (!ok) fail++;
  console.log(`${ok ? "✓" : "✗"} ${name.padEnd(36)} → "${r.title}" · ${r.bpm} · ${r.key}`);
}
console.log(fail ? `\n${fail} failed` : "\nAll filename checks passed");
process.exit(fail ? 1 : 0);
