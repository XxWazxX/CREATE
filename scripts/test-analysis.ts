/**
 * Validates BPM / key detection on synthetic beats.
 *   npx tsx scripts/test-analysis.ts
 */
import { analyze } from "../src/lib/audio/analysis";
import { KEY_NAMES } from "../src/lib/music";

const SR = 44100;

function synth(bpm: number, tonic: number, minor: boolean, seconds = 30, swingNoise = 0) {
  const len = SR * seconds;
  const out = new Float32Array(len);
  const beat = 60 / bpm;
  // Kick on every beat, snare-ish noise on 2 and 4, hats on 8ths.
  for (let t = 0, i = 0; t < seconds; t += beat / 2, i++) {
    const start = Math.floor(t * SR);
    const isBeat = i % 2 === 0;
    const isSnare = i % 4 === 2;
    for (let n = 0; n < SR * 0.15 && start + n < len; n++) {
      const time = n / SR;
      if (isBeat)
        out[start + n] += 0.8 * Math.sin(2 * Math.PI * (50 + 80 * Math.exp(-time * 30)) * time) * Math.exp(-time * 12);
      if (isSnare) out[start + n] += 0.3 * (Math.random() * 2 - 1) * Math.exp(-time * 25);
      out[start + n] += 0.08 * (Math.random() * 2 - 1) * Math.exp(-time * 80);
    }
  }
  // Major: I - V - vi - IV.
  const root = 48 + tonic; // C3 + tonic
  // Minor: i - VI - iv - i, 808/bass resting on chord roots like most trap loops.
  const prog = minor
    ? [
        [0, 3, 7],
        [-4, 0, 3],
        [5, 8, 12],
        [0, 3, 7],
      ]
    : [
        [0, 4, 7],
        [7, 11, 14],
        [9, 12, 16],
        [5, 9, 12],
      ];
  const barLen = beat * 4;
  for (let s = 0; s < len; s++) {
    const t = s / SR;
    const chord = prog[Math.floor(t / barLen) % prog.length];
    let v = 0;
    for (const iv of chord) {
      const f = 440 * Math.pow(2, (root + iv - 69) / 12);
      v += Math.sin(2 * Math.PI * f * t) + 0.3 * Math.sin(4 * Math.PI * f * t);
    }
    // Bass on chord root
    const fb = 440 * Math.pow(2, (root + chord[0] - 12 - 69) / 12);
    v += 0.8 * Math.sin(2 * Math.PI * fb * t);
    out[s] += 0.06 * v + swingNoise * (Math.random() * 2 - 1);
  }
  return out;
}

const cases: [number, number, boolean][] = [
  [140, 6, true], // F# minor
  [92, 9, true], // A minor
  [128, 0, false], // C major
  [75, 2, true], // D minor (half-time feel)
  [160, 10, true], // A# minor
  [100, 7, false], // G major
];

let fail = 0;
for (const [bpm, tonic, minor] of cases) {
  const expectedKey = `${KEY_NAMES[tonic]} ${minor ? "minor" : "major"}`;
  const t0 = performance.now();
  const r = analyze([synth(bpm, tonic, minor)], SR);
  const ms = Math.round(performance.now() - t0);
  const bpmOk = r.bpm !== null && [bpm, bpm * 2, bpm / 2].some((b) => Math.abs(r.bpm! - b) <= 1);
  const exactBpm = r.bpm !== null && Math.abs(r.bpm - bpm) <= 1;
  const keyOk = r.key === expectedKey;
  if (!bpmOk || !keyOk) fail++;
  console.log(
    `${bpmOk && keyOk ? "✓" : "✗"} ${bpm} BPM ${expectedKey.padEnd(9)} -> ${r.bpm} BPM${exactBpm ? "" : " (octave)"} ${r.key} | ${r.duration.toFixed(1)}s, ${r.peaks.length} peaks, ${ms}ms`,
  );
}
console.log(fail ? `\n${fail} failed` : "\nAll analysis checks passed");
process.exit(fail ? 1 : 0);
