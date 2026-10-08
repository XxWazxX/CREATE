"use client";

import {
  ChevronDown,
  Download,
  Layers,
  ListEnd,
  Pause,
  Play,
  Repeat1,
  SkipBack,
  SkipForward,
  Volume2,
  VolumeX,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { Logo } from "@/components/app/sidebar";
import { generatedArt } from "@/components/ui/cover";
import { DropdownMenu, type MenuEntry } from "@/components/ui/menu";
import { PlayingBars } from "@/components/ui/misc";
import { Slider, TooltipProvider } from "@/components/ui/slider";
import { Waveform } from "@/components/ui/waveform";
import { zipDownload } from "./zip-download";
import { keyLabel, STEM_LABELS, type StemKind } from "@/lib/music";
import { cn, formatBpm, formatDuration } from "@/lib/utils";
import type { PublicTrack } from "@/lib/project-share-server";

type Permissions = { streaming: boolean; mp3: boolean; wav: boolean; stems: boolean };

type Props = {
  token: string;
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
  return [t.bpm ? `${formatBpm(t.bpm)} BPM` : null, keyLabel(t.key) || null, t.genre].filter(Boolean).join(" · ");
}

export function ProjectPlayer({ token, project, tracks, permissions }: Props) {
  const audio = useRef<HTMLAudioElement>(null);
  const counted = useRef(new Set<string>());
  const [index, setIndex] = useState<number | null>(null);
  const [playing, setPlaying] = useState(false);
  const [time, setTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolume] = useState(0.9);
  const [muted, setMuted] = useState(false);
  const [loopOne, setLoopOne] = useState(false);
  const [autoplay, setAutoplay] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [openStems, setOpenStems] = useState<string | null>(null);

  const current = index != null ? tracks[index] : null;
  const dl = (kind: string, trackId?: string) =>
    `/api/p/${token}/download?kind=${kind}${trackId ? `&track=${encodeURIComponent(trackId)}` : ""}`;

  const start = useCallback(
    (i: number) => {
      const t = tracks[i];
      const a = audio.current;
      if (!t?.streamUrl || !a) return;
      setError(null);
      setIndex(i);
      setTime(0);
      setDuration(t.duration ?? 0);
      a.src = t.streamUrl;
      a.play().catch(() => setError("Lecture impossible — réessaie ou télécharge le morceau."));
      if (!counted.current.has(t.id)) {
        counted.current.add(t.id);
        void fetch(`/api/p/${token}/play`, { method: "POST" }).catch(() => undefined);
      }
    },
    [tracks, token],
  );

  const toggle = useCallback(() => {
    const a = audio.current;
    if (!a) return;
    if (index == null) {
      const first = tracks.findIndex((t) => t.streamUrl);
      if (first >= 0) start(first);
      return;
    }
    if (a.paused) void a.play();
    else a.pause();
  }, [index, tracks, start]);

  const step = useCallback(
    (dir: 1 | -1) => {
      if (index == null) return;
      const a = audio.current;
      if (dir === -1 && a && a.currentTime > 3) {
        a.currentTime = 0;
        return;
      }
      for (let i = index + dir; i >= 0 && i < tracks.length; i += dir) {
        if (tracks[i].streamUrl) return start(i);
      }
    },
    [index, tracks, start],
  );

  useEffect(() => {
    if (audio.current) audio.current.volume = muted ? 0 : volume;
  }, [volume, muted]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement;
      if (["INPUT", "TEXTAREA"].includes(el.tagName)) return;
      if (e.key === " ") {
        e.preventDefault();
        toggle();
      } else if (e.key === "ArrowRight") step(1);
      else if (e.key === "ArrowLeft") step(-1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [toggle, step]);

  const onEnded = () => {
    const a = audio.current;
    if (loopOne && a) {
      a.currentTime = 0;
      void a.play();
    } else if (autoplay && index != null) {
      const next = tracks.findIndex((t, i) => i > index && t.streamUrl);
      if (next >= 0) start(next);
      else setPlaying(false);
    } else setPlaying(false);
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

  const total = tracks.reduce((s, t) => s + (t.duration ?? 0), 0);

  return (
    <TooltipProvider>
      <div className={cn("bg-bg min-h-dvh", current && "pb-40 md:pb-32")}>
        {/* Header */}
        <header className="mx-auto flex max-w-4xl flex-col items-center gap-6 px-4 pt-10 pb-8 text-center sm:flex-row sm:items-end sm:text-left md:px-8 md:pt-16">
          <Art
            url={project.coverUrl}
            seed={project.id}
            className="size-40 rounded-2xl shadow-2xl shadow-black/50 md:size-52"
          />
          <div className="min-w-0 flex-1">
            <p className="text-faint text-[11px] font-medium tracking-[0.2em] uppercase">Projet partagé</p>
            <h1 className="mt-1 truncate text-3xl font-semibold tracking-tight md:text-5xl">{project.name}</h1>
            <p className="text-muted mt-2 text-sm">
              {tracks.length} production{tracks.length > 1 ? "s" : ""}
              {total ? ` · ${Math.round(total / 60)} min` : ""}
            </p>
            <div className="mt-5 flex flex-wrap items-center justify-center gap-2 sm:justify-start">
              {permissions.streaming && tracks.some((t) => t.streamUrl) ? (
                <button
                  onClick={toggle}
                  className="bg-accent text-accent-fg inline-flex h-10 items-center gap-2 rounded-full px-5 text-sm font-medium hover:brightness-110"
                >
                  {playing ? (
                    <Pause className="size-4" fill="currentColor" />
                  ) : (
                    <Play className="size-4" fill="currentColor" />
                  )}
                  {playing ? "Pause" : "Tout écouter"}
                </button>
              ) : null}
              {allDownloads.length === 1 ? (
                <button
                  onClick={() => {
                    const only = allDownloads[0];
                    if (!only.type || only.type === "item") only.onSelect();
                  }}
                  className="border-line-strong hover:bg-hover inline-flex h-10 items-center gap-2 rounded-full border px-5 text-sm font-medium"
                >
                  <Download className="size-4" /> Tout télécharger
                </button>
              ) : allDownloads.length > 1 ? (
                <DropdownMenu
                  align="start"
                  entries={allDownloads}
                  trigger={
                    <button className="border-line-strong hover:bg-hover inline-flex h-10 items-center gap-2 rounded-full border px-5 text-sm font-medium">
                      <Download className="size-4" /> Tout télécharger <ChevronDown className="size-3.5" />
                    </button>
                  }
                />
              ) : null}
            </div>
          </div>
        </header>

        {!permissions.streaming ? (
          <p className="text-muted mx-auto max-w-4xl px-4 pb-4 text-[13px] md:px-8">
            L’écoute en ligne est désactivée pour ce lien.
          </p>
        ) : null}

        {/* Track list */}
        <ol className="divide-line border-line mx-auto max-w-4xl divide-y border-y md:rounded-2xl md:border">
          {tracks.length === 0 ? (
            <li className="text-muted px-4 py-10 text-center text-sm">Ce projet est vide pour l’instant.</li>
          ) : null}
          {tracks.map((t, i) => {
            const isCurrent = index === i;
            const menu = trackMenu(t);
            return (
              <li key={t.id} className={cn("group", isCurrent && "bg-hover/50")}>
                <div
                  onClick={() => (t.streamUrl ? (isCurrent ? toggle() : start(i)) : undefined)}
                  className={cn(
                    "flex items-center gap-3 px-3 py-2.5 md:px-4",
                    t.streamUrl && "hover:bg-hover/60 cursor-pointer",
                  )}
                >
                  <span className="relative grid w-7 shrink-0 place-items-center">
                    {isCurrent && playing ? (
                      <PlayingBars />
                    ) : (
                      <span
                        className={cn(
                          "tabular text-faint font-mono text-xs",
                          t.streamUrl && "group-hover:invisible",
                          isCurrent && "text-accent",
                        )}
                      >
                        {String(t.number).padStart(2, "0")}
                      </span>
                    )}
                    {t.streamUrl && !(isCurrent && playing) ? (
                      <Play className="text-fg invisible absolute size-4 group-hover:visible" fill="currentColor" />
                    ) : null}
                  </span>
                  <Art url={t.coverUrl} seed={t.id} className="size-10 rounded-md" />
                  <div className="min-w-0 flex-1">
                    <p className={cn("truncate text-[14px] font-medium", isCurrent && "text-accent")}>{t.title}</p>
                    <p className="text-muted truncate text-xs">{meta(t) || " "}</p>
                  </div>
                  {t.stems.length ? (
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        setOpenStems(openStems === t.id ? null : t.id);
                      }}
                      className="text-faint hover:text-fg hidden items-center gap-1 rounded-md px-2 py-1 text-xs sm:inline-flex"
                    >
                      <Layers className="size-3.5" /> {t.stems.length} stems
                    </button>
                  ) : null}
                  <span className="tabular text-faint w-10 text-right font-mono text-xs">
                    {formatDuration(t.duration)}
                  </span>
                  <div onClick={(e) => e.stopPropagation()} className="w-8">
                    {menu.length ? (
                      <DropdownMenu
                        entries={menu}
                        trigger={
                          <button
                            className="text-faint hover:text-fg hover:bg-active grid size-8 place-items-center rounded-md"
                            aria-label={`Télécharger ${t.title}`}
                          >
                            <Download className="size-4" />
                          </button>
                        }
                      />
                    ) : null}
                  </div>
                </div>
                {openStems === t.id || (isCurrent && t.stems.length && openStems === null) ? (
                  <div className="flex flex-wrap items-center gap-1.5 px-3 pb-3 pl-[88px] md:px-4 md:pl-[92px]">
                    <span className="text-faint text-[11px] tracking-wider uppercase">Stems</span>
                    {t.stems.map((s) => (
                      <span
                        key={s.id}
                        className="border-line-strong text-muted rounded-full border px-2 py-0.5 text-[11px]"
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
                        className="text-accent ml-1 inline-flex items-center gap-1 text-xs hover:underline"
                      >
                        <Download className="size-3" /> Télécharger les stems
                      </button>
                    ) : null}
                  </div>
                ) : null}
              </li>
            );
          })}
        </ol>

        {zipping ? (
          <div className="border-line-strong bg-raised animate-up fixed top-4 left-1/2 z-50 -translate-x-1/2 rounded-full border px-4 py-2 text-[13px] shadow-xl">
            Préparation de « {zipping.label} »{zipping.total ? ` — ${zipping.done}/${zipping.total} fichiers` : "…"}
          </div>
        ) : null}

        <footer className="text-faint mx-auto mt-10 flex max-w-4xl items-center justify-center gap-2 px-4 pb-10 text-[11px] tracking-[0.2em]">
          <Logo className="size-3.5" /> LIEN PRIVÉ · CREATE
        </footer>

        {/* Persistent player */}
        {current ? (
          <div className="border-line bg-panel/95 animate-up fixed inset-x-0 bottom-0 z-40 border-t pb-[env(safe-area-inset-bottom)] backdrop-blur">
            <div className="mx-auto flex max-w-5xl flex-col gap-2 px-4 py-3 md:flex-row md:items-center md:gap-5">
              <div className="flex min-w-0 items-center gap-3 md:w-60">
                <Art url={current.coverUrl} seed={current.id} className="size-11 rounded-md" />
                <div className="min-w-0">
                  <p className="truncate text-[13px] font-medium">
                    <span className="text-faint mr-1.5 font-mono text-[11px]">
                      {String(current.number).padStart(2, "0")}
                    </span>
                    {current.title}
                  </p>
                  <p className="text-muted truncate text-xs">{meta(current) || " "}</p>
                </div>
              </div>

              <div className="flex min-w-0 flex-1 flex-col gap-1">
                <div className="flex items-center justify-center gap-4">
                  <button
                    onClick={() => setLoopOne((v) => !v)}
                    className={cn("p-1", loopOne ? "text-accent" : "text-faint hover:text-fg")}
                    aria-label="Boucler le morceau"
                    title="Boucler le morceau"
                  >
                    <Repeat1 className="size-4" />
                  </button>
                  <button
                    onClick={() => step(-1)}
                    className="text-muted hover:text-fg flex items-center gap-1 p-1 text-xs"
                    aria-label="Précédent"
                  >
                    <SkipBack className="size-4" fill="currentColor" />
                  </button>
                  <button
                    onClick={toggle}
                    className="bg-fg text-bg grid size-9 place-items-center rounded-full transition hover:scale-105"
                    aria-label={playing ? "Pause" : "Lecture"}
                  >
                    {playing ? (
                      <Pause className="size-4" fill="currentColor" />
                    ) : (
                      <Play className="size-4 translate-x-px" fill="currentColor" />
                    )}
                  </button>
                  <button
                    onClick={() => step(1)}
                    className="text-muted hover:text-fg flex items-center gap-1 p-1 text-xs"
                    aria-label="Suivant"
                  >
                    <SkipForward className="size-4" fill="currentColor" />
                  </button>
                  <button
                    onClick={() => setAutoplay((v) => !v)}
                    className={cn("p-1", autoplay ? "text-accent" : "text-faint hover:text-fg")}
                    aria-label="Enchaîner automatiquement"
                    title={autoplay ? "Enchaînement automatique activé" : "Enchaînement automatique désactivé"}
                  >
                    <ListEnd className="size-4" />
                  </button>
                </div>
                <div className="flex items-center gap-3">
                  <span className="tabular text-faint w-10 text-right font-mono text-[11px]">
                    {formatDuration(time)}
                  </span>
                  <Waveform
                    key={current.id}
                    peaks={current.peaks}
                    duration={duration || current.duration}
                    time={time}
                    getTime={() => audio.current?.currentTime ?? 0}
                    animate={playing}
                    onSeek={(s) => {
                      if (audio.current) audio.current.currentTime = s;
                      setTime(s);
                    }}
                    height={30}
                    className="flex-1"
                  />
                  <span className="tabular text-faint w-10 font-mono text-[11px]">
                    {formatDuration(duration || current.duration)}
                  </span>
                </div>
                {error ? <p className="text-danger text-center text-xs">{error}</p> : null}
              </div>

              <div className="hidden w-36 items-center gap-2 md:flex">
                <button
                  onClick={() => setMuted((m) => !m)}
                  className="text-muted hover:text-fg p-1"
                  aria-label={muted ? "Réactiver le son" : "Couper le son"}
                >
                  {muted || volume === 0 ? <VolumeX className="size-4" /> : <Volume2 className="size-4" />}
                </button>
                <Slider
                  label="Volume"
                  value={muted ? 0 : volume}
                  onChange={(v) => {
                    setVolume(v);
                    setMuted(v === 0);
                  }}
                />
              </div>
            </div>
          </div>
        ) : null}

        <audio
          ref={audio}
          preload="none"
          onPlay={() => setPlaying(true)}
          onPause={() => setPlaying(false)}
          onEnded={onEnded}
          onTimeUpdate={(e) => setTime(e.currentTarget.currentTime)}
          onLoadedMetadata={(e) => Number.isFinite(e.currentTarget.duration) && setDuration(e.currentTarget.duration)}
          onError={() => index != null && setError("Lecture impossible — réessaie ou télécharge le morceau.")}
        />
      </div>
    </TooltipProvider>
  );
}
