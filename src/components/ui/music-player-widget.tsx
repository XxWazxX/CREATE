"use client";

/**
 * Vinyl music player widget: spinning cover disc, audio-reactive dot "scales"
 * visualizer, animated track info, progress bar and transport controls.
 *
 * The building blocks are exported separately so a page that already owns its
 * <audio> element and playback logic (e.g. the public project page) can use the
 * look without the built-in player; `MusicPlayer` is the self-contained version.
 * Styles: ./music-player-widget.css (classes prefixed `mpw-`).
 */
import { useCallback, useEffect, useId, useMemo, useReducer, useRef, useState } from "react";
import "./music-player-widget.css";

/* ----------------------------------------------------------------- types */

export interface Track {
  title: string;
  artist: string;
  /** Cover image URL; null draws a neutral gradient disc. */
  cover: string | null;
  src: string;
}
export type LoopMode = "off" | "all" | "one";
export type Direction = "next" | "prev" | null;
type AudioCtor = typeof AudioContext;

const audioCtor = (): AudioCtor | undefined =>
  window.AudioContext || (window as unknown as { webkitAudioContext?: AudioCtor }).webkitAudioContext;

/* ------------------------------------------------------------- useRafLoop */

export function useRafLoop(cb: (now: number, dt: number) => void) {
  const cbRef = useRef(cb);
  useEffect(() => {
    cbRef.current = cb;
  });
  useEffect(() => {
    let raf = 0;
    let last = performance.now();
    const loop = (now: number) => {
      const dt = now - last;
      last = now;
      cbRef.current(now, dt);
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, []);
}

/* -------------------------------------------------- useTransitionSound */

/** Short soft "tick" when switching tracks (pitch follows the bass energy). */
export function useTransitionSound() {
  const ctxRef = useRef<AudioContext | null>(null);
  useEffect(() => {
    return () => {
      ctxRef.current?.close().catch(() => {});
      ctxRef.current = null;
    };
  }, []);
  return useCallback((bassEnergy = 0.5) => {
    try {
      if (!ctxRef.current) {
        const Ctor = audioCtor();
        if (!Ctor) return;
        ctxRef.current = new Ctor();
      }
      const ctx = ctxRef.current;
      if (ctx.state === "suspended") void ctx.resume();
      const now = ctx.currentTime;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      const startFreq = 440 + bassEnergy * 440;
      osc.type = "triangle";
      osc.frequency.setValueAtTime(startFreq, now);
      osc.frequency.exponentialRampToValueAtTime(startFreq * (2 / 3), now + 0.09);
      gain.gain.setValueAtTime(0.0001, now);
      gain.gain.exponentialRampToValueAtTime(0.06, now + 0.012);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.16);
      osc.connect(gain).connect(ctx.destination);
      osc.start(now);
      osc.stop(now + 0.18);
    } catch {
      /* Web Audio unavailable */
    }
  }, []);
}

/* --------------------------------------------------- useAudioAnalyser */

const FFT_SIZE = 256;

/**
 * Frequency data of an <audio> element. Connects on the first `play` (needs a
 * user gesture). The audio must be same-origin or served with CORS and the
 * element must have crossOrigin="anonymous", otherwise the browser mutes it.
 */
export function useAudioAnalyser(audioRef: React.RefObject<HTMLAudioElement | null>) {
  const ctxRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const dataRef = useRef<Uint8Array<ArrayBuffer>>(new Uint8Array(FFT_SIZE / 2));
  const connectedRef = useRef(false);

  const connect = useCallback(() => {
    const audio = audioRef.current;
    if (!audio || connectedRef.current) return;
    try {
      const Ctor = audioCtor();
      if (!Ctor) return;
      const ctx = new Ctor();
      const analyser = ctx.createAnalyser();
      analyser.fftSize = FFT_SIZE;
      analyser.smoothingTimeConstant = 0.8;
      const source = ctx.createMediaElementSource(audio);
      source.connect(analyser);
      analyser.connect(ctx.destination);
      ctxRef.current = ctx;
      analyserRef.current = analyser;
      dataRef.current = new Uint8Array(analyser.frequencyBinCount);
      connectedRef.current = true;
      if (ctx.state === "suspended") ctx.resume().catch(() => {});
    } catch {
      /* unavailable or already connected */
    }
  }, [audioRef]);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    audio.addEventListener("play", connect);
    return () => audio.removeEventListener("play", connect);
  }, [audioRef, connect]);

  useEffect(() => {
    return () => {
      ctxRef.current?.close().catch(() => {});
      ctxRef.current = null;
    };
  }, []);

  const getFrequencyData = useCallback((): Uint8Array | null => {
    const analyser = analyserRef.current;
    if (!analyser) return null;
    if (ctxRef.current?.state === "suspended") ctxRef.current.resume().catch(() => {});
    analyser.getByteFrequencyData(dataRef.current);
    return dataRef.current;
  }, []);

  const getBandEnergy = useCallback((startBin: number, endBin: number): number => {
    if (!analyserRef.current) return 0;
    const data = dataRef.current;
    const count = endBin - startBin;
    if (count <= 0) return 0;
    let sum = 0;
    for (let i = startBin; i < endBin && i < data.length; i++) sum += data[i];
    return sum / count / 255;
  }, []);

  return { getFrequencyData, getBandEnergy };
}

