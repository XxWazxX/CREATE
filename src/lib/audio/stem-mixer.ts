"use client";

import { decodeFile } from "./decode";

export type MixerChannel = {
  id: string;
  buffer: AudioBuffer;
  gain: GainNode;
  volume: number;
  muted: boolean;
  solo: boolean;
};

/**
 * Sample-accurate stem playback: every stem is decoded to an AudioBuffer and
 * started on the same AudioContext clock, so they never drift.
 */
export class StemMixer {
  readonly ctx: AudioContext;
  private master: GainNode;
  private channels = new Map<string, MixerChannel>();
  private sources: AudioBufferSourceNode[] = [];
  private startedAt = 0;
  private offset = 0;
  playing = false;
  onEnded?: () => void;

  constructor() {
    this.ctx = new AudioContext({ latencyHint: "playback" });
    this.master = this.ctx.createGain();
    this.master.connect(this.ctx.destination);
  }

  get duration() {
    let d = 0;
    for (const c of this.channels.values()) d = Math.max(d, c.buffer.duration);
    return d;
  }

  get time() {
    if (!this.playing) return this.offset;
    return Math.min(this.duration, this.offset + this.ctx.currentTime - this.startedAt);
  }

  async load(id: string, url: string, name: string) {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Impossible de récupérer ${name}`);
    const blob = await res.blob();
    const decoded = await decodeFile(Object.assign(blob, { name }));
    const buffer = this.ctx.createBuffer(decoded.channels.length, decoded.channels[0].length, decoded.sampleRate);
    decoded.channels.forEach((ch, i) => buffer.copyToChannel(ch as Float32Array<ArrayBuffer>, i));
    const gain = this.ctx.createGain();
    gain.connect(this.master);
    this.channels.set(id, { id, buffer, gain, volume: 1, muted: false, solo: false });
    this.applyGains();
  }

  has(id: string) {
    return this.channels.has(id);
  }

  setMaster(v: number) {
    this.master.gain.value = v;
  }

  update(id: string, patch: Partial<Pick<MixerChannel, "volume" | "muted" | "solo">>) {
    const c = this.channels.get(id);
    if (!c) return;
    Object.assign(c, patch);
    this.applyGains();
  }

  private applyGains() {
    const anySolo = [...this.channels.values()].some((c) => c.solo);
    for (const c of this.channels.values()) {
      const audible = anySolo ? c.solo : !c.muted;
      c.gain.gain.setTargetAtTime(audible ? c.volume : 0, this.ctx.currentTime, 0.01);
    }
  }

  async play() {
    if (this.playing) return;
    if (this.ctx.state === "suspended") await this.ctx.resume();
    if (this.offset >= this.duration) this.offset = 0;
    const when = this.ctx.currentTime + 0.05;
    this.sources = [];
    for (const c of this.channels.values()) {
      const src = this.ctx.createBufferSource();
      src.buffer = c.buffer;
      src.connect(c.gain);
      src.start(when, Math.min(this.offset, c.buffer.duration));
      this.sources.push(src);
    }
    const longest = this.sources.reduce<AudioBufferSourceNode | null>(
      (a, s) => (!a || (s.buffer?.duration ?? 0) > (a.buffer?.duration ?? 0) ? s : a),
      null,
    );
    if (longest) {
      longest.onended = () => {
        if (this.playing && this.time >= this.duration - 0.05) {
          this.playing = false;
          this.offset = 0;
          this.onEnded?.();
        }
      };
    }
    this.startedAt = when;
    this.playing = true;
  }

  pause() {
    if (!this.playing) return;
    this.offset = this.time;
    this.playing = false;
    this.stopSources();
  }

  seek(t: number) {
    const wasPlaying = this.playing;
    if (wasPlaying) {
      this.playing = false;
      this.stopSources();
    }
    this.offset = Math.max(0, Math.min(this.duration, t));
    if (wasPlaying) void this.play();
  }

  private stopSources() {
    for (const s of this.sources) {
      s.onended = null;
      try {
        s.stop();
      } catch {
        /* already stopped */
      }
    }
    this.sources = [];
  }

  dispose() {
    this.stopSources();
    void this.ctx.close();
  }
}
