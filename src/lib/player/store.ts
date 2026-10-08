"use client";

import { toast } from "sonner";
import { create } from "zustand";
import { getEngine } from "@/lib/audio/engine";
import { recordPlay } from "@/lib/data/tracks";
import { signedUrl } from "@/lib/storage";
import type { Track, TrackVersion } from "@/lib/types";

export type PlayItem = {
  trackId: string;
  versionId: string | null;
  versionLabel: string | null;
  title: string;
  artist: string | null;
  bpm: number | null;
  key: string | null;
  coverPath: string | null;
  path: string | null;
  mime: string | null;
  duration: number | null;
};

export type LoopMode = "off" | "all" | "one";

type PlayerState = {
  queue: PlayItem[];
  index: number;
  current: PlayItem | null;
  playing: boolean;
  loading: boolean;
  time: number;
  duration: number;
  volume: number;
  muted: boolean;
  rate: number;
  preservePitch: boolean;
  pitch: number;
  loop: LoopMode;
  autoplay: boolean;

  playTracks: (tracks: Track[], startIndex?: number) => Promise<void>;
  playItem: (item: PlayItem, queue?: PlayItem[]) => Promise<void>;
  toggle: () => void;
  pause: () => void;
  next: () => void;
  prev: () => void;
  seek: (t: number) => void;
  seekFraction: (f: number) => void;
  setVolume: (v: number) => void;
  toggleMute: () => void;
  setRate: (r: number) => void;
  setPreservePitch: (v: boolean) => void;
  setPitch: (semitones: number) => void;
  cycleLoop: () => void;
  setAutoplay: (v: boolean) => void;
  stop: () => void;
  updateCurrentMeta: (patch: Partial<PlayItem>) => void;
};

export function trackToItem(t: Track): PlayItem {
  return {
    trackId: t.id,
    versionId: t.current_version_id,
    versionLabel: null,
    title: t.title,
    artist: t.artist,
    bpm: t.bpm,
    key: t.key,
    coverPath: t.cover_path,
    path: t.preview_path ?? t.file_path,
    mime: t.preview_path ? "audio/mpeg" : t.mime_type,
    duration: t.duration,
  };
}

export function versionToItem(t: Track, v: TrackVersion): PlayItem {
  return {
    ...trackToItem(t),
    versionId: v.id,
    versionLabel: v.label,
    path: v.preview_path ?? v.file_path,
    mime: v.preview_path ? "audio/mpeg" : v.mime_type,
    duration: v.duration,
  };
}

const LS_KEY = "crate.player";

function loadPrefs(): Partial<PlayerState> {
  try {
    return JSON.parse(localStorage.getItem(LS_KEY) || "{}");
  } catch {
    return {};
  }
}

function savePrefs(s: PlayerState) {
  try {
    localStorage.setItem(
      LS_KEY,
      JSON.stringify({ volume: s.volume, muted: s.muted, loop: s.loop, rate: s.rate, preservePitch: s.preservePitch }),
    );
  } catch {
    /* storage unavailable */
  }
}

let wired = false;
let loadToken = 0;

