/// <reference lib="webworker" />
import { Mp3Encoder } from "@breezystack/lamejs";
import { analyze, type AnalysisResult } from "./analysis";

export type WorkerRequest = {
  id: string;
  channels: Float32Array[];
  sampleRate: number;
  encodeMp3: boolean;
};

export type WorkerResponse =
  | { id: string; type: "analysis"; result: AnalysisResult }
  | { id: string; type: "mp3-progress"; progress: number }
  | { id: string; type: "mp3"; data: Uint8Array }
  | { id: string; type: "error"; message: string };

const ctx = self as unknown as DedicatedWorkerGlobalScope;

function toInt16(f: Float32Array, start: number, end: number) {
  const out = new Int16Array(end - start);
  for (let i = start; i < end; i++) {
    const s = Math.max(-1, Math.min(1, f[i]));
    out[i - start] = s < 0 ? s * 0x8000 : s * 0x7fff;
  }
  return out;
}

function encodeMp3(id: string, channels: Float32Array[], sampleRate: number): Uint8Array {
  const stereo = channels.length > 1;
  const encoder = new Mp3Encoder(stereo ? 2 : 1, sampleRate, 256);
  const parts: Uint8Array[] = [];
  const block = 1152 * 20;
  const len = channels[0].length;
  let lastReport = 0;
  for (let i = 0; i < len; i += block) {
    const end = Math.min(len, i + block);
    const l = toInt16(channels[0], i, end);
    const buf = stereo ? encoder.encodeBuffer(l, toInt16(channels[1], i, end)) : encoder.encodeBuffer(l);
    if (buf.length) parts.push(new Uint8Array(buf));
    const p = end / len;
    if (p - lastReport > 0.05) {
      lastReport = p;
      ctx.postMessage({ id, type: "mp3-progress", progress: p } satisfies WorkerResponse);
    }
  }
  const tail = encoder.flush();
  if (tail.length) parts.push(new Uint8Array(tail));
  const total = parts.reduce((s, p) => s + p.length, 0);
  const out = new Uint8Array(total);
  let off = 0;
  for (const p of parts) {
    out.set(p, off);
    off += p.length;
  }
  return out;
}

ctx.onmessage = (e: MessageEvent<WorkerRequest>) => {
  const { id, channels, sampleRate, encodeMp3: wantMp3 } = e.data;
  try {
    const result = analyze(channels, sampleRate);
    ctx.postMessage({ id, type: "analysis", result } satisfies WorkerResponse);
  } catch (err) {
    ctx.postMessage({ id, type: "error", message: `analysis: ${String(err)}` } satisfies WorkerResponse);
  }
  if (wantMp3) {
    try {
      const data = encodeMp3(id, channels, sampleRate);
      ctx.postMessage({ id, type: "mp3", data } satisfies WorkerResponse, [data.buffer]);
    } catch (err) {
      ctx.postMessage({ id, type: "error", message: `mp3: ${String(err)}` } satisfies WorkerResponse);
    }
  }
};