/* --------------------------------------------------------- ScalesMixer */

const COLS = 10;
const ROWS = 10;
const BAND_RANGES: [number, number][] = [
  [0, 1],
  [1, 3],
  [3, 6],
  [6, 10],
  [10, 16],
  [16, 24],
  [24, 36],
  [36, 52],
  [52, 74],
  [74, 100],
];
const sineOut = (x: number) => Math.sin((x * Math.PI) / 2);
const sineIn = (x: number) => 1 - Math.cos((x * Math.PI) / 2);
const sineInOut = (x: number) => -(Math.cos(Math.PI * x) - 1) / 2;
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const PART_A_DUR = 1.5;
const PART_A_TO = 11;
const PART_A_STEP = 3 / (COLS - 1);
const PART_B_DUR = 1;
const SCALE_FROM = 0.133;
const SCALE_TO = 0.8;

function partAColumnY(time: number, col: number): number {
  const local = time - col * PART_A_STEP;
  const period = PART_A_DUR * 2;
  const cyc = ((local % period) + period) % period;
  if (cyc < PART_A_DUR) return PART_A_TO * sineInOut(cyc / PART_A_DUR);
  return PART_A_TO * sineInOut(1 - (cyc - PART_A_DUR) / PART_A_DUR);
}

function partBCircle(time: number, col: number, row: number): [number, number] {
  const frac = row / ROWS;
  const yFrom = lerp(77, -77, frac);
  const yTo = lerp(col, -col, frac);
  const local = time - col / COLS;
  const period = PART_B_DUR * 2;
  const cyc = ((local % period) + period) % period;
  const e = cyc < PART_B_DUR ? sineOut(cyc / PART_B_DUR) : sineIn(1 - (cyc - PART_B_DUR) / PART_B_DUR);
  return [lerp(yFrom, yTo, e), lerp(SCALE_FROM, SCALE_TO, e)];
}

/** Grid of dots that ripples with the music (frequency bands left → right). */
export function ScalesMixer({
  isPlaying,
  getFrequencyData,
}: {
  isPlaying: boolean;
  getFrequencyData?: () => Uint8Array | null;
}) {
  const maskId = useId().replace(/:/g, "_");
  const colRefs = useRef<(SVGGElement | null)[]>([]);
  const circleRefs = useRef<(SVGCircleElement | null)[][]>(Array.from({ length: COLS }, () => []));
  const tRef = useRef(50);

  useRafLoop((_, dt) => {
    if (isPlaying) tRef.current += dt / 1000;
    const time = tRef.current;
    const freqData = isPlaying ? getFrequencyData?.() : null;
    for (let c = 0; c < COLS; c++) {
      let energy = 1.0;
      if (freqData) {
        const [binStart, binEnd] = BAND_RANGES[c];
        let sum = 0;
        for (let b = binStart; b < binEnd; b++) sum += freqData[b] ?? 0;
        energy = Math.sqrt(sum / (binEnd - binStart) / 255);
      }
      const bobGain = freqData ? 0.4 + energy : 1;
      const scaleGain = freqData ? 0.5 + energy : 1;
      const colEl = colRefs.current[c];
      if (colEl) colEl.style.transform = `translate(${c * 10}px, ${partAColumnY(time, c) * bobGain}px)`;
      for (let r = 0; r < ROWS; r++) {
        const circle = circleRefs.current[c][r];
        if (!circle) continue;
        const [ty, s] = partBCircle(time, c, r);
        circle.style.transform = `translateY(${ty}px) scale(${s * scaleGain})`;
      }
    }
  });

  return (
    <svg className="mpw-scales" viewBox="0 0 98 108" aria-hidden="true">
      <mask id={maskId}>
        <rect width="10" height="10" fill="#fff" />
      </mask>
      {Array.from({ length: COLS }, (_, c) => (
        <g
          key={c}
          ref={(el) => {
            colRefs.current[c] = el;
          }}
          style={{ transform: `translate(${c * 10}px, 0px)` }}
        >
          {Array.from({ length: ROWS }, (_, r) => (
            <g key={r} mask={`url(#${maskId})`} transform={`translate(0 ${r * 10})`}>
              <circle
                ref={(el) => {
                  circleRefs.current[c][r] = el;
                }}
                cx="5"
                cy="5"
                r="5"
                style={{ transformBox: "fill-box", transformOrigin: "center" }}
              />
            </g>
          ))}
        </g>
      ))}
    </svg>
  );
}

