"use client";

import { Download, Layers } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { generatedArt } from "@/components/ui/cover";
import { DropdownMenu, type MenuEntry } from "@/components/ui/menu";
import { PlayingBars } from "@/components/ui/misc";
import {
  Controls,
  Disc,
  nextLoopMode,
  ProgressBar,
  ScalesMixer,
  TrackInfo,
  useTrackLayers,
  type Direction,
  type LoopMode,
} from "@/components/ui/music-player-widget";
import { TooltipProvider } from "@/components/ui/slider";
import { useListenTracking } from "./use-listen-tracking";
import { zipDownload } from "./zip-download";
import { prodFileName } from "@/lib/download-name";
import { keyText } from "@/lib/email/studio-template";
import { cn, formatBpm, formatDuration } from "@/lib/utils";
import type { PublicTrack } from "@/lib/project-share-server";

type Permissions = { streaming: boolean; mp3: boolean; wav: boolean; stems: boolean };

/** Owner branding shown on the page (same as the Studio email). */
export type Brand = {
  name: string;
  logoUrl: string | null;
  instagram: string | null;
  heroUrl: string;
};

type Props = {
  token: string;
  brand: Brand;
  project: { id: string; name: string; coverUrl: string | null };
  tracks: PublicTrack[];
  permissions: Permissions;
};

function meta(t: PublicTrack) {
  return [t.bpm ? `${formatBpm(t.bpm)} BPM` : null, keyText(t.key)].filter(Boolean).join(" • ");
}

