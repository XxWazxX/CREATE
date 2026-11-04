"use client";

import { ChevronDown, Download, Layers, Play } from "lucide-react";
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
  shuffleOrder,
  TrackInfo,
  useAudioAnalyser,
  useTrackLayers,
  type Direction,
  type LoopMode,
} from "@/components/ui/music-player-widget";
import { TooltipProvider } from "@/components/ui/slider";
import { useListenTracking } from "./use-listen-tracking";
import { zipDownload } from "./zip-download";
import { keyText } from "@/lib/email/studio-template";
import { STEM_LABELS, type StemKind } from "@/lib/music";
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

function Art({ url, seed, className }: { url: string | null; seed: string; className?: string }) {
  return (
    <div className={cn("relative shrink-0 overflow-hidden", className)} style={generatedArt(seed)}>
      {url ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={url} alt="" className="absolute inset-0 size-full object-cover" loading="lazy" />
      ) : null}
    </div>
  );
}

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
  const [shuffled, setShuffled] = useState(false);
  const [order, setOrder] = useState<number[]>(() => tracks.map((_, i) => i));
  const [direction, setDirection] = useState<Direction>(null);
  const [zoomed, setZoomed] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [openStems, setOpenStems] = useState<string | null>(null);
  const [tapToPlay, setTapToPlay] = useState(false);

  const playable = useMemo(() => order.filter((i) => tracks[i]?.streamUrl), [order, tracks]);
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
      document.getElementById(`track-${t}`)?.scrollIntoView({ block: "center", behavior: "smooth" });
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

  const toggleShuffle = () => {
    setShuffled((s) => {
      const on = !s;
      setOrder(on ? shuffleOrder(index ?? playable[0] ?? 0, tracks.length) : tracks.map((_, i) => i));
      return on;
    });
  };

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
            onSelect: () => zip("stems", `${String(t.number).padStart(2, "0")} - ${t.title} - Stems.zip`, t.id),
          },
        ]
      : []),
  ];

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

  const total = tracks.reduce((s, t) => s + (t.duration ?? 0), 0);
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
                  shuffled={shuffled}
                  loopMode={loopMode}
                  onToggle={toggle}
                  onNext={() => step(1, true)}
                  onPrev={() => step(-1, true)}
                  onShuffle={toggleShuffle}
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

          {/* Prods */}
          <section>
            <div className="mb-3 flex items-center justify-between gap-3 px-1">
              <p className="text-[11px] tracking-[0.2em] text-[#6b6b73] uppercase">
                {project.name} · {tracks.length} prod{tracks.length > 1 ? "s" : ""}
                {total ? ` · ${Math.round(total / 60)} min` : ""}
              </p>
              {allDownloads.length === 1 ? (
                <button
                  onClick={() => {
                    const only = allDownloads[0];
                    if (!only.type || only.type === "item") only.onSelect();
                  }}
                  className="inline-flex items-center gap-1.5 text-[12px] text-[#9b9ba3] hover:text-white"
                >
                  <Download className="size-3.5" /> Tout télécharger
                </button>
              ) : allDownloads.length > 1 ? (
                <DropdownMenu
                  align="end"
                  entries={allDownloads}
                  trigger={
                    <button className="inline-flex items-center gap-1.5 text-[12px] text-[#9b9ba3] hover:text-white">
                      <Download className="size-3.5" /> Tout télécharger <ChevronDown className="size-3" />
                    </button>
                  }
                />
              ) : null}
            </div>
            <ol className="divide-y divide-[#1f1f23] overflow-hidden rounded-2xl border border-[#26262a] bg-[#111113]">
              {tracks.map((t, i) => {
                const isCurrent = index === i;
                const menu = trackMenu(t);
                return (
                  <li key={t.id} id={`track-${t.id}`} className={cn("group", isCurrent && "bg-white/[0.04]")}>
                    <div
                      onClick={() => (t.streamUrl ? (isCurrent ? toggle() : start(i)) : undefined)}
                      className={cn(
                        "flex items-center gap-3 px-3 py-2.5 md:px-4",
                        t.streamUrl && "cursor-pointer hover:bg-white/[0.03]",
                      )}
                    >
                      <span className="relative grid w-6 shrink-0 place-items-center">
                        {isCurrent && playing ? (
                          <PlayingBars className="[&_span]:bg-white" />
                        ) : (
                          <>
                            <span
                              className={cn(
                                "font-mono text-xs text-[#6b6b73] tabular-nums",
                                t.streamUrl && "group-hover:invisible",
                                isCurrent && "text-white",
                              )}
                            >
                              {String(t.number).padStart(2, "0")}
                            </span>
                            {t.streamUrl ? (
                              <Play
                                className="invisible absolute size-3.5 text-white group-hover:visible"
                                fill="currentColor"
                              />
                            ) : null}
                          </>
                        )}
                      </span>
                      <Art url={t.coverUrl ?? project.coverUrl} seed={t.id} className="size-11 rounded-lg" />
                      <div className="min-w-0 flex-1">
                        <p
                          className={cn(
                            "truncate text-[13px] font-semibold tracking-[0.1em] uppercase",
                            isCurrent ? "text-white" : "text-[#ececee]",
                          )}
                        >
                          {t.title}
                        </p>
                        <p className="mt-1 truncate text-[11px] tracking-[0.12em] text-[#9b9ba3] uppercase">
                          {meta(t) || " "}
                        </p>
                      </div>
                      {t.stems.length ? (
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            setOpenStems(openStems === t.id ? null : t.id);
                          }}
                          className="hidden items-center gap-1 rounded-md px-2 py-1 text-[11px] text-[#6b6b73] hover:text-white sm:inline-flex"
                        >
                          <Layers className="size-3" /> {t.stems.length} stems
                        </button>
                      ) : null}
                      <span className="w-10 shrink-0 text-right font-mono text-[12px] text-[#9b9ba3] tabular-nums">
                        {formatDuration(t.duration)}
                      </span>
                      <div onClick={(e) => e.stopPropagation()} className="w-8 shrink-0">
                        {menu.length ? (
                          <DropdownMenu
                            entries={menu}
                            trigger={
                              <button
                                className="grid size-8 place-items-center rounded-md text-[#6b6b73] hover:bg-white/10 hover:text-white"
                                aria-label={`Télécharger ${t.title}`}
                              >
                                <Download className="size-4" />
                              </button>
                            }
                          />
                        ) : null}
                      </div>
                    </div>
                    {t.stems.length && openStems === t.id ? (
                      <div className="flex flex-wrap items-center gap-1.5 px-3 pb-3 md:pl-[100px]">
                        <span className="text-[11px] tracking-wider text-[#6b6b73] uppercase">Stems</span>
                        {t.stems.map((s) => (
                          <span
                            key={s.id}
                            className="rounded-full border border-[#2b2b31] px-2 py-0.5 text-[11px] text-[#9b9ba3]"
                            title={s.name}
                          >
                            {STEM_LABELS[s.kind as StemKind] ?? s.name}
                          </span>
                        ))}
                        {permissions.stems ? (
                          <button
                            onClick={() =>
                              zip("stems", `${String(t.number).padStart(2, "0")} - ${t.title} - Stems.zip`, t.id)
                            }
                            className="ml-1 inline-flex items-center gap-1 text-xs text-white hover:underline"
                          >
                            <Download className="size-3" /> Télécharger les stems
                          </button>
                        ) : null}
                      </div>
                    ) : null}
                  </li>
                );
              })}
              {tracks.length === 0 ? (
                <li className="px-4 py-10 text-center text-sm text-[#9b9ba3]">Ce projet est vide pour l’instant.</li>
              ) : null}
            </ol>
          </section>

          {/* Footer */}
          <footer className="text-center text-[13px] leading-relaxed text-[#9b9ba3]">
            <p>Merci pour ton écoute et ton retour.</p>
            <p>À bientôt.</p>
            {brand.instagram ? (
              <a
                href={`https://www.instagram.com/${brand.instagram}/`}
                target="_blank"
                rel="noopener noreferrer"
                className="mt-2 inline-block underline hover:text-white"
              >
                Instagram · @{brand.instagram}
              </a>
            ) : null}
            {permissions.streaming ? (
              <p className="mx-auto mt-6 max-w-md text-[11px] text-[#6b6b73]">
                Pour informer l’auteur, cette page mesure de façon anonyme les morceaux lancés et la durée écoutée.
                Aucune donnée publicitaire, aucune empreinte de ton appareil.
              </p>
            ) : null}
            <p className="mt-3 text-[10px] tracking-[0.2em] text-[#4a4a52]">LIEN PRIVÉ · CREATE</p>
          </footer>
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