/* ------------------------------------------------------- Disc + layers */

const SPIN_MAX = 0.4375;
const BURST_DURATION = 620;

/** One cover / title shown during a track change (old ones fade out). */
export interface Layer {
  id: number;
  track: Pick<Track, "title" | "artist" | "cover"> & {
    /** CSS background for the disc when there is no cover image. */
    fallback?: string;
  };
  dir: Direction;
}

/** Keeps the layers for animated track changes: add on change, drop the old ones after the animation. */
export function useTrackLayers(key: string | number, track: Layer["track"], direction: Direction) {
  const [layers, setLayers] = useState<Layer[]>(() => [{ id: 0, track, dir: null }]);
  const lastKey = useRef(key);
  const idRef = useRef(1);
  useEffect(() => {
    if (key === lastKey.current) {
      // Same track, details changed (e.g. cover loaded): update in place.
      setLayers((prev) => prev.map((l, i) => (i === prev.length - 1 ? { ...l, track } : l)));
      return;
    }
    lastKey.current = key;
    const id = idRef.current++;
    setLayers((prev) => [...prev, { id, track, dir: direction }]);
    const t = setTimeout(() => setLayers((prev) => prev.filter((l) => l.id === id)), 760);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, track.title, track.artist, track.cover]);
  return layers;
}

function DiscCover({ layer, className }: { layer: Layer; className: string }) {
  if (layer.track.cover) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={layer.track.cover}
        alt={`${layer.track.title} — ${layer.track.artist}`}
        className={className}
        draggable={false}
      />
    );
  }
  return (
    <div
      className={`${className} mpw-cover-blank`}
      style={layer.track.fallback ? { backgroundImage: layer.track.fallback } : undefined}
      aria-label={layer.track.title}
    />
  );
}

/** Spinning vinyl with the cover; click to zoom into a square cover. */
export function Disc({
  layers,
  isPlaying,
  isZoomed,
  trackKey,
  direction,
  onZoomToggle,
}: {
  layers: Layer[];
  isPlaying: boolean;
  isZoomed: boolean;
  trackKey: string | number;
  direction: Direction;
  onZoomToggle: () => void;
}) {
  const spinRef = useRef<HTMLDivElement>(null);
  const rotRef = useRef(0);
  const velRef = useRef(0);
  const burstRef = useRef({ from: 0, start: 0, active: false, pending: false });
  const lastKey = useRef(trackKey);

  useEffect(() => {
    if (trackKey !== lastKey.current) {
      lastKey.current = trackKey;
      if (direction) {
        burstRef.current.from = direction === "prev" ? 360 : -360;
        burstRef.current.pending = true;
      }
    }
  }, [trackKey, direction]);

  useRafLoop((now) => {
    const el = spinRef.current;
    if (!el) return;
    if (isPlaying) velRef.current += (SPIN_MAX - velRef.current) * 0.2;
    else {
      velRef.current *= 0.96;
      if (velRef.current < 0.001) velRef.current = 0;
    }
    if (isZoomed) {
      const target = Math.round(rotRef.current / 360) * 360;
      const nx = rotRef.current + (target - rotRef.current) * 0.08;
      rotRef.current = Math.abs(target - nx) < 0.1 ? target : nx;
    } else {
      rotRef.current += velRef.current;
    }
    const burst = burstRef.current;
    if (burst.pending) {
      burst.start = now;
      burst.pending = false;
      burst.active = true;
    }
    let b = 0;
    if (burst.active) {
      const t = (now - burst.start) / BURST_DURATION;
      if (t >= 1) burst.active = false;
      else b = burst.from * (1 - (1 - Math.pow(1 - t, 3)));
    }
    el.style.transform = `scale(1.01) rotate(${rotRef.current + b}deg)`;
  });

  return (
    <div
      className={`mpw-mask ${isZoomed ? "is-zoomed" : ""}`}
      onClick={(e) => {
        e.stopPropagation();
        onZoomToggle();
      }}
      role="button"
      aria-label={isZoomed ? "Réduire la pochette" : "Agrandir la pochette"}
    >
      <div className="mpw-spin" ref={spinRef}>
        {layers.map((l, i) => {
          const isNewest = i === layers.length - 1;
          const cls = isNewest ? (l.dir ? "mpw-cover mpw-cover-enter" : "mpw-cover") : "mpw-cover mpw-cover-exit";
          return <DiscCover key={l.id} layer={l} className={cls} />;
        })}
      </div>
      <div className="mpw-hole">
        <div className="mpw-hole-inner" />
      </div>
    </div>
  );
}

