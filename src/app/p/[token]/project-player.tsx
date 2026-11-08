"use client";

import { Download, Layers } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { generatedArt } from "@/components/ui/cover";
import { DropdownMenu, type MenuEntry } from "@/components/ui/menu";
import {
  Controls,
  Disc,
  nextLoopMode,
  ProgressBar,
  ScalesMixer,
  TrackInfo,
  useAudioAnalyser,
  useTrackLayers,
  type Direction,
  type LoopMode,
} from "@/components/ui/music-player-widget";
import { TooltipProvider } from "@/components/ui/slider";
import { useListenTracking } from "./use-listen-tracking";
import { zipDownload } from "./zip-download";
import { prodFileName } from "@/lib/download-name";
import { keyText } from "@/lib/email/studio-template";
import { cn, formatBpm } from "@/lib/utils";
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
  // Read-only tap for the visualizer: the audio reaches the speakers unchanged (no effect, no gain).
  const { getFrequencyData } = useAudioAnalyser(audio);

  const dl = (kind: string, trackId?: string) =>
    `/api/p/${token}/download?kind=${kind}${trackId ? `&track=${encodeURIComponent(trackId)}` : ""}`;

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
      a.src = t.streamUrl;
      setTapToPlay(false);
      a.play().catch((e: unknown) => {
        // Arriving from an email, the browser may refuse to start audio without a tap.
        if (opts.fromEmail && e instanceof DOMException && e.name === "NotAllowedError") setTapToPlay(true);
        else setError("Lecture impossible — réessaie ou télécharge le morceau.");
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
    ...(permissions.mp3 && t.hasMp3
      ? [{ label: "Télécharger le MP3", icon: Download, onSelect: () => (location.href = dl("mp3", t.id)) }]
      : []),
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
    ...(permissions.mp3 && tracks.some((t) => t.hasMp3)
      ? [{ label: "Tout en MP3 (.zip)", icon: Download, onSelect: () => zip("all-mp3", `${project.name}.zip`) }]
      : []),
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
      artist: [brand.name, shown ? meta(shown) : ""].filter(Boolean).join(" • "),
      cover: shown?.coverUrl ?? project.coverUrl ?? null,
      fallback: generatedArt(shown?.id ?? project.id).backgroundImage,
    },
    direction,
  );

  const canStream = permissions.streaming && playable.length > 0;

  return (
    <TooltipProvider>
      <div className="min-h-dvh bg-[#0b0b0c] px-3 pt-8 pb-14 md:pt-14" onClick={() => setZoomed(false)}>
        <div className="mx-auto flex max-w-[780px] flex-col gap-10">
          {/* Logo */}
          <header className="flex flex-col items-center text-center">
            {brand.logoUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={brand.logoUrl}
                alt={brand.name}
                className="h-auto max-h-16 w-auto max-w-[200px] object-contain"
              />
            ) : (
              <p className="pl-[0.45em] text-xl font-light tracking-[0.45em] text-white uppercase md:text-2xl">
                {brand.name}
              </p>
            )}
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
                    if (!current) return start(index ?? playable[0]);
                    const d = a?.duration || current.duration || 0;
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
                {error ? <p className="text-danger text-xs">{error}</p> : null}
                {tapToPlay && !playing ? (
                  <button onClick={toggle} className="self-start text-xs font-medium text-white max-sm:self-center">
                    Appuie sur lecture pour écouter « {shown.title} »
                  </button>
                ) : null}
              </div>
            </section>
          ) : (
            <p className="text-center text-[13px] text-[#9b9ba3]">
              {permissions.streaming
                ? "Ce projet est vide pour l’instant."
                : "L’écoute en ligne est désactivée pour ce lien."}
            </p>
          )}

          {permissions.streaming ? (
            <p className="mx-auto max-w-md text-center text-[11px] leading-relaxed text-[#4a4a52]">
              Cette page mesure de façon anonyme les morceaux lancés et la durée écoutée, pour informer l’auteur.
            </p>
          ) : null}
        </div>

        {zipping ? (
          <div className="animate-up fixed top-4 left-1/2 z-50 -translate-x-1/2 rounded-full border border-[#2b2b31] bg-[#151518] px-4 py-2 text-[13px] text-white shadow-xl">
            Préparation de « {zipping.label} »{zipping.total ? ` — ${zipping.done}/${zipping.total} fichiers` : "…"}
          </div>
        ) : null}

        {/* crossOrigin: lets the visualizer read the audio (the storage serves it with CORS). */}
        <audio
          ref={audio}
          preload="none"
          crossOrigin="anonymous"
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
          onError={() => index != null && setError("Lecture impossible — réessaie ou télécharge le morceau.")}
        />
      </div>
    </TooltipProvider>
  );
}
