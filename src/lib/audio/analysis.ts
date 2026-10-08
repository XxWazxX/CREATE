/**
 * Pure audio analysis: waveform peaks, tempo (BPM) and musical key.
 * No DOM / Web Audio dependency, so it runs in a Web Worker and in Node tests.
 */

import { KEY_NAMES } from "@/lib/music";

export type AnalysisResult = {
  duration: number;
  peaks: number[];
  bpm: number | null;
  bpmConfidence: number;
  key: string | null;
  keyConfidence: number;
};

// ---------------------------------------------------------------------------
// FFT (in-place radix-2, real input via complex arrays)
// ---------------------------------------------------------------------------

function fft(re: Float64Array, im: Float64Array) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      [re[i], re[j]] = [re[j], re[i]];
      [im[i], im[j]] = [im[j], im[i]];
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len;
    const wr = Math.cos(ang);
    const wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cr = 1;
      let ci = 0;
      for (let k = 0; k < len / 2; k++) {
        const ar = re[i + k + len / 2] * cr - im[i + k + len / 2] * ci;
        const ai = re[i + k + len / 2] * ci + im[i + k + len / 2] * cr;
        re[i + k + len / 2] = re[i + k] - ar;
        im[i + k + len / 2] = im[i + k] - ai;
        re[i + k] += ar;
        im[i + k] += ai;
        const ncr = cr * wr - ci * wi;
        ci = cr * wi + ci * wr;
        cr = ncr;
      }
    }
  }
}

