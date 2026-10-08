"use client";

import * as Popover from "@radix-ui/react-popover";
import {
  ChevronDown,
  Heart,
  ListMusic,
  Pause,
  Play,
  Repeat,
  Repeat1,
  SkipBack,
  SkipForward,
  SlidersHorizontal,
  Volume1,
  Volume2,
  VolumeX,
} from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { toast } from "sonner";
import { Cover } from "@/components/ui/cover";
import { Switch } from "@/components/ui/input";
import { Slider, Tooltip } from "@/components/ui/slider";
import { Spinner } from "@/components/ui/spinner";
import { Waveform } from "@/components/ui/waveform";
import { toggleFavorite, usePeaks, useTracks } from "@/lib/data/tracks";
import { shortKey } from "@/lib/music";
import { currentTime, usePlayer } from "@/lib/player/store";
import { cn, errorMessage, formatBpm, formatDuration } from "@/lib/utils";

function Meta({ bpm, k }: { bpm: number | null; k: string | null }) {
  const parts = [bpm ? `${formatBpm(bpm)} BPM` : null, k ? shortKey(k) : null].filter(Boolean);
  if (!parts.length) return null;
  return <span className="tabular text-faint">{parts.join(" · ")}</span>;
}

function useCurrentTrack() {
  const current = usePlayer((s) => s.current);
  const { data: tracks } = useTracks();
  return { current, track: tracks?.find((t) => t.id === current?.trackId) };
}

function PlayButton({ size = "md" }: { size?: "md" | "lg" }) {
  const playing = usePlayer((s) => s.playing);
  const loading = usePlayer((s) => s.loading);
  const toggle = usePlayer((s) => s.toggle);
  const cls = size === "lg" ? "size-16 [&_svg]:size-7" : "size-9 [&_svg]:size-4";
  return (
    <button
      onClick={toggle}
      className={cn(
        "bg-fg text-bg grid shrink-0 place-items-center rounded-full transition hover:scale-105 active:scale-95",
        cls,
      )}
      aria-label={playing ? "Pause" : "Lecture"}
    >
      {loading && playing ? (
        <Spinner />
      ) : playing ? (
        <Pause fill="currentColor" />
      ) : (
        <Play fill="currentColor" className="translate-x-px" />
      )}
    </button>
  );
}

function Transport({ size = "md" }: { size?: "md" | "lg" }) {
  const { prev, next, loop, cycleLoop } = usePlayer();
  const icon = size === "lg" ? "size-6" : "size-4";
  const LoopIcon = loop === "one" ? Repeat1 : Repeat;
  return (
    <div className={cn("flex items-center", size === "lg" ? "gap-8" : "gap-4")}>
      <Tooltip
        content={loop === "off" ? "Boucle désactivée" : loop === "all" ? "Boucler la file" : "Boucler le morceau"}
      >
        <button
          onClick={cycleLoop}
          className={cn("p-1 transition-colors", loop === "off" ? "text-faint hover:text-fg" : "text-accent")}
          aria-label="Boucle"
        >
          <LoopIcon className={icon} />
        </button>
      </Tooltip>
      <button onClick={prev} className="text-muted hover:text-fg p-1" aria-label="Précédent">
        <SkipBack className={icon} fill="currentColor" />
      </button>
      <PlayButton size={size} />
      <button onClick={next} className="text-muted hover:text-fg p-1" aria-label="Suivant">
        <SkipForward className={icon} fill="currentColor" />
      </button>
      <TuneButton size={size} />
    </div>
  );
}

function Timeline({ height = 32 }: { height?: number }) {
  const current = usePlayer((s) => s.current);
  const playing = usePlayer((s) => s.playing);
  const time = usePlayer((s) => s.time);
  const duration = usePlayer((s) => s.duration) || current?.duration || 0;
  const seek = usePlayer((s) => s.seek);
  const { data: peaks } = usePeaks(current?.versionId);
  return (
    <div className="flex w-full items-center gap-3">
      <span className="tabular text-faint w-10 text-right font-mono text-[11px]">{formatDuration(time)}</span>
      <Waveform
        peaks={peaks}
        duration={duration}
        time={time}
        getTime={currentTime}
        animate={playing}
        onSeek={seek}
        height={height}
        barWidth={2}
        gap={1}
        className="flex-1"
      />
      <span className="tabular text-faint w-10 font-mono text-[11px]">{formatDuration(duration)}</span>
    </div>
  );
}

const RATES = [0.75, 0.9, 1, 1.1, 1.25];

