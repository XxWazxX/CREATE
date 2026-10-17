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
import { generatedArt } from "@/components/ui/cover";
import { DropdownMenu, type MenuEntry } from "@/components/ui/menu";
import { Slider, TooltipProvider } from "@/components/ui/slider";
import { Waveform } from "@/components/ui/waveform";
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
  message: string;
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
  const [volume, setVolume] = useState(0.9);
  const [muted, setMuted] = useState(false);
  const [loopOne, setLoopOne] = useState(false);
  const [autoplay, setAutoplay] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [openStems, setOpenStems] = useState<string | null>(null);
  const [tapToPlay, setTapToPlay] = useState(false);

  const current = index != null ? tracks[index] : null;
  const { tracker, flushSoon } = useListenTracking(token, permissions.streaming);
  const dl = (kind: string, trackId?: string) =>
    `/api/p/${token}/download?kind=${kind}${trackId ? `&track=${encodeURIComponent(trackId)}` : ""}`;

  const start = useCallback(
    (i: number, opts: { fromEmail?: boolean } = {}) => {
      const t = tracks[i];
      const a = audio.current;
      if (!t?.streamUrl || !a) return;
      setError(null);
      // Close the running play before switching tracks.
      tracker.pause(a.currentTime);
      loaded.current = t.id;
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
    [tracks, token, tracker],
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
    if (a) tracker.ended(a.currentTime);
    flushSoon();
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
  const message = brand.message.trim();

  return (
    <TooltipProvider>
      <div className={cn("min-h-dvh bg-[#0b0b0c] px-3 py-6 md:py-12", current && "pb-44 md:pb-36")}>
        <main className="mx-auto max-w-[760px] rounded-2xl bg-[#141416] px-4 pt-10 pb-8 shadow-2xl shadow-black/60 md:px-10 md:pt-14">
          {/* Logo */}
          <header className="flex flex-col items-center text-center">
            {brand.logoUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={brand.logoUrl}
                alt={brand.name}
                className="h-auto max-h-20 w-auto max-w-[220px] object-contain"
              />
            ) : (
              <>
                <p className="pl-[0.45em] text-2xl font-light tracking-[0.45em] text-white uppercase md:text-3xl">
                  {brand.name}
                </p>
                <div className="mt-3 flex items-center gap-1" aria-hidden>
                  {[6, 12, 18, 24, 14, 20, 10, 16, 8].map((h, i) => (
                    <span key={i} className="w-0.5 rounded-full bg-white" style={{ height: h }} />
                  ))}
                </div>
              </>
            )}
          </header>

          {/* Message */}
          {message ? (
            <div className="mx-auto mt-8 max-w-xl space-y-3 text-[15px] leading-relaxed text-white md:text-[17px]">
              {message.split(/\n{2,}/).map((p, i) => (
                <p key={i} className="whitespace-pre-line">
                  {p}
                </p>
              ))}
            </div>
          ) : null}

          {/* Main action */}
          <div className="mt-8 flex flex-col items-center gap-3">
            {permissions.streaming && tracks.some((t) => t.streamUrl) ? (
              <button
                onClick={toggle}
                className="inline-flex h-14 w-full max-w-sm items-center justify-center gap-3 rounded-xl bg-white text-[13px] font-bold tracking-[0.22em] text-[#0b0b0c] uppercase transition hover:bg-white/90"
              >
                {playing ? (
                  <Pause className="size-4" fill="currentColor" />
                ) : (
                  <Play className="size-4" fill="currentColor" />
                )}
                {playing ? "Pause" : "Écouter les prods"}
              </button>
            ) : (
              <p className="text-muted text-[13px]">L’écoute en ligne est désactivée pour ce lien.</p>
            )}
            <p className="text-[12px] text-[#9b9ba3]">Lien sécurisé • Accès privé • Écoute en haute qualité</p>
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
                align="center"
                entries={allDownloads}
                trigger={
                  <button className="inline-flex items-center gap-1.5 text-[12px] text-[#9b9ba3] hover:text-white">
                    <Download className="size-3.5" /> Tout télécharger <ChevronDown className="size-3" />
                  </button>
                }
              />
            ) : null}
          </div>

          {/* Studio photo */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={brand.heroUrl} alt="" className="mt-8 aspect-[860/272] w-full rounded-xl object-cover" />

          {/* Prods */}
          <p className="mt-8 mb-3 text-[11px] tracking-[0.2em] text-[#6b6b73] uppercase">
            {project.name} · {tracks.length} prod{tracks.length > 1 ? "s" : ""}
            {total ? ` · ${Math.round(total / 60)} min` : ""}
          </p>
          <ol className="divide-y divide-[#26262a] overflow-hidden rounded-xl border border-[#26262a]">
            {tracks.length === 0 ? (
              <li className="px-4 py-10 text-center text-sm text-[#9b9ba3]">Ce projet est vide pour l’instant.</li>
            ) : null}
            {tracks.map((t, i) => {
              const isCurrent = index === i;
              const menu = trackMenu(t);
              return (
                <li key={t.id} id={`track-${t.id}`} className={cn(isCurrent && "bg-white/[0.03]")}>
                  <div className="flex items-center gap-3 px-3 py-3 md:gap-4 md:px-4">
                    <button
                      onClick={() => (t.streamUrl ? (isCurrent ? toggle() : start(i)) : undefined)}
                      className="shrink-0"
                      aria-label={`Écouter ${t.title}`}
                      disabled={!t.streamUrl}
                    >
                      <Art url={t.coverUrl ?? project.coverUrl} seed={t.id} className="size-12 rounded-md md:size-14" />
                    </button>
                    <button
                      onClick={() => (t.streamUrl ? (isCurrent ? toggle() : start(i)) : undefined)}
                      className="min-w-0 flex-1 text-left md:w-44 md:flex-none"
                      disabled={!t.streamUrl}
                    >
                      <p className="truncate text-[13px] font-semibold tracking-[0.14em] text-white uppercase">
                        {t.title}
                      </p>
                      <p className="mt-1.5 truncate text-[11px] tracking-[0.14em] text-[#9b9ba3] uppercase">
                        {meta(t) || " "}
                      </p>
                    </button>
                    <div className="hidden min-w-0 flex-1 md:block">
                      <Waveform
                        peaks={t.peaks}
                        duration={isCurrent ? duration || t.duration : t.duration}
                        time={isCurrent ? time : 0}
                        getTime={isCurrent ? () => audio.current?.currentTime ?? 0 : undefined}
                        animate={isCurrent && playing}
                        onSeek={(s) => {
                          if (!t.streamUrl) return;
                          if (!isCurrent) return start(i);
                          if (audio.current) audio.current.currentTime = s;
                          setTime(s);
                        }}
                        height={30}
                        className="w-full"
                      />
                    </div>
                    <span className="w-10 shrink-0 text-right font-mono text-[12px] text-[#9b9ba3] tabular-nums">
                      {formatDuration(t.duration)}
                    </span>
                    <button
                      onClick={() => (isCurrent ? toggle() : start(i))}
                      disabled={!t.streamUrl}
                      className={cn(
                        "grid size-10 shrink-0 place-items-center rounded-full border-2 border-white text-white transition disabled:opacity-30",
                        isCurrent && playing ? "bg-white text-[#0b0b0c]" : "hover:bg-white/10",
                      )}
                      aria-label={isCurrent && playing ? "Pause" : `Écouter ${t.title}`}
                    >
                      {isCurrent && playing ? (
                        <Pause className="size-4" fill="currentColor" />
                      ) : (
                        <Play className="size-4 translate-x-px" fill="currentColor" />
                      )}
                    </button>
                    {menu.length ? (
                      <div onClick={(e) => e.stopPropagation()} className="-ml-1 shrink-0">
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
                      </div>
                    ) : null}
                  </div>
                  {t.stems.length && (openStems === t.id || (isCurrent && openStems === null)) ? (
                    <div className="flex flex-wrap items-center gap-1.5 px-3 pb-3 md:px-4 md:pl-[88px]">
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
                  ) : t.stems.length ? (
                    <button
                      onClick={() => setOpenStems(t.id)}
                      className="mb-2 ml-3 inline-flex items-center gap-1 text-[11px] text-[#6b6b73] hover:text-white md:ml-[88px]"
                    >
                      <Layers className="size-3" /> {t.stems.length} stems
                    </button>
                  ) : null}
                </li>
              );
            })}
          </ol>

          {/* Footer */}
          <div className="mt-8 border-t border-[#26262a] pt-8 text-center text-[14px] leading-relaxed text-[#9b9ba3]">
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
          </div>
        </main>

        <p className="mx-auto mt-6 max-w-md px-4 text-center text-[11px] leading-relaxed text-[#6b6b73]">
          {permissions.streaming
            ? "Pour informer l’auteur, cette page mesure de façon anonyme les morceaux lancés et la durée écoutée. Aucune donnée publicitaire, aucune empreinte de ton appareil."
            : null}
        </p>
        <p className="mt-3 flex items-center justify-center gap-2 text-[10px] tracking-[0.2em] text-[#4a4a52]">
          {" "}
          LIEN PRIVÉ · CREATE
        </p>

        {zipping ? (
          <div className="animate-up fixed top-4 left-1/2 z-50 -translate-x-1/2 rounded-full border border-[#2b2b31] bg-[#151518] px-4 py-2 text-[13px] text-white shadow-xl">
            Préparation de « {zipping.label} »{zipping.total ? ` — ${zipping.done}/${zipping.total} fichiers` : "…"}
          </div>
        ) : null}

        {/* Persistent player */}
        {current ? (
          <div className="animate-up fixed inset-x-0 bottom-0 z-40 border-t border-[#26262a] bg-[#101012]/95 pb-[env(safe-area-inset-bottom)] backdrop-blur">
            <div className="mx-auto flex max-w-[760px] flex-col gap-2 px-4 py-3 md:flex-row md:items-center md:gap-5">
              <div className="flex min-w-0 items-center gap-3 md:w-56">
                <Art url={current.coverUrl ?? project.coverUrl} seed={current.id} className="size-11 rounded-md" />
                <div className="min-w-0">
                  <p className="truncate text-[12px] font-semibold tracking-[0.12em] text-white uppercase">
                    {current.title}
                  </p>
                  <p className="truncate text-[11px] tracking-[0.12em] text-[#9b9ba3] uppercase">
                    {meta(current) || " "}
                  </p>
                </div>
              </div>

              <div className="flex min-w-0 flex-1 flex-col gap-1">
                <div className="flex items-center justify-center gap-4">
                  <button
                    onClick={() => setLoopOne((v) => !v)}
                    className={cn("p-1", loopOne ? "text-white" : "text-[#6b6b73] hover:text-white")}
                    aria-label="Boucler le morceau"
                    title="Boucler le morceau"
                  >
                    <Repeat1 className="size-4" />
                  </button>
                  <button
                    onClick={() => step(-1)}
                    className="p-1 text-[#9b9ba3] hover:text-white"
                    aria-label="Précédent"
                  >
                    <SkipBack className="size-4" fill="currentColor" />
                  </button>
                  <button
                    onClick={toggle}
                    className="grid size-9 place-items-center rounded-full bg-white text-[#0b0b0c] transition hover:scale-105"
                    aria-label={playing ? "Pause" : "Lecture"}
                  >
                    {playing ? (
                      <Pause className="size-4" fill="currentColor" />
                    ) : (
                      <Play className="size-4 translate-x-px" fill="currentColor" />
                    )}
                  </button>
                  <button onClick={() => step(1)} className="p-1 text-[#9b9ba3] hover:text-white" aria-label="Suivant">
                    <SkipForward className="size-4" fill="currentColor" />
                  </button>
                  <button
                    onClick={() => setAutoplay((v) => !v)}
                    className={cn("p-1", autoplay ? "text-white" : "text-[#6b6b73] hover:text-white")}
                    aria-label="Enchaîner automatiquement"
                    title={autoplay ? "Enchaînement automatique activé" : "Enchaînement automatique désactivé"}
                  >
                    <ListEnd className="size-4" />
                  </button>
                </div>
                <div className="flex items-center gap-3">
                  <span className="w-10 text-right font-mono text-[11px] text-[#6b6b73] tabular-nums">
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
                    height={26}
                    className="flex-1"
                  />
                  <span className="w-10 font-mono text-[11px] text-[#6b6b73] tabular-nums">
                    {formatDuration(duration || current.duration)}
                  </span>
                </div>
                {error ? <p className="text-danger text-center text-xs">{error}</p> : null}
                {tapToPlay && !playing ? (
                  <button onClick={toggle} className="text-center text-xs font-medium text-white">
                    Appuie sur lecture pour écouter « {current.title} »
                  </button>
                ) : null}
              </div>

              <div className="hidden w-32 items-center gap-2 md:flex">
                <button
                  onClick={() => setMuted((m) => !m)}
                  className="p-1 text-[#9b9ba3] hover:text-white"
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
