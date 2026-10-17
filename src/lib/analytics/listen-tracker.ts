/**
 * Turns the public player's audio events into a small stream of listening
 * events. Pure (clock and ids injected) so it can be tested without a browser.
 *
 * Listened time only grows while the audio actually advances: pauses, seeks
 * (jumps) and stalls add nothing. A "play" is one run of a track; playing it
 * again after it ended (loop, replay) starts a new play.
 */

export type ListenEventType = "start" | "resume" | "progress" | "pause" | "end";

export type ListenEvent = {
  /** Idempotency key: the same event re-sent after a network error is stored once. */
  key: string;
  track: string;
  play: string;
  type: ListenEventType;
  /** Playback position (s). */
  pos: number;
  /** Audio played since the previous event of this play (s). */
  listened: number;
  /** Track duration (s) when known. */
  dur: number | null;
  /** Client time (ms) — the server only uses it as an age, never as a date. */
  at: number;
};

/** A forward jump bigger than this between two time updates is a seek, not playback. */
export const MAX_STEP_SECONDS = 2.5;
/** The server refuses more listened time than this in one event. */
export const MAX_EVENT_LISTENED = 110;

type Current = {
  track: string;
  play: string;
  seq: number;
  pending: number;
  lastPos: number;
  dur: number | null;
  playing: boolean;
  ended: boolean;
};

export class ListenTracker {
  private cur: Current | null = null;
  private queue: ListenEvent[] = [];

  constructor(
    private readonly now: () => number = () => Date.now(),
    private readonly newId: () => string = () => crypto.randomUUID(),
  ) {}

  private emit(type: ListenEventType, pos: number) {
    const c = this.cur;
    if (!c) return;
    let left = c.pending;
    c.pending = 0;
    // Very long un-flushed stretches are split so no event exceeds the server cap.
    do {
      const part = Math.min(left, MAX_EVENT_LISTENED);
      left -= part;
      this.queue.push({
        key: `${c.play}:${c.seq++}`,
        track: c.track,
        play: c.play,
        type: left > 0 ? "progress" : type,
        pos: Math.max(0, round(pos)),
        listened: round(part),
        dur: c.dur,
        at: this.now(),
      });
    } while (left > 0);
  }

  /** Audio started or resumed (`playing`). A new track, or the same one after it ended, is a new play. */
  playing(track: string, pos: number, dur: number | null) {
    const c = this.cur;
    if (!c || c.track !== track || c.ended) {
      if (c && !c.ended && c.pending > 0) this.emit("progress", c.lastPos);
      this.cur = { track, play: this.newId(), seq: 0, pending: 0, lastPos: pos, dur, playing: true, ended: false };
      this.emit("start", pos);
      return;
    }
    if (dur) c.dur = dur;
    c.lastPos = pos;
    if (!c.playing) {
      c.playing = true;
      this.emit("resume", pos);
    }
  }

  /** `timeupdate`: counts only small forward steps while playing. */
  time(pos: number, dur?: number | null) {
    const c = this.cur;
    if (!c) return;
    if (dur) c.dur = dur;
    const step = pos - c.lastPos;
    if (c.playing && step > 0 && step <= MAX_STEP_SECONDS) c.pending += step;
    c.lastPos = pos;
  }

  /** `seeked`: the next steps are measured from the new position. */
  seeked(pos: number) {
    if (this.cur) this.cur.lastPos = pos;
  }

  pause(pos: number) {
    const c = this.cur;
    if (!c || !c.playing || c.ended) return;
    this.time(pos);
    c.playing = false;
    this.emit("pause", pos);
  }

  ended(pos: number) {
    const c = this.cur;
    if (!c || c.ended) return;
    this.time(pos);
    c.playing = false;
    c.ended = true;
    this.emit("end", pos);
  }

  /** Periodic flush: reports the time listened since the last event (if any). */
  tick() {
    const c = this.cur;
    if (c && c.pending >= 1) this.emit("progress", c.lastPos);
  }

  /** Takes the queued events (to send). */
  drain(): ListenEvent[] {
    const out = this.queue;
    this.queue = [];
    return out;
  }

  /** Puts events back after a failed send (keys keep them idempotent). */
  requeue(events: ListenEvent[]) {
    this.queue = [...events, ...this.queue];
  }
}

const round = (n: number) => Math.round(n * 100) / 100;