/* ------------------------------------------------------------ TrackInfo */

export function TrackInfo({ layers }: { layers: Layer[] }) {
  return (
    <div className="mpw-track-info">
      {layers.map((l, i) => {
        const isNewest = i === layers.length - 1;
        const dx = l.dir === "next" ? 14 : l.dir === "prev" ? -14 : 0;
        const state = isNewest ? (l.dir ? "mpw-ti-enter" : "") : "mpw-ti-exit";
        const style = { ["--dx" as string]: `${isNewest ? dx : -dx}px` } as React.CSSProperties;
        return (
          <div key={l.id} className={`mpw-ti-layer ${isNewest ? "" : "mpw-ti-abs"}`}>
            <p className={`mpw-artist ${state}`} style={style}>
              {l.track.artist}
            </p>
            <h2 className={`mpw-track ${state}`} style={style} title={l.track.title}>
              {l.track.title}
            </h2>
          </div>
        );
      })}
    </div>
  );
}

/* ----------------------------------------------------------- ProgressBar */

function fmt(s: number): string {
  if (!isFinite(s)) return "0:00";
  return `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;
}

export function ProgressBar({
  currentTime,
  duration,
  onSeek,
}: {
  currentTime: number;
  duration: number;
  onSeek: (pct: number) => void;
}) {
  const pct = duration ? Math.min(100, (currentTime / duration) * 100) : 0;
  return (
    <>
      <div
        className="mpw-bar"
        role="slider"
        aria-label="Position"
        aria-valuemin={0}
        aria-valuemax={Math.round(duration)}
        aria-valuenow={Math.round(currentTime)}
        tabIndex={-1}
        onClick={(e) => {
          const rect = e.currentTarget.getBoundingClientRect();
          onSeek(Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width)));
        }}
      >
        <div className="mpw-bar-fill" style={{ width: `${pct}%` }} />
      </div>
      <div className="mpw-time">
        <span className="mpw-current">{fmt(currentTime)}</span>
        <span className="mpw-sep">/</span>
        <span className="mpw-total">{fmt(duration)}</span>
      </div>
    </>
  );
}

/* -------------------------------------------------------------- Controls */

export function Controls({
  isPlaying,
  shuffled,
  loopMode,
  onToggle,
  onNext,
  onPrev,
  onShuffle,
  onLoop,
}: {
  isPlaying: boolean;
  shuffled: boolean;
  loopMode: LoopMode;
  onToggle: () => void;
  onNext: () => void;
  onPrev: () => void;
  onShuffle: () => void;
  onLoop: () => void;
}) {
  return (
    <div className="mpw-controls">
      <button
        className={`mpw-ctrl mpw-ctrl-toggle ${shuffled ? "is-active" : ""}`}
        onClick={onShuffle}
        aria-label="Lecture aléatoire"
        aria-pressed={shuffled}
        title="Lecture aléatoire"
      >
        <svg
          viewBox="0 0 24 24"
          width="15"
          height="15"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M16 3h5v5" />
          <path d="M21 3l-7 7" />
          <path d="M3 21l7-7" />
          <path d="M16 21h5v-5" />
          <path d="M21 21l-7-7" />
          <path d="M3 3l7 7" />
        </svg>
      </button>
      <button className="mpw-ctrl" onClick={onPrev} aria-label="Précédent">
        <svg viewBox="0 0 24 24" width="17" height="17" fill="currentColor">
          <path d="M19 5L8 12l11 7zM5 5h2v14H5z" />
        </svg>
      </button>
      <button className="mpw-ctrl mpw-ctrl-play" onClick={onToggle} aria-label={isPlaying ? "Pause" : "Lecture"}>
        {isPlaying ? (
          <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor">
            <path d="M6 5h3v14H6zM15 5h3v14h-3z" />
          </svg>
        ) : (
          <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor">
            <path d="M7 5v14l11-7z" />
          </svg>
        )}
      </button>
      <button className="mpw-ctrl" onClick={onNext} aria-label="Suivant">
        <svg viewBox="0 0 24 24" width="17" height="17" fill="currentColor">
          <path d="M5 5l11 7L5 19zM17 5h2v14h-2z" />
        </svg>
      </button>
      <button
        className={`mpw-ctrl mpw-ctrl-toggle mpw-ctrl-loop ${loopMode !== "off" ? "is-active" : ""} ${
          loopMode === "one" ? "mode-one" : ""
        }`}
        onClick={onLoop}
        aria-label={
          loopMode === "off" ? "Boucle désactivée" : loopMode === "all" ? "Boucler le projet" : "Boucler le morceau"
        }
        title={loopMode === "off" ? "Boucle" : loopMode === "all" ? "Boucler le projet" : "Boucler le morceau"}
      >
        <svg
          viewBox="0 0 24 24"
          width="15"
          height="15"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M4 12V8a2 2 0 0 1 2-2h12" />
          <path d="M16 3l4 3l-4 3" />
          <path d="M20 12v4a2 2 0 0 1-2 2H6" />
          <path d="M8 21l-4-3l4-3" />
        </svg>
        <span className="mpw-loop-one">1</span>
      </button>
    </div>
  );
}

/* ------------------------------------------- MusicPlayer (self-contained) */

interface State {
  currentIndex: number;
  order: number[];
  shuffled: boolean;
  loopMode: LoopMode;
  isPlaying: boolean;
  direction: Direction;
}
type Action =
  | { type: "PLAY" }
  | { type: "PAUSE" }
  | { type: "SET_TRACK"; index: number; direction: Direction }
  | { type: "TOGGLE_SHUFFLE"; trackCount: number }
  | { type: "CYCLE_LOOP" };

export function shuffleOrder(pinFirst: number, count: number): number[] {
  const rest = Array.from({ length: count }, (_, i) => i).filter((x) => x !== pinFirst);
  for (let i = rest.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [rest[i], rest[j]] = [rest[j], rest[i]];
  }
  return [pinFirst, ...rest];
}

export const nextLoopMode = (m: LoopMode): LoopMode => (m === "off" ? "all" : m === "all" ? "one" : "off");

function reducer(state: State, action: Action): State {
  switch (action.type) {
    case "PLAY":
      return { ...state, isPlaying: true };
    case "PAUSE":
      return { ...state, isPlaying: false };
    case "SET_TRACK":
      return { ...state, currentIndex: action.index, direction: action.direction };
    case "TOGGLE_SHUFFLE": {
      const shuffled = !state.shuffled;
      const order = shuffled
        ? shuffleOrder(state.currentIndex, action.trackCount)
        : Array.from({ length: action.trackCount }, (_, i) => i);
      return { ...state, shuffled, order };
    }
    case "CYCLE_LOOP":
      return { ...state, loopMode: nextLoopMode(state.loopMode) };
    default:
      return state;
  }
}

export interface MusicPlayerProps {
  tracks: Track[];
  crossOrigin?: "anonymous" | "use-credentials";
}

export function MusicPlayer({ tracks, crossOrigin }: MusicPlayerProps) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [isZoomed, setIsZoomed] = useState(false);
  const [state, dispatch] = useReducer(reducer, {
    currentIndex: 0,
    order: Array.from({ length: tracks.length }, (_, i) => i),
    shuffled: false,
    loopMode: "off",
    isPlaying: false,
    direction: null,
  });
  const { getFrequencyData, getBandEnergy } = useAudioAnalyser(audioRef);
  const playTransitionSound = useTransitionSound();
  const current = tracks[state.currentIndex];
  const layers = useTrackLayers(state.currentIndex, current, state.direction);

  const loadTrack = useCallback(
    (index: number, autoplay: boolean, direction: Direction) => {
      const audio = audioRef.current;
      if (!audio) return;
      playTransitionSound(getBandEnergy(0, 4));
      dispatch({ type: "SET_TRACK", index, direction });
      audio.src = tracks[index].src;
      audio.load();
      if (autoplay) audio.play().catch(() => {});
    },
    [tracks, playTransitionSound, getBandEnergy],
  );

  const toggle = useCallback(() => {
    const audio = audioRef.current;
    if (!audio) return;
    if (audio.paused) audio.play().catch(() => {});
    else audio.pause();
  }, []);

  const next = useCallback(() => {
    const audio = audioRef.current;
    if (!audio) return;
    const np = state.order.indexOf(state.currentIndex) + 1;
    if (np >= state.order.length) {
      if (state.loopMode === "all") loadTrack(state.order[0], !audio.paused, "next");
      else {
        audio.pause();
        audio.currentTime = 0;
      }
      return;
    }
    loadTrack(state.order[np], !audio.paused, "next");
  }, [state.order, state.currentIndex, state.loopMode, loadTrack]);

  const prev = useCallback(() => {
    const audio = audioRef.current;
    if (!audio) return;
    if (audio.currentTime > 3) {
      audio.currentTime = 0;
      return;
    }
    const pp = state.order.indexOf(state.currentIndex) - 1;
    if (pp < 0) {
      if (state.loopMode === "all") loadTrack(state.order[state.order.length - 1], !audio.paused, "prev");
      else audio.currentTime = 0;
      return;
    }
    loadTrack(state.order[pp], !audio.paused, "prev");
  }, [state.order, state.currentIndex, state.loopMode, loadTrack]);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    const onPlay = () => dispatch({ type: "PLAY" });
    const onPause = () => dispatch({ type: "PAUSE" });
    const onTime = () => {
      setCurrentTime(audio.currentTime);
      if (audio.duration) setDuration(audio.duration);
    };
    const onEnded = () => {
      if (state.loopMode === "one") {
        audio.currentTime = 0;
        audio.play().catch(() => {});
      } else next();
    };
    audio.addEventListener("play", onPlay);
    audio.addEventListener("pause", onPause);
    audio.addEventListener("loadedmetadata", onTime);
    audio.addEventListener("timeupdate", onTime);
    audio.addEventListener("ended", onEnded);
    return () => {
      audio.removeEventListener("play", onPlay);
      audio.removeEventListener("pause", onPause);
      audio.removeEventListener("loadedmetadata", onTime);
      audio.removeEventListener("timeupdate", onTime);
      audio.removeEventListener("ended", onEnded);
    };
  }, [state.loopMode, next]);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio || !tracks[0]) return;
    audio.src = tracks[0].src;
    audio.load();
  }, [tracks]);

  const shortcuts = useMemo(() => ({ toggle, next, prev }), [toggle, next, prev]);
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).tagName === "INPUT") return;
      if (e.key === " ") {
        e.preventDefault();
        shortcuts.toggle();
      } else if (e.key === "ArrowRight" && e.shiftKey) shortcuts.next();
      else if (e.key === "ArrowLeft" && e.shiftKey) shortcuts.prev();
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [shortcuts]);

  return (
    <div
      className={`mpw-card ${state.isPlaying ? "is-playing" : ""} ${isZoomed ? "is-zoomed" : ""}`}
      onClick={(e) => {
        if (!(e.target as HTMLElement).closest(".mpw-mask")) setIsZoomed(false);
      }}
    >
      <audio ref={audioRef} preload="metadata" crossOrigin={crossOrigin} />
      <Disc
        layers={layers}
        isPlaying={state.isPlaying}
        isZoomed={isZoomed}
        trackKey={state.currentIndex}
        direction={state.direction}
        onZoomToggle={() => setIsZoomed((z) => !z)}
      />
      <div className="mpw-info">
        <ScalesMixer isPlaying={state.isPlaying} getFrequencyData={getFrequencyData} />
        <TrackInfo layers={layers} />
        <ProgressBar
          currentTime={currentTime}
          duration={duration}
          onSeek={(pct) => {
            const a = audioRef.current;
            if (a?.duration) a.currentTime = pct * a.duration;
          }}
        />
        <Controls
          isPlaying={state.isPlaying}
          shuffled={state.shuffled}
          loopMode={state.loopMode}
          onToggle={toggle}
          onNext={next}
          onPrev={prev}
          onShuffle={() => dispatch({ type: "TOGGLE_SHUFFLE", trackCount: tracks.length })}
          onLoop={() => dispatch({ type: "CYCLE_LOOP" })}
        />
      </div>
    </div>
  );
}

export default MusicPlayer;