function hann(size: number) {
  const w = new Float64Array(size);
  for (let i = 0; i < size; i++) w[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (size - 1));
  return w;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

export function mixToMono(channels: Float32Array[]): Float32Array {
  if (channels.length === 1) return channels[0];
  const len = channels[0].length;
  const out = new Float32Array(len);
  for (const ch of channels) for (let i = 0; i < len; i++) out[i] += ch[i];
  const g = 1 / channels.length;
  for (let i = 0; i < len; i++) out[i] *= g;
  return out;
}

/** Box-filter decimation; good enough for analysis (not for listening). */
export function downsample(input: Float32Array, fromRate: number, toRate: number): Float32Array {
  if (toRate >= fromRate) return input;
  const ratio = fromRate / toRate;
  const outLen = Math.floor(input.length / ratio);
  const out = new Float32Array(outLen);
  for (let i = 0; i < outLen; i++) {
    const start = Math.floor(i * ratio);
    const end = Math.min(input.length, Math.floor((i + 1) * ratio));
    let sum = 0;
    for (let j = start; j < end; j++) sum += input[j];
    out[i] = sum / Math.max(1, end - start);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Peaks
// ---------------------------------------------------------------------------

export function computePeaks(mono: Float32Array, count = 1000): number[] {
  const peaks = new Array<number>(count).fill(0);
  const block = mono.length / count;
  let max = 0;
  for (let i = 0; i < count; i++) {
    const start = Math.floor(i * block);
    const end = Math.min(mono.length, Math.floor((i + 1) * block));
    let p = 0;
    for (let j = start; j < end; j++) {
      const v = Math.abs(mono[j]);
      if (v > p) p = v;
    }
    peaks[i] = p;
    if (p > max) max = p;
  }
  const norm = max > 0 ? 1 / max : 0;
  return peaks.map((p) => Math.round(p * norm * 1000) / 1000);
}

// ---------------------------------------------------------------------------
// Tempo
// ---------------------------------------------------------------------------

const BPM_RATE = 11025;
const BPM_FRAME = 1024;
const BPM_HOP = 128;

function onsetEnvelope(x: Float32Array): Float64Array {
  const frames = Math.max(0, Math.floor((x.length - BPM_FRAME) / BPM_HOP));
  const env = new Float64Array(frames);
  const win = hann(BPM_FRAME);
  const re = new Float64Array(BPM_FRAME);
  const im = new Float64Array(BPM_FRAME);
  const bins = BPM_FRAME / 2;
  let prev = new Float64Array(bins);
  let cur = new Float64Array(bins);
  for (let f = 0; f < frames; f++) {
    const off = f * BPM_HOP;
    for (let i = 0; i < BPM_FRAME; i++) {
      re[i] = x[off + i] * win[i];
      im[i] = 0;
    }
    fft(re, im);
    let flux = 0;
    for (let k = 1; k < bins; k++) {
      const mag = Math.log1p(100 * Math.hypot(re[k], im[k]));
      cur[k] = mag;
      const d = mag - prev[k];
      if (d > 0) flux += d;
    }
    env[f] = flux;
    [prev, cur] = [cur, prev];
  }
  // Remove slow trend (local mean) and half-wave rectify.
  const w = 16;
  const out = new Float64Array(frames);
  let acc = 0;
  for (let i = 0; i < frames; i++) {
    acc += env[i];
    if (i >= 2 * w + 1) acc -= env[i - 2 * w - 1];
    const center = i - w;
    if (center >= 0) {
      const mean = acc / Math.min(i + 1, 2 * w + 1);
      out[center] = Math.max(0, env[center] - mean);
    }
  }
  return out;
}

export function detectTempo(mono: Float32Array, sampleRate: number): { bpm: number | null; confidence: number } {
  const x = downsample(mono, sampleRate, BPM_RATE);
  const rate = sampleRate > BPM_RATE ? BPM_RATE : sampleRate;
  // Cap analysis to 120 s from the middle-ish of the track for speed.
  const maxLen = rate * 120;
  const start = x.length > maxLen ? Math.floor((x.length - maxLen) / 3) : 0;
  const seg = x.subarray(start, start + maxLen);
  if (seg.length < rate * 4) return { bpm: null, confidence: 0 };

  const env = onsetEnvelope(seg);
  const fps = rate / BPM_HOP;
  const n = env.length;

  const maxLag = Math.ceil((60 * fps) / 50) * 4 + 2;
  const acf = new Float64Array(maxLag + 1);
  for (let lag = 0; lag <= maxLag && lag < n; lag++) {
    let s = 0;
    for (let i = 0; i + lag < n; i++) s += env[i] * env[i + lag];
    acf[lag] = s / (n - lag);
  }
  const acfAt = (lag: number) => {
    const i = Math.floor(lag);
    const f = lag - i;
    if (i + 1 > maxLag) return 0;
    return acf[i] * (1 - f) + acf[i + 1] * f;
  };

  // Comb scoring over candidate tempi.
  let best = 0;
  let bestScore = -Infinity;
  const scores: number[] = [];
  for (let bpm = 60; bpm <= 200; bpm += 0.25) {
    const period = (60 * fps) / bpm;
    let s = 0;
    for (let m = 1; m <= 4; m++) s += acfAt(period * m) / m;
    // Gentle preference for the 85–170 range most beats live in.
    const prior = Math.exp(-0.5 * Math.pow(Math.log2(bpm / 125) / 0.9, 2));
    s *= prior;
    scores.push(s);
    if (s > bestScore) {
      bestScore = s;
      best = bpm;
    }
  }
  if (!(bestScore > 0)) return { bpm: null, confidence: 0 };

  // Fold into the range most beats are labelled in (78–180).
  let bpm = best;
  while (bpm < 78) bpm *= 2;
  while (bpm > 180) bpm /= 2;

  const mean = scores.reduce((a, b) => a + b, 0) / scores.length;
  const confidence = Math.max(0, Math.min(1, (bestScore - mean) / (bestScore + 1e-12)));

  // Refine the period around the winner to sub-0.1 BPM.
  let fine = bpm;
  let fineScore = -Infinity;
  for (let b = bpm - 1; b <= bpm + 1; b += 0.02) {
    const period = (60 * fps) / b;
    let s = 0;
    for (let m = 1; m <= 8; m++) s += acfAt(period * m);
    if (s > fineScore) {
      fineScore = s;
      fine = b;
    }
  }
  const rounded = Math.round(fine);
  const result = Math.abs(fine - rounded) < 0.35 ? rounded : Math.round(fine * 10) / 10;
  return { bpm: result, confidence };
}

// ---------------------------------------------------------------------------
// Key (chromagram + bass chroma + electronic-music key profiles)
// ---------------------------------------------------------------------------

const KEY_RATE = 11025;
const KEY_FFT = 8192;
const BASS_WEIGHT = 0.8;

// Key profiles tuned for electronic music (Faraldo et al., "edma").
const MAJOR = [0.165, 0.047, 0.083, 0.067, 0.1, 0.093, 0.053, 0.132, 0.052, 0.074, 0.052, 0.082];
const MINOR = [0.172, 0.04, 0.076, 0.125, 0.055, 0.084, 0.04, 0.127, 0.079, 0.058, 0.06, 0.04];

function correlate(a: number[], b: number[]) {
  const ma = a.reduce((s, v) => s + v, 0) / a.length;
  const mb = b.reduce((s, v) => s + v, 0) / b.length;
  let num = 0;
  let da = 0;
  let db = 0;
  for (let i = 0; i < a.length; i++) {
    num += (a[i] - ma) * (b[i] - mb);
    da += (a[i] - ma) ** 2;
    db += (b[i] - mb) ** 2;
  }
  return num / Math.sqrt(da * db || 1);
}

/** Returns [full chroma, bass chroma (55–220 Hz, where 808s / bass carry the tonic)]. */
export function computeChroma(mono: Float32Array, sampleRate: number): [number[], number[]] {
  const x = downsample(mono, sampleRate, KEY_RATE);
  const rate = sampleRate > KEY_RATE ? KEY_RATE : sampleRate;
  const chroma = new Array<number>(12).fill(0);
  const bass = new Array<number>(12).fill(0);
  const win = hann(KEY_FFT);
  const re = new Float64Array(KEY_FFT);
  const im = new Float64Array(KEY_FFT);
  const hop = KEY_FFT / 2;
  // Precompute bin -> pitch class for 55 Hz .. 2 kHz.
  const binPc = new Int8Array(KEY_FFT / 2).fill(-1);
  const binBass = new Uint8Array(KEY_FFT / 2);
  for (let k = 1; k < KEY_FFT / 2; k++) {
    const f = (k * rate) / KEY_FFT;
    if (f < 55 || f > 2000) continue;
    const midi = 69 + 12 * Math.log2(f / 440);
    const nearest = Math.round(midi);
    if (Math.abs(midi - nearest) > 0.35) continue; // skip bins between semitones
    binPc[k] = ((nearest % 12) + 12) % 12;
    if (f <= 220) binBass[k] = 1;
  }
  for (let off = 0; off + KEY_FFT <= x.length; off += hop) {
    let energy = 0;
    for (let i = 0; i < KEY_FFT; i++) {
      const v = x[off + i];
      energy += v * v;
      re[i] = v * win[i];
      im[i] = 0;
    }
    if (energy / KEY_FFT < 1e-6) continue; // silence
    fft(re, im);
    const frame = new Array<number>(12).fill(0);
    const bframe = new Array<number>(12).fill(0);
    for (let k = 1; k < KEY_FFT / 2; k++) {
      const pc = binPc[k];
      if (pc < 0) continue;
      const mag = Math.hypot(re[k], im[k]);
      frame[pc] += mag;
      if (binBass[k]) bframe[pc] += mag;
    }
    const fmax = Math.max(...frame);
    if (fmax > 0) for (let i = 0; i < 12; i++) chroma[i] += frame[i] / fmax;
    const bmax = Math.max(...bframe);
    if (bmax > 0) for (let i = 0; i < 12; i++) bass[i] += bframe[i] / bmax;
  }
  return [chroma, bass];
}

export function detectKey(mono: Float32Array, sampleRate: number): { key: string | null; confidence: number } {
  const [full, bass] = computeChroma(mono, sampleRate);
  if (full.every((v) => v === 0)) return { key: null, confidence: 0 };
  const norm = (v: number[]) => {
    const sum = v.reduce((a, b) => a + b, 0) || 1;
    return v.map((x) => x / sum);
  };
  const nf = norm(full);
  const nb = norm(bass);
  const results: { key: string; r: number }[] = [];
  for (let tonic = 0; tonic < 12; tonic++) {
    const rotated = nf.map((_, i) => nf[(i + tonic) % 12]);
    // Bonus when the bass dwells on the tonic: breaks relative major/minor ties.
    const tonicBass = nb[tonic] - 1 / 12;
    results.push({ key: `${KEY_NAMES[tonic]} major`, r: correlate(rotated, MAJOR) + BASS_WEIGHT * tonicBass });
    results.push({ key: `${KEY_NAMES[tonic]} minor`, r: correlate(rotated, MINOR) + BASS_WEIGHT * tonicBass });
  }
  results.sort((a, b) => b.r - a.r);
  const [first, second] = results;
  const confidence = Math.max(0, Math.min(1, (first.r - second.r) * 5 + first.r * 0.5));
  return { key: first.key, confidence };
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

export function analyze(channels: Float32Array[], sampleRate: number): AnalysisResult {
  const mono = mixToMono(channels);
  const duration = mono.length / sampleRate;
  const peaks = computePeaks(mono);
  let bpm: number | null = null;
  let bpmConfidence = 0;
  let key: string | null = null;
  let keyConfidence = 0;
  try {
    ({ bpm, confidence: bpmConfidence } = detectTempo(mono, sampleRate));
  } catch {
    /* detection is best-effort */
  }
  try {
    ({ key, confidence: keyConfidence } = detectKey(mono, sampleRate));
  } catch {
    /* detection is best-effort */
  }
  return { duration, peaks, bpm, bpmConfidence, key, keyConfidence };
}
