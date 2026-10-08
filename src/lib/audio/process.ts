"use client";

import type { AnalysisResult } from "./analysis";
import type { WorkerRequest, WorkerResponse } from "./audio.worker";
import { decodeFile, MAX_ANALYSIS_BYTES } from "./decode";

type Handlers = {
  onAnalysis?: (r: AnalysisResult) => void;
  onMp3Progress?: (p: number) => void;
};

export type ProcessResult = { analysis: AnalysisResult | null; mp3: Blob | null; error?: string };

let worker: Worker | null = null;
const listeners = new Map<string, (msg: WorkerResponse) => void>();

function getWorker() {
  if (!worker) {
    worker = new Worker(new URL("./audio.worker.ts", import.meta.url), { type: "module" });
    worker.onmessage = (e: MessageEvent<WorkerResponse>) => listeners.get(e.data.id)?.(e.data);
  }
  return worker;
}

// Decoding holds the whole file in memory: process one file at a time.
let chain: Promise<unknown> = Promise.resolve();

/**
 * Decodes a file and, in a worker, extracts duration / waveform peaks / BPM / key
 * and optionally encodes a 256 kbps MP3 preview. Never throws: detection is
 * best-effort and must not block the upload.
 */
export function processAudio(file: File, opts: { encodeMp3: boolean } & Handlers): Promise<ProcessResult> {
  const run = async (): Promise<ProcessResult> => {
    if (file.size > MAX_ANALYSIS_BYTES)
      return { analysis: null, mp3: null, error: "Fichier trop volumineux pour être analysé" };
    let decoded;
    try {
      decoded = await decodeFile(file);
    } catch (e) {
      return { analysis: null, mp3: null, error: `Impossible de décoder l'audio : ${String(e)}` };
    }
    const id = crypto.randomUUID();
    return new Promise<ProcessResult>((resolve) => {
      let analysis: AnalysisResult | null = null;
      let error: string | undefined;
      const finish = (mp3: Blob | null) => {
        listeners.delete(id);
        resolve({ analysis, mp3, error });
      };
      listeners.set(id, (msg) => {
        if (msg.type === "analysis") {
          analysis = msg.result;
          opts.onAnalysis?.(msg.result);
          if (!opts.encodeMp3) finish(null);
        } else if (msg.type === "mp3-progress") {
          opts.onMp3Progress?.(msg.progress);
        } else if (msg.type === "mp3") {
          finish(new Blob([msg.data as Uint8Array<ArrayBuffer>], { type: "audio/mpeg" }));
        } else if (msg.type === "error") {
          error = msg.message;
          if (msg.message.startsWith("mp3") || !opts.encodeMp3) finish(null);
        }
      });
      // Copy so the decoded buffers can be transferred without detaching AudioBuffer storage.
      const channels = decoded.channels.map((c) => new Float32Array(c));
      const req: WorkerRequest = { id, channels, sampleRate: decoded.sampleRate, encodeMp3: opts.encodeMp3 };
      getWorker().postMessage(
        req,
        channels.map((c) => c.buffer),
      );
    });
  };
  const p = chain.then(run, run);
  chain = p.catch(() => undefined);
  return p;
}
