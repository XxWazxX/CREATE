"use client";

import { fileExtension } from "@/lib/utils";

export type DecodedAudio = { channels: Float32Array[]; sampleRate: number };

/** Files above this size are uploaded without analysis to protect memory. */
export const MAX_ANALYSIS_BYTES = 700 * 1024 * 1024;

const TARGET_RATE = 44100;

/**
 * Decodes an audio file to PCM. Uses the browser decoder (resampled to 44.1 kHz)
 * and a built-in AIFF parser, since Chrome and Firefox cannot decode AIFF.
 */
export async function decodeFile(file: Blob & { name?: string }): Promise<DecodedAudio> {
  const buf = await file.arrayBuffer();
  const ext = file.name ? fileExtension(file.name) : "";
  if (ext === "aif" || ext === "aiff" || ext === "aifc" || isAiff(buf)) {
    const parsed = parseAiff(buf);
    if (parsed.sampleRate === 44100 || parsed.sampleRate === 48000) return parsed;
    return resample(parsed, TARGET_RATE);
  }
  const ctx = new OfflineAudioContext(1, 1, TARGET_RATE);
  const audio = await ctx.decodeAudioData(buf);
  const channels: Float32Array[] = [];
  for (let c = 0; c < Math.min(2, audio.numberOfChannels); c++) channels.push(audio.getChannelData(c));
  return { channels, sampleRate: audio.sampleRate };
}

async function resample(input: DecodedAudio, rate: number): Promise<DecodedAudio> {
  const length = input.channels[0].length;
  const ctx = new OfflineAudioContext(input.channels.length, Math.ceil((length * rate) / input.sampleRate), rate);
  const buffer = ctx.createBuffer(input.channels.length, length, input.sampleRate);
  input.channels.forEach((ch, i) => buffer.copyToChannel(ch as Float32Array<ArrayBuffer>, i));
  const src = ctx.createBufferSource();
  src.buffer = buffer;
  src.connect(ctx.destination);
  src.start();
  const out = await ctx.startRendering();
  const channels: Float32Array[] = [];
  for (let c = 0; c < out.numberOfChannels; c++) channels.push(out.getChannelData(c));
  return { channels, sampleRate: rate };
}

// ---------------------------------------------------------------------------
// AIFF / AIFF-C
// ---------------------------------------------------------------------------

function isAiff(buf: ArrayBuffer) {
  if (buf.byteLength < 12) return false;
  const v = new DataView(buf);
  return fourCC(v, 0) === "FORM" && ["AIFF", "AIFC"].includes(fourCC(v, 8));
}

function fourCC(v: DataView, off: number) {
  return String.fromCharCode(v.getUint8(off), v.getUint8(off + 1), v.getUint8(off + 2), v.getUint8(off + 3));
}

function readExtended(v: DataView, off: number): number {
  const expon = ((v.getUint8(off) & 0x7f) << 8) | v.getUint8(off + 1);
  const hi = v.getUint32(off + 2);
  const lo = v.getUint32(off + 6);
  if (expon === 0 && hi === 0 && lo === 0) return 0;
  const sign = v.getUint8(off) & 0x80 ? -1 : 1;
  return sign * (hi * Math.pow(2, expon - 16383 - 31) + lo * Math.pow(2, expon - 16383 - 63));
}

export function parseAiff(buf: ArrayBuffer): DecodedAudio {
  const v = new DataView(buf);
  if (!isAiff(buf)) throw new Error("Not an AIFF file");
  let numChannels = 0;
  let numFrames = 0;
  let bits = 16;
  let sampleRate = 44100;
  let compression = "NONE";
  let dataOffset = -1;

  let off = 12;
  while (off + 8 <= buf.byteLength) {
    const id = fourCC(v, off);
    const size = v.getUint32(off + 4);
    const body = off + 8;
    if (id === "COMM") {
      numChannels = v.getInt16(body);
      numFrames = v.getUint32(body + 2);
      bits = v.getInt16(body + 6);
      sampleRate = readExtended(v, body + 8);
      if (size >= 22) compression = fourCC(v, body + 18);
    } else if (id === "SSND") {
      dataOffset = body + 8 + v.getUint32(body);
    }
    off = body + size + (size % 2);
  }
  if (dataOffset < 0 || !numChannels) throw new Error("Invalid AIFF file");

  const littleEndian = compression === "sowt";
  const isFloat = compression === "fl32" || compression === "FL32";
  const bytes = isFloat ? 4 : Math.ceil(bits / 8);
  const frames = Math.min(numFrames, Math.floor((buf.byteLength - dataOffset) / (bytes * numChannels)));
  const outChannels = Math.min(2, numChannels);
  const channels = Array.from({ length: outChannels }, () => new Float32Array(frames));
  const scale = 1 / Math.pow(2, bytes * 8 - 1);

  for (let i = 0; i < frames; i++) {
    for (let c = 0; c < outChannels; c++) {
      const p = dataOffset + (i * numChannels + c) * bytes;
      let s: number;
      if (isFloat) s = v.getFloat32(p, littleEndian);
      else if (bytes === 1) s = v.getInt8(p) * scale;
      else if (bytes === 2) s = v.getInt16(p, littleEndian) * scale;
      else if (bytes === 3) {
        const b0 = v.getUint8(p);
        const b1 = v.getUint8(p + 1);
        const b2 = v.getUint8(p + 2);
        let n = littleEndian ? b0 | (b1 << 8) | (b2 << 16) : (b0 << 16) | (b1 << 8) | b2;
        if (n & 0x800000) n -= 0x1000000;
        s = n * scale;
      } else s = v.getInt32(p, littleEndian) * scale;
      channels[c][i] = s;
    }
  }
  return { channels, sampleRate };
}

/** Reads duration from the browser's media element (cheap; no decoding). */
export function probeDuration(file: Blob): Promise<number | null> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const audio = new Audio();
    const done = (d: number | null) => {
      URL.revokeObjectURL(url);
      resolve(d);
    };
    audio.preload = "metadata";
    audio.onloadedmetadata = () => done(Number.isFinite(audio.duration) ? audio.duration : null);
    audio.onerror = () => done(null);
    setTimeout(() => done(null), 8000);
    audio.src = url;
  });
}