export const usePlayer = create<PlayerState>((set, get) => {
  const engine = typeof window !== "undefined" ? getEngine() : null;

  const start = async (item: PlayItem) => {
    if (!engine) return;
    const token = ++loadToken;
    if (!item.path) {
      toast.error("Ce morceau est encore en cours d'import");
      return;
    }
    set({ current: item, loading: true, time: 0, duration: item.duration ?? 0 });
    const url = await signedUrl(item.path);
    if (token !== loadToken) return;
    if (!url) {
      set({ loading: false, playing: false });
      toast.error("Impossible de charger l'audio");
      return;
    }
    engine.load(url);
    const { rate, preservePitch } = get();
    engine.setRate(rate, preservePitch);
    try {
      await engine.play();
      void recordPlay(item.trackId).catch(() => undefined);
    } catch (e) {
      if ((e as Error).name !== "AbortError") {
        set({ playing: false, loading: false });
        if (/aiff/.test(item.mime ?? "")) toast.error("L'aperçu AIFF est en préparation — réessaie dans un instant");
      }
    }
  };

  const wire = () => {
    if (wired || !engine) return;
    wired = true;
    const a = engine.audio;
    a.addEventListener("play", () => set({ playing: true }));
    a.addEventListener("pause", () => set({ playing: false }));
    a.addEventListener("waiting", () => set({ loading: true }));
    a.addEventListener("playing", () => set({ loading: false }));
    a.addEventListener("canplay", () => set({ loading: false }));
    a.addEventListener("timeupdate", () => set({ time: a.currentTime }));
    a.addEventListener("durationchange", () => {
      if (Number.isFinite(a.duration)) set({ duration: a.duration });
    });
    a.addEventListener("error", () => {
      if (!a.getAttribute("src")) return;
      set({ playing: false, loading: false });
      toast.error("Erreur de lecture", {
        description: "Ce format n'est peut-être pas pris en charge par ton navigateur.",
      });
    });
    a.addEventListener("ended", () => {
      const { loop, queue, index, autoplay } = get();
      if (loop === "one") {
        engine.seek(0);
        void engine.play();
      } else if (index < queue.length - 1 && autoplay) {
        get().next();
      } else if (loop === "all" && queue.length) {
        set({ index: 0 });
        void start(queue[0]);
      } else {
        set({ playing: false, time: 0 });
        engine.seek(0);
      }
    });
    if ("mediaSession" in navigator) {
      navigator.mediaSession.setActionHandler("play", () => get().toggle());
      navigator.mediaSession.setActionHandler("pause", () => get().pause());
      navigator.mediaSession.setActionHandler("nexttrack", () => get().next());
      navigator.mediaSession.setActionHandler("previoustrack", () => get().prev());
    }
  };

  const prefs = typeof window !== "undefined" ? loadPrefs() : {};
  const initial = {
    volume: prefs.volume ?? 0.85,
    muted: prefs.muted ?? false,
    loop: (prefs.loop as LoopMode) ?? "off",
    rate: prefs.rate ?? 1,
    preservePitch: prefs.preservePitch ?? true,
  };
  engine?.setVolume(initial.muted ? 0 : initial.volume);

  return {
    queue: [],
    index: -1,
    current: null,
    playing: false,
    loading: false,
    time: 0,
    duration: 0,
    pitch: 0,
    autoplay: true,
    ...initial,

    playTracks: async (tracks, startIndex = 0) => {
      const queue = tracks.filter((t) => t.file_path).map(trackToItem);
      const target = tracks[startIndex];
      const idx = Math.max(
        0,
        queue.findIndex((q) => q.trackId === target?.id),
      );
      if (!queue.length) {
        toast.error("Rien à lire pour l'instant");
        return;
      }
      await get().playItem(queue[idx], queue);
    },

    playItem: async (item, queue) => {
      wire();
      const q = queue ?? (get().queue.some((x) => x.trackId === item.trackId) ? get().queue : [item]);
      const index = q.findIndex((x) => x.trackId === item.trackId && x.versionId === item.versionId);
      set({ queue: q, index: index === -1 ? 0 : index });
      const cur = get().current;
      if (cur && cur.trackId === item.trackId && cur.versionId === item.versionId && engine?.audio.src) {
        if (engine.audio.paused) await engine.play().catch(() => undefined);
        return;
      }
      await start(item);
    },

    toggle: () => {
      if (!engine) return;
      wire();
      const { current, queue } = get();
      if (!current) {
        if (queue.length) void start(queue[0]);
        return;
      }
      if (engine.audio.paused) {
        if (!engine.audio.getAttribute("src")) void start(current);
        else void engine.play().catch(() => undefined);
      } else engine.pause();
    },

    pause: () => engine?.pause(),

    next: () => {
      const { queue, index, loop } = get();
      if (!queue.length) return;
      let ni = index + 1;
      if (ni >= queue.length) {
        if (loop !== "all") return;
        ni = 0;
      }
      set({ index: ni });
      void start(queue[ni]);
    },

    prev: () => {
      const { queue, index } = get();
      if (!engine) return;
      if (engine.audio.currentTime > 3 || index <= 0) {
        engine.seek(0);
        set({ time: 0 });
        return;
      }
      set({ index: index - 1 });
      void start(queue[index - 1]);
    },

    seek: (t) => {
      engine?.seek(t);
      set({ time: t });
    },

    seekFraction: (f) => {
      const d = get().duration || get().current?.duration || 0;
      if (d) get().seek(Math.max(0, Math.min(1, f)) * d);
    },

    setVolume: (v) => {
      engine?.setVolume(v);
      set({ volume: v, muted: v === 0 });
      savePrefs(get());
    },

    toggleMute: () => {
      const muted = !get().muted;
      engine?.setVolume(muted ? 0 : get().volume || 0.85);
      set({ muted, volume: get().volume || 0.85 });
      savePrefs(get());
    },

    setRate: (r) => {
      engine?.setRate(r, get().preservePitch);
      set({ rate: r });
      savePrefs(get());
    },

    setPreservePitch: (v) => {
      engine?.setRate(get().rate, v);
      set({ preservePitch: v });
      savePrefs(get());
    },

    setPitch: (semitones) => {
      set({ pitch: semitones });
      engine
        ?.setPitch(semitones)
        .catch(() => toast.error("Le changement de hauteur n'est pas disponible dans ce navigateur"));
    },

    cycleLoop: () => {
      const order: LoopMode[] = ["off", "all", "one"];
      set({ loop: order[(order.indexOf(get().loop) + 1) % order.length] });
      savePrefs(get());
    },

    setAutoplay: (v) => set({ autoplay: v }),

    stop: () => {
      engine?.stop();
      set({ current: null, playing: false, queue: [], index: -1, time: 0 });
    },

    updateCurrentMeta: (patch) => {
      const cur = get().current;
      if (cur) set({ current: { ...cur, ...patch } });
    },
  };
});

/** Live playback position for smooth animations (bypasses React state). */
export function currentTime(): number {
  return typeof window !== "undefined" ? getEngine().audio.currentTime : 0;
}