export function ProjectPlayer({ token, brand, project, tracks, permissions }: Props) {
  const audio = useRef<HTMLAudioElement>(null);
  const counted = useRef(new Set<string>());
  // Track currently loaded in <audio> (events fire after the state update).
  const loaded = useRef<string | null>(null);
  const [index, setIndex] = useState<number | null>(null);
  const [playing, setPlaying] = useState(false);
  const [time, setTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [loopMode, setLoopMode] = useState<LoopMode>("off");
  const [direction, setDirection] = useState<Direction>(null);
  const [zoomed, setZoomed] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tapToPlay, setTapToPlay] = useState(false);

  const playable = useMemo(() => tracks.map((_, i) => i).filter((i) => tracks[i].streamUrl), [tracks]);
  const current = index != null ? tracks[index] : null;
  // Before anything plays, the player shows the first prod.
  const shown = current ?? tracks[playable[0] ?? 0] ?? null;

  const { tracker, flushSoon } = useListenTracking(token, permissions.streaming);
  // The visualizer never touches the sound: no Web Audio routing (it can play the audio
  // sped up on Safari / Bluetooth when sample rates differ). It follows the prod's
  // waveform (computed at upload) at the current playback position instead.
  const peaksRef = useRef<number[] | null>(null);
  useEffect(() => {
    peaksRef.current = current?.peaks ?? null;
  }, [current]);
  const bins = useRef(new Uint8Array(128));
  const getFrequencyData = useCallback((): Uint8Array | null => {
    const a = audio.current;
    const peaks = peaksRef.current;
    const dur = a && Number.isFinite(a.duration) ? a.duration : 0;
    if (!a || !peaks?.length || !dur) return null;
    const at = (sec: number) => {
      const x = Math.max(0, Math.min(peaks.length - 1, (sec / dur) * (peaks.length - 1)));
      return Math.abs(peaks[Math.round(x)] ?? 0);
    };
    const out = bins.current;
    for (let b = 0; b < out.length; b++) {
      // Each band reads slightly further back in time: the motion travels across the dots.
      const v = at(a.currentTime - b * 0.004) * (1 - b / 200);
      out[b] = Math.max(0, Math.min(255, Math.round(v * 255)));
    }
    return out;
  }, []);

  const dl = (kind: string, trackId?: string) =>
    `/api/p/${token}/download?kind=${kind}${trackId ? `&track=${encodeURIComponent(trackId)}` : ""}`;

  /** Current load attempt: one silent retry, then the MP3 copy, before showing an error. */
  const attempt = useRef({ index: -1, retried: false, fallback: false });
  const [buffering, setBuffering] = useState(false);

  const recover = (a: HTMLAudioElement) => {
    const at = attempt.current;
    const t = tracks[at.index];
    if (!t || !a.getAttribute("src")) return;
    const code = a.error?.code;
    const resumeAt = a.currentTime || 0;
    const reload = (src: string) => {
      a.src = src;
      if (resumeAt) a.currentTime = resumeAt;
      // Only resume playback if the visitor had started it (not for the silent preload).
      if (index == null) return void a.load();
      setBuffering(true);
      a.play().catch(() => undefined);
    };
    // The browser can't decode the original (format): go straight to the MP3 copy.
    if (code === MediaError.MEDIA_ERR_SRC_NOT_SUPPORTED || code === MediaError.MEDIA_ERR_DECODE) {
      if (t.fallbackUrl && !at.fallback) {
        at.fallback = true;
        return reload(t.fallbackUrl);
      }
    } else if (!at.retried && t.freshUrl) {
      // Network hiccup: retry once with a fresh link.
      at.retried = true;
      // Expired link or network hiccup: once more through the always-valid address.
      return reload(t.freshUrl);
    } else if (t.fallbackUrl && !at.fallback) {
      at.fallback = true;
      return reload(t.fallbackUrl);
    }
    setBuffering(false);
    setError("Lecture impossible — vérifie ta connexion, réessaie ou télécharge le morceau.");
  };

  const start = useCallback(
    (i: number, opts: { fromEmail?: boolean; dir?: Direction } = {}) => {
      const t = tracks[i];
      const a = audio.current;
      if (!t?.streamUrl || !a) return;
      setError(null);
      // Close the running play before switching tracks.
      tracker.pause(a.currentTime);
      loaded.current = t.id;
      setDirection(opts.dir ?? (index == null ? null : i > index ? "next" : "prev"));
      setIndex(i);
      setTime(0);
      setDuration(t.duration ?? 0);
      attempt.current = { index: i, retried: false, fallback: false };
      // Already preloaded (page opening / next prod): keep the buffer, just play.
      if (a.src !== new URL(t.streamUrl, window.location.href).href) a.src = t.streamUrl;
      setTapToPlay(false);
      setBuffering(true);
      a.play().catch((e: unknown) => {
        const name = e instanceof DOMException ? e.name : "";
        // Another prod was started before this one loaded: not an error.
        if (name === "AbortError") return;
        // The browser wants a tap before playing sound (e.g. arriving from an email).
        if (name === "NotAllowedError") {
          setBuffering(false);
          setTapToPlay(true);
        }
        // Load / decode failures arrive through onError, which retries.
      });
      if (!counted.current.has(t.id)) {
        counted.current.add(t.id);
        void fetch(`/api/p/${token}/play`, { method: "POST" }).catch(() => undefined);
      }
    },
    [tracks, token, tracker, index],
  );

  // ▶ of one prod in the email → /p/{token}?t={trackId}: open the page on that prod.
  useEffect(() => {
    const t = new URLSearchParams(window.location.search).get("t");
    if (!t) return;
    const i = tracks.findIndex((x) => x.id === t && x.streamUrl);
    if (i < 0) return;
    const timer = window.setTimeout(() => {
      start(i, { fromEmail: true });
    }, 0);
    return () => window.clearTimeout(timer);
    // Only on arrival.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const toggle = useCallback(() => {
    const a = audio.current;
    if (!a) return;
    if (index == null) {
      if (playable.length) start(playable[0]);
      return;
    }
    if (a.paused) void a.play();
    else a.pause();
  }, [index, playable, start]);

  /** Next / previous in play order (shuffled or not); `wrap` loops around the project. */
  const step = useCallback(
    (dir: 1 | -1, wrap = loopMode === "all") => {
      const a = audio.current;
      if (index == null) {
        if (playable.length) start(playable[0]);
        return;
      }
      if (dir === -1 && a && a.currentTime > 3) {
        a.currentTime = 0;
        return;
      }
      const pos = playable.indexOf(index);
      let to = pos + dir;
      if (to < 0 || to >= playable.length) {
        if (!wrap) {
          if (dir === -1 && a) a.currentTime = 0;
          return false;
        }
        to = (to + playable.length) % playable.length;
      }
      start(playable[to], { dir: dir === 1 ? "next" : "prev" });
      return true;
    },
    [index, playable, start, loopMode],
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement;
      if (["INPUT", "TEXTAREA"].includes(el.tagName)) return;
      if (e.key === " ") {
        e.preventDefault();
        toggle();
      } else if (e.key === "ArrowRight") step(1, true);
      else if (e.key === "ArrowLeft") step(-1, true);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [toggle, step]);

  const onEnded = () => {
    const a = audio.current;
    if (a) tracker.ended(a.currentTime);
    flushSoon();
    if (loopMode === "one" && a) {
      a.currentTime = 0;
      void a.play();
      return;
    }
    if (!step(1)) setPlaying(false);
  };

  const [zipping, setZipping] = useState<{ label: string; done: number; total: number } | null>(null);

  const zip = (kind: string, name: string, trackId?: string) => {
    if (zipping) return;
    setZipping({ label: name, done: 0, total: 0 });
    zipDownload(dl(kind, trackId), name.replace(/[\/:*?"<>|]+/g, "-"), (done, total) =>
      setZipping({ label: name, done, total }),
    )
      .catch((e) => setError(e instanceof Error ? e.message : "Téléchargement impossible"))
      .finally(() => setZipping(null));
  };

  const trackMenu = (t: PublicTrack): MenuEntry[] => [
    ...(permissions.wav && t.hasWav
      ? [{ label: "Télécharger le WAV", icon: Download, onSelect: () => (location.href = dl("wav", t.id)) }]
      : []),
    ...(permissions.stems && t.stems.length
      ? [
          {
            label: `Télécharger les stems (${t.stems.length})`,
            icon: Layers,
            onSelect: () => zip("stems", `${prodFileName(t)}_Stems.zip`, t.id),
          },
        ]
      : []),
  ];

  /** Download button of the player: this prod, then the whole project. */
  const downloadEntries = (t: PublicTrack | null): MenuEntry[] => {
    const own = t ? trackMenu(t) : [];
    return [
      ...(own.length ? [{ type: "label" as const, label: t!.title }, ...own] : []),
      ...(own.length && allDownloads.length ? [{ type: "separator" as const }] : []),
      ...(allDownloads.length ? [{ type: "label" as const, label: "Tout le projet" }, ...allDownloads] : []),
    ];
  };

  const allDownloads: MenuEntry[] = [
    ...(permissions.wav && tracks.some((t) => t.hasWav)
      ? [{ label: "Tout en WAV (.zip)", icon: Download, onSelect: () => zip("all-wav", `${project.name} (WAV).zip`) }]
      : []),
    ...(permissions.stems && tracks.some((t) => t.stems.length)
      ? [
          {
            label: "Tous les stems (.zip)",
            icon: Layers,
            onSelect: () => zip("all-stems", `${project.name} - Stems.zip`),
          },
        ]
      : []),
  ];

  const layers = useTrackLayers(
    shown?.id ?? "none",
    {
      title: shown?.title ?? project.name,
      artist: shown ? meta(shown) : "",
      byline: brand.name,
      cover: shown?.coverUrl ?? project.coverUrl ?? null,
      fallback: generatedArt(shown?.id ?? project.id).backgroundImage,
    },
    direction,
  );

  const canStream = permissions.streaming && playable.length > 0;

  // First prod loads as soon as the page opens, so ▶ starts it right away.
  useEffect(() => {
    const a = audio.current;
    const first = tracks[playable[0]];
    if (!a || a.getAttribute("src") || !first?.streamUrl) return;
    a.src = first.streamUrl;
    attempt.current = { index: playable[0], retried: false, fallback: false };
    a.load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // While a prod plays, the next one is fetched in the background (instant skip).
  const nextUp = index == null ? null : tracks[playable[(playable.indexOf(index) + 1) % playable.length]];
  useEffect(() => {
    if (!playing || !nextUp?.streamUrl || nextUp === current) return;
    const warm = new Audio();
    warm.preload = "auto";
    warm.muted = true;
    warm.src = nextUp.streamUrl;
    warm.load();
    return () => {
      warm.removeAttribute("src");
      warm.load();
    };
  }, [playing, nextUp, current]);

  return (
    <TooltipProvider>
      <div
        className="relative isolate min-h-dvh overflow-hidden bg-black px-3 pt-8 pb-14 md:pt-14"
        onClick={() => setZoomed(false)}
      >
        {/* Soft halo of the cover's colours behind the glass card (the page stays black). */}
        <div aria-hidden className="mpw-ambient">
          {layers.map((l, i) => (
            <div
              key={l.id}
              className={cn("mpw-ambient-layer", i < layers.length - 1 && "is-leaving")}
              style={{
                backgroundImage: l.track.cover ? `url("${l.track.cover}")` : l.track.fallback,
              }}
            />
          ))}
        </div>
        <div className="relative mx-auto flex max-w-[780px] flex-col gap-10">
          <header className="flex flex-col items-center text-center">
            <p className="pl-[0.45em] text-xl font-light tracking-[0.45em] text-white uppercase md:text-2xl">CREATE</p>
          </header>

          {/* Player */}
          {canStream && shown ? (
            <section className={cn("mpw-card", playing && "is-playing", zoomed && "is-zoomed")}>
              <Disc
                layers={layers}
                isPlaying={playing}
                isZoomed={zoomed}
                trackKey={shown.id}
                direction={direction}
                onZoomToggle={() => setZoomed((z) => !z)}
              />
              <div className="mpw-info">
                <ScalesMixer isPlaying={playing} getFrequencyData={getFrequencyData} />
                <TrackInfo layers={layers} />
                <ProgressBar
                  currentTime={current ? time : 0}
                  duration={current ? duration || current.duration || 0 : (shown.duration ?? 0)}
                  onSeek={(pct) => {
                    const a = audio.current;
                    // Nothing playing yet: start the prod shown, right at the chosen spot.
                    if (!current) start(index ?? playable[0]);
                    const d = a?.duration || (current ?? shown)?.duration || 0;
                    if (a && d) {
                      a.currentTime = pct * d;
                      setTime(pct * d);
                    }
                  }}
                />
                <Controls
                  isPlaying={playing}
                  shuffled={false}
                  loopMode={loopMode}
                  leading={
                    downloadEntries(shown).length ? (
                      <DropdownMenu
                        align="start"
                        entries={downloadEntries(shown)}
                        trigger={
                          <button className="mpw-ctrl" aria-label="Télécharger" title="Télécharger">
                            <Download className="size-4" />
                          </button>
                        }
                      />
                    ) : (
                      <span className="mpw-ctrl" aria-hidden style={{ visibility: "hidden" }} />
                    )
                  }
                  onToggle={toggle}
                  onNext={() => step(1, true)}
                  onPrev={() => step(-1, true)}
                  onShuffle={() => undefined}
                  onLoop={() => setLoopMode(nextLoopMode)}
                />
                {/* Fixed-height status line: messages never push the page (Instagram stays put). */}
                <div className="h-4 min-w-0 truncate text-xs leading-4">
                  {error ? (
                    <span className="text-danger">{error}</span>
                  ) : tapToPlay && !playing ? (
                    <button onClick={toggle} className="font-medium text-white">
                      Appuie sur lecture pour écouter « {shown.title} »
                    </button>
                  ) : buffering && current ? (
                    <span className="text-[#9b9ba3]">Chargement…</span>
                  ) : null}
                </div>
              </div>
            </section>
          ) : (
            <p className="text-center text-[13px] text-[#9b9ba3]">
              {permissions.streaming
                ? "Ce projet est vide pour l’instant."
                : "L’écoute en ligne est désactivée pour ce lien."}
            </p>
          )}

          {/* Prods of the project */}
          {canStream && tracks.length > 1 ? (
            <section className="mpw-list">
              <p className="mb-2 px-3 text-[10.5px] tracking-[0.24em] text-[#8a8a93] uppercase">
                {project.name} · {tracks.length} prods
              </p>
              <ol>
                {tracks.map((t, i) => {
                  const isCurrent = index === i;
                  const menu = trackMenu(t);
                  return (
                    <li key={t.id}>
                      <div
                        role="button"
                        tabIndex={t.streamUrl ? 0 : -1}
                        aria-current={isCurrent || undefined}
                        onClick={(e) => {
                          e.stopPropagation();
                          if (!t.streamUrl) return;
                          if (isCurrent) toggle();
                          else start(i);
                        }}
                        onKeyDown={(e) => {
                          if (e.key !== "Enter" || !t.streamUrl) return;
                          if (isCurrent) toggle();
                          else start(i);
                        }}
                        className={cn("mpw-row", isCurrent && "is-current", !t.streamUrl && "opacity-40")}
                      >
                        <span className="grid w-5 shrink-0 place-items-center text-[12px] text-[#7a7a83] tabular-nums">
                          {isCurrent && playing ? (
                            <PlayingBars className="[&>span]:bg-white" />
                          ) : (
                            i + 1
                          )}
                        </span>
                        <span
                          className="relative size-10 shrink-0 overflow-hidden rounded-lg"
                          style={generatedArt(t.id)}
                        >
                          {t.coverUrl ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img src={t.coverUrl} alt="" className="absolute inset-0 size-full object-cover" loading="lazy" />
                          ) : null}
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className={cn("block truncate text-[14px] font-medium", isCurrent ? "text-white" : "text-[#e4e4e7]")}>
                            {t.title}
                          </span>
                          <span className="block truncate text-[12px] text-[#8a8a93]">{meta(t) || brand.name}</span>
                        </span>
                        <span className="shrink-0 text-[12px] text-[#7a7a83] tabular-nums">{formatDuration(t.duration)}</span>
                        {menu.length ? (
                          <span onClick={(e) => e.stopPropagation()}>
                            <DropdownMenu
                              entries={menu}
                              trigger={
                                <button
                                  className="grid size-8 place-items-center rounded-full text-[#9b9ba3] transition hover:bg-white/10 hover:text-white"
                                  aria-label={`Télécharger ${t.title}`}
                                  title="Télécharger"
                                >
                                  <Download className="size-4" />
                                </button>
                              }
                            />
                          </span>
                        ) : null}
                      </div>
                    </li>
                  );
                })}
              </ol>
            </section>
          ) : null}

          {brand.instagram ? (
            <a
              href={`https://www.instagram.com/${brand.instagram}/`}
              target="_blank"
              rel="noopener noreferrer"
              className="mpw-glass-pill mx-auto -mt-5 px-4 py-2 text-[13px] text-[#d4d4d8] hover:text-white"
            >
              Instagram · @{brand.instagram}
            </a>
          ) : null}
        </div>

        {zipping ? (
          <div className="animate-up fixed top-4 left-1/2 z-50 -translate-x-1/2 rounded-full border border-[#2b2b31] bg-[#151518] px-4 py-2 text-[13px] text-white shadow-xl">
            Préparation de « {zipping.label} »{zipping.total ? ` — ${zipping.done}/${zipping.total} fichiers` : "…"}
          </div>
        ) : null}

        {/* Plain <audio>: the file goes straight to the speakers, never through Web Audio. */}
        <audio
          ref={audio}
          preload="auto"
          onPlay={() => setPlaying(true)}
          onPlaying={(e) => {
            const a = e.currentTarget;
            if (loaded.current)
              tracker.playing(loaded.current, a.currentTime, Number.isFinite(a.duration) ? a.duration : null);
          }}
          onPause={(e) => {
            setPlaying(false);
            tracker.pause(e.currentTarget.currentTime);
            flushSoon();
          }}
          onSeeked={(e) => tracker.seeked(e.currentTarget.currentTime)}
          onEnded={onEnded}
          onTimeUpdate={(e) => {
            const a = e.currentTarget;
            setTime(a.currentTime);
            tracker.time(a.currentTime, Number.isFinite(a.duration) ? a.duration : null);
          }}
          onLoadedMetadata={(e) => Number.isFinite(e.currentTarget.duration) && setDuration(e.currentTarget.duration)}
          onWaiting={() => setBuffering(true)}
          onCanPlay={() => setBuffering(false)}
          onError={(e) => recover(e.currentTarget)}
        />
      </div>
    </TooltipProvider>
  );
}