function TuneButton({ size }: { size: "md" | "lg" }) {
  const { rate, setRate, preservePitch, setPreservePitch, pitch, setPitch } = usePlayer();
  const changed = rate !== 1 || pitch !== 0;
  return (
    <Popover.Root>
      <Tooltip content="Vitesse et hauteur">
        <Popover.Trigger asChild>
          <button
            className={cn("p-1 transition-colors", changed ? "text-accent" : "text-faint hover:text-fg")}
            aria-label="Vitesse et hauteur"
          >
            <SlidersHorizontal className={size === "lg" ? "size-6" : "size-4"} />
          </button>
        </Popover.Trigger>
      </Tooltip>
      <Popover.Portal>
        <Popover.Content
          side="top"
          sideOffset={10}
          className="border-line-strong bg-raised data-[state=open]:animate-pop z-50 w-72 rounded-xl border p-4 text-[13px] shadow-xl"
        >
          <div className="mb-2 flex items-center justify-between">
            <span className="font-medium">Vitesse</span>
            <span className="tabular text-muted font-mono text-xs">{rate.toFixed(2)}×</span>
          </div>
          <Slider label="Vitesse de lecture" value={rate} min={0.5} max={1.5} step={0.01} onChange={setRate} />
          <div className="mt-2 flex gap-1">
            {RATES.map((r) => (
              <button
                key={r}
                onClick={() => setRate(r)}
                className={cn(
                  "flex-1 rounded-md py-1 font-mono text-[11px]",
                  rate === r ? "bg-fg text-bg" : "bg-hover text-muted hover:text-fg",
                )}
              >
                {r}×
              </button>
            ))}
          </div>
          <label className="mt-3 flex items-center justify-between gap-3">
            <span>
              <span className="block">Conserver la hauteur</span>
              <span className="text-faint block text-xs">Désactivé = varispeed (effet bande)</span>
            </span>
            <Switch checked={preservePitch} onChange={setPreservePitch} label="Conserver la hauteur" />
          </label>
          <div className="border-line mt-4 mb-2 flex items-center justify-between border-t pt-4">
            <span className="font-medium">Hauteur</span>
            <span className="tabular text-muted font-mono text-xs">
              {pitch > 0 ? "+" : ""}
              {pitch} st
            </span>
          </div>
          <Slider label="Hauteur en demi-tons" value={pitch} min={-12} max={12} step={1} onChange={setPitch} />
          <div className="mt-2 flex gap-1">
            {[-2, -1, 0, 1, 2].map((p) => (
              <button
                key={p}
                onClick={() => setPitch(p)}
                className={cn(
                  "flex-1 rounded-md py-1 font-mono text-[11px]",
                  pitch === p ? "bg-fg text-bg" : "bg-hover text-muted hover:text-fg",
                )}
              >
                {p > 0 ? `+${p}` : p}
              </button>
            ))}
          </div>
          {changed ? (
            <button
              onClick={() => {
                setRate(1);
                setPitch(0);
              }}
              className="text-muted hover:bg-hover hover:text-fg mt-3 w-full rounded-md py-1.5 text-xs"
            >
              Réinitialiser
            </button>
          ) : null}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

function VolumeControl() {
  const { volume, muted, setVolume, toggleMute } = usePlayer();
  const Icon = muted || volume === 0 ? VolumeX : volume < 0.5 ? Volume1 : Volume2;
  return (
    <div className="flex w-36 items-center gap-2">
      <button
        onClick={toggleMute}
        className="text-muted hover:text-fg p-1"
        aria-label={muted ? "Réactiver le son" : "Couper le son"}
      >
        <Icon className="size-4" />
      </button>
      <Slider label="Volume" value={muted ? 0 : volume} onChange={setVolume} />
    </div>
  );
}

function QueueButton() {
  const queue = usePlayer((s) => s.queue);
  const index = usePlayer((s) => s.index);
  const playItem = usePlayer((s) => s.playItem);
  return (
    <Popover.Root>
      <Tooltip content="File d'attente">
        <Popover.Trigger asChild>
          <button className="text-muted hover:text-fg p-1" aria-label="File d'attente">
            <ListMusic className="size-4" />
          </button>
        </Popover.Trigger>
      </Tooltip>
      <Popover.Portal>
        <Popover.Content
          side="top"
          align="end"
          sideOffset={10}
          className="border-line-strong bg-raised data-[state=open]:animate-pop z-50 max-h-96 w-80 overflow-y-auto rounded-xl border p-1.5 text-[13px] shadow-xl"
        >
          <p className="text-faint px-2 pt-1 pb-2 text-[11px] font-medium tracking-wider uppercase">À suivre</p>
          {queue.length <= 1 ? <p className="text-muted px-2 pb-2">Rien dans la file</p> : null}
          {queue.map((item, i) => (
            <button
              key={`${item.trackId}-${item.versionId}-${i}`}
              onClick={() => playItem(item, queue)}
              className={cn(
                "hover:bg-hover flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-left",
                i === index && "text-accent",
                i < index && "opacity-50",
              )}
            >
              <Cover path={item.coverPath} seed={item.trackId} className="size-7" rounded="rounded" />
              <span className="min-w-0 flex-1 truncate">{item.title}</span>
              <span className="text-faint font-mono text-[11px]">{formatDuration(item.duration)}</span>
            </button>
          ))}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

function FavButton({ size = "sm" }: { size?: "sm" | "lg" }) {
  const { track } = useCurrentTrack();
  if (!track) return null;
  return (
    <button
      onClick={() => toggleFavorite(track).catch((e) => toast.error(errorMessage(e)))}
      className={cn("p-1 transition-colors", track.favorite ? "text-accent" : "text-faint hover:text-fg")}
      aria-label={track.favorite ? "Retirer des favoris" : "Ajouter aux favoris"}
    >
      <Heart className={size === "lg" ? "size-6" : "size-4"} fill={track.favorite ? "currentColor" : "none"} />
    </button>
  );
}

export function PlayerBar() {
  const current = usePlayer((s) => s.current);
  const [expanded, setExpanded] = useState(false);
  if (!current) return null;

  return (
    <>
      {/* Desktop */}
      <div className="border-line bg-panel animate-up hidden h-[84px] shrink-0 grid-cols-[minmax(180px,1fr)_minmax(320px,2fr)_minmax(180px,1fr)] items-center gap-6 border-t px-4 md:grid">
        <div className="flex min-w-0 items-center gap-3">
          <Link href={`/tracks/${current.trackId}`} className="shrink-0">
            <Cover path={current.coverPath} seed={current.trackId} className="size-12" />
          </Link>
          <div className="min-w-0">
            <Link
              href={`/tracks/${current.trackId}`}
              className="block truncate text-[13px] font-medium hover:underline"
            >
              {current.title}
              {current.versionLabel ? (
                <span className="text-accent ml-1.5 text-xs font-normal">{current.versionLabel}</span>
              ) : null}
            </Link>
            <p className="text-muted truncate text-xs">
              {current.artist || "Artiste inconnu"} <Meta bpm={current.bpm} k={current.key} />
            </p>
          </div>
          <FavButton />
        </div>
        <div className="flex min-w-0 flex-col items-center gap-1">
          <Transport />
          <Timeline height={28} />
        </div>
        <div className="flex items-center justify-end gap-2">
          <QueueButton />
          <VolumeControl />
        </div>
      </div>

      {/* Mobile mini player */}
      <div className="border-line bg-panel relative shrink-0 border-t md:hidden">
        <MiniProgress />
        <div className="flex h-16 items-center gap-3 px-3" onClick={() => setExpanded(true)}>
          <Cover path={current.coverPath} seed={current.trackId} className="size-11" />
          <div className="min-w-0 flex-1">
            <p className="truncate text-[13px] font-medium">{current.title}</p>
            <p className="text-muted truncate text-xs">{current.artist || "Artiste inconnu"}</p>
          </div>
          <div onClick={(e) => e.stopPropagation()} className="flex items-center gap-1">
            <FavButton />
            <PlayButton />
          </div>
        </div>
      </div>

      {expanded ? <MobileFullPlayer onClose={() => setExpanded(false)} /> : null}
    </>
  );
}

function MiniProgress() {
  const time = usePlayer((s) => s.time);
  const duration = usePlayer((s) => s.duration);
  return (
    <div className="bg-line absolute inset-x-0 top-0 h-0.5">
      <div className="bg-accent h-full" style={{ width: `${duration ? (time / duration) * 100 : 0}%` }} />
    </div>
  );
}

function MobileFullPlayer({ onClose }: { onClose: () => void }) {
  const current = usePlayer((s) => s.current)!;
  return (
    <div className="bg-bg animate-up fixed inset-0 z-50 flex flex-col px-6 pt-[max(env(safe-area-inset-top),16px)] pb-[max(env(safe-area-inset-bottom),24px)] md:hidden">
      <div className="flex items-center justify-between">
        <button onClick={onClose} className="text-muted -ml-2 p-2" aria-label="Fermer le lecteur">
          <ChevronDown className="size-6" />
        </button>
        <Link href={`/tracks/${current.trackId}`} onClick={onClose} className="text-muted text-xs">
          Ouvrir le morceau
        </Link>
      </div>
      <div className="flex flex-1 flex-col justify-center gap-8">
        <Cover
          path={current.coverPath}
          seed={current.trackId}
          className="mx-auto aspect-square w-full max-w-sm"
          rounded="rounded-2xl"
        />
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="truncate text-xl font-semibold">{current.title}</p>
            <p className="text-muted truncate text-sm">
              {current.artist || "Artiste inconnu"} <Meta bpm={current.bpm} k={current.key} />
            </p>
          </div>
          <FavButton size="lg" />
        </div>
        <Timeline height={56} />
        <div className="flex justify-center">
          <Transport size="lg" />
        </div>
      </div>
    </div>
  );
}
