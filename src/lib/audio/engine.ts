"use client";

import { pitchWorkletUrl } from "./pitch-worklet";

/**
 * Single HTMLAudioElement for the whole app (streams, never preloads the full
 * file). The Web Audio graph is only attached once pitch shifting is used, so
 * normal playback stays on the lightest possible path.
 */
class Engine {
  readonly audio: HTMLAudioElement;
  private ctx: AudioContext | null = null;
  private source: MediaElementAudioSourceNode | null = null;
  private pitchNode: AudioWorkletNode | null = null;
  private gain: GainNode | null = null;
  private semitones = 0;
  private volume = 1;

  constructor() {
    this.audio = new Audio();
    this.audio.preload = "metadata";
    this.audio.crossOrigin = "anonymous";
  }

  get graphActive() {
    return !!this.ctx;
  }

  private async ensureGraph() {
    if (this.ctx) return;
    const ctx = new AudioContext({ latencyHint: "playback" });
    await ctx.audioWorklet.addModule(pitchWorkletUrl());
    this.source = ctx.createMediaElementSource(this.audio);
    this.pitchNode = new AudioWorkletNode(ctx, "crate-pitch-shifter", { outputChannelCount: [2] });
    this.gain = ctx.createGain();
    this.gain.gain.value = this.volume;
    this.gain.connect(ctx.destination);
    this.ctx = ctx;
    this.audio.volume = 1;
    this.route();
  }

  private route() {
    if (!this.ctx || !this.source || !this.pitchNode || !this.gain) return;
    this.source.disconnect();
    this.pitchNode.disconnect();
    if (this.semitones === 0) {
      this.source.connect(this.gain);
    } else {
      this.source.connect(this.pitchNode);
      this.pitchNode.connect(this.gain);
      this.pitchNode.parameters.get("pitchRatio")!.value = Math.pow(2, this.semitones / 12);
    }
  }

  async setPitch(semitones: number) {
    this.semitones = semitones;
    if (semitones !== 0) await this.ensureGraph();
    this.route();
  }

  setVolume(v: number) {
    this.volume = v;
    if (this.gain) this.gain.gain.value = v;
    else this.audio.volume = v;
  }

  setRate(rate: number, preservePitch: boolean) {
    this.audio.playbackRate = rate;
    this.audio.preservesPitch = preservePitch;
  }

  async play() {
    if (this.ctx?.state === "suspended") await this.ctx.resume();
    await this.audio.play();
  }

  pause() {
    this.audio.pause();
  }

  load(url: string, startAt = 0) {
    this.audio.src = url;
    if (startAt > 0) {
      const onMeta = () => {
        this.audio.currentTime = startAt;
        this.audio.removeEventListener("loadedmetadata", onMeta);
      };
      this.audio.addEventListener("loadedmetadata", onMeta);
    }
    this.audio.load();
  }

  seek(t: number) {
    if (Number.isFinite(t)) this.audio.currentTime = Math.max(0, t);
  }

  stop() {
    this.audio.pause();
    this.audio.removeAttribute("src");
    this.audio.load();
  }
}

let engine: Engine | null = null;

export function getEngine(): Engine {
  if (!engine) engine = new Engine();
  return engine;
}
