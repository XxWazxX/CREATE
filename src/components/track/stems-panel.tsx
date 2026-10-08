"use client";

import { downloadZip } from "client-zip";
import { Download, Headphones, Pause, Play, Plus, Trash2, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { Spinner } from "@/components/ui/spinner";
import { StemMixer } from "@/lib/audio/stem-mixer";
import { deleteStem, updateStem } from "@/lib/data/tracks";
import { hasType } from "@/lib/dnd";
import { STEM_KINDS, STEM_LABELS, type StemKind } from "@/lib/music";
import { usePlayer } from "@/lib/player/store";
import { downloadUrl, signedUrl, triggerDownload } from "@/lib/storage";
import type { Stem, Track } from "@/lib/types";
import { confirm } from "@/lib/ui-store";
import { pickFiles } from "@/lib/upload/pick";
import { uploadStems } from "@/lib/upload/uploads";
import { cn, errorMessage, fileExtension, formatBytes, formatDuration, safeFilename } from "@/lib/utils";

const KIND_COLORS: Record<StemKind, string> = {
  drums: "#f2b544",
  "808": "#f2706b",
  bass: "#e98a4f",
  melody: "#5cc3f2",
  keys: "#a99bf7",
  vocals: "#f2798f",
  fx: "#5fd38d",
  other: "#9b9ba3",
};

type ChannelState = { volume: number; muted: boolean; solo: boolean };

export function StemsPanel({ track, stems }: { track: Track; stems: Stem[] }) {
  const [over, setOver] = useState(false);
  const [mixerOpen, setMixerOpen] = useState(false);
  const [zipping, setZipping] = useState(false);
  const ready = stems.filter((s) => s.status === "ready");

  const add = (files: File[]) =>
    uploadStems(track.id, files, track.current_version_id).catch((e) => toast.error(errorMessage(e)));

  const downloadAll = async () => {
    setZipping(true);
    const id = toast.loading(`Préparation de ${ready.length} stems…`);
    try {
      const base = safeFilename(track.title);
      const files = await Promise.all(
        ready.map(async (s, i) => {
          const url = await signedUrl(s.file_path);
          if (!url) throw new Error(`Accès impossible à ${s.name}`);
          const res = await fetch(url);
          if (!res.ok) throw new Error(`Téléchargement impossible : ${s.name}`);
          const ext = fileExtension(s.original_filename ?? s.file_path) || "wav";
          return {
            name: `${base} - Stems/${String(i + 1).padStart(2, "0")} ${safeFilename(s.name)}.${ext}`,
            input: res,
          };
        }),
      );
      const blob = await downloadZip(files).blob();
      const url = URL.createObjectURL(blob);
      triggerDownload(url, `${base} - Stems.zip`);
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
      toast.success("Stems téléchargés", { id });
    } catch (e) {
      toast.error("Échec du téléchargement", { id, description: errorMessage(e) });
    } finally {
      setZipping(false);
    }
  };

  return (
    <section
      onDragOver={(e) => {
        if (hasType(e, "Files")) {
          e.preventDefault();
          e.stopPropagation();
          setOver(true);
        }
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        e.stopPropagation();
        setOver(false);
        void add(Array.from(e.dataTransfer.files));
      }}
      className={cn("rounded-xl transition-colors", over && "bg-accent/5 ring-accent/50 ring-1")}
    >
      <div className="mb-2 flex items-center justify-between gap-2">
        <h3 className="text-[13px] font-semibold">
          Stems <span className="text-faint font-normal">{stems.length}</span>
        </h3>
        <div className="flex gap-1">
          {ready.length > 1 ? (
            <Button variant={mixerOpen ? "secondary" : "ghost"} size="sm" onClick={() => setMixerOpen((o) => !o)}>
              <Headphones /> Mixeur
            </Button>
          ) : null}
          {ready.length ? (
            <Button variant="ghost" size="sm" onClick={downloadAll} loading={zipping}>
              {!zipping ? <Download /> : null} Tout
            </Button>
          ) : null}
          <Button variant="ghost" size="sm" onClick={() => pickFiles((f) => void add(f))}>
            <Plus /> Ajouter
          </Button>
        </div>
      </div>

      {mixerOpen && ready.length ? (
        <Mixer stems={ready} onClose={() => setMixerOpen(false)} />
      ) : stems.length ? (
        <ul className="divide-line border-line divide-y overflow-hidden rounded-xl border">
          {stems.map((s) => (
            <StemRow key={s.id} stem={s} track={track} />
          ))}
        </ul>
      ) : (
        <button
          onClick={() => pickFiles((f) => void add(f))}
          className="border-line-strong text-muted hover:border-accent/50 hover:text-fg flex w-full flex-col items-center gap-1 rounded-xl border border-dashed px-4 py-8 text-center text-[13px]"
        >
          <Plus className="size-5" />
          Dépose tes stems ici — Drums, 808, Basse, Mélodie…
          <span className="text-faint text-[11px]">Le type est deviné d’après le nom du fichier</span>
        </button>
      )}
    </section>
  );
}

function StemRow({ stem, track }: { stem: Stem; track: Track }) {
  return (
    <li className="group flex items-center gap-3 px-3 py-2">
      <span className="size-2 shrink-0 rounded-full" style={{ background: KIND_COLORS[stem.kind] }} />
      <select
        value={stem.kind}
        onChange={(e) =>
          void updateStem(stem, { kind: e.target.value as StemKind }).catch((err) => toast.error(errorMessage(err)))
        }
        className="text-muted hover:text-fg w-20 shrink-0 cursor-pointer appearance-none bg-transparent text-xs font-medium outline-none"
        aria-label="Type de stem"
      >
        {STEM_KINDS.map((k) => (
          <option key={k} value={k}>
            {STEM_LABELS[k]}
          </option>
        ))}
      </select>
      <div className="min-w-0 flex-1">
        <p className="truncate text-[13px]">{stem.name}</p>
        <p className="text-faint truncate text-[11px]">
          {stem.status === "uploading" ? (
            <span className="inline-flex items-center gap-1">
              <Spinner className="size-3" /> Import
            </span>
          ) : stem.status === "error" ? (
            <span className="text-danger">Échec de l’import</span>
          ) : (
            [
              formatDuration(stem.duration),
              formatBytes(stem.file_size),
              fileExtension(stem.original_filename ?? "").toUpperCase(),
            ]
              .filter(Boolean)
              .join(" · ")
          )}
        </p>
      </div>
      <button
        disabled={stem.status !== "ready"}
        onClick={async () => {
          try {
            const ext = fileExtension(stem.original_filename ?? stem.file_path) || "wav";
            triggerDownload(
              await downloadUrl(stem.file_path, `${safeFilename(track.title)} - ${safeFilename(stem.name)}.${ext}`),
            );
          } catch (e) {
            toast.error(errorMessage(e));
          }
        }}
        className="text-faint hover:bg-active hover:text-fg rounded-md p-1.5 disabled:opacity-30"
        aria-label={`Télécharger ${stem.name}`}
      >
        <Download className="size-4" />
      </button>
      <button
        onClick={async () => {
          if (await confirm({ title: `Supprimer le stem « ${stem.name} » ?`, confirmLabel: "Supprimer", danger: true }))
            await deleteStem(stem).catch((e) => toast.error(errorMessage(e)));
        }}
        className="text-faint hover:bg-active hover:text-danger rounded-md p-1.5 opacity-0 group-hover:opacity-100 max-md:opacity-100"
        aria-label={`Supprimer ${stem.name}`}
      >
        <Trash2 className="size-4" />
      </button>
    </li>
  );
}

// ---------------------------------------------------------------------------
// Mixer
// ---------------------------------------------------------------------------

function Mixer({ stems, onClose }: { stems: Stem[]; onClose: () => void }) {
  const mixer = useRef<StemMixer | null>(null);
  const [loaded, setLoaded] = useState(0);
  const [failed, setFailed] = useState<string[]>([]);
  const [playing, setPlaying] = useState(false);
  const [time, setTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [master, setMaster] = useState(0.9);
  const [channels, setChannels] = useState<Record<string, ChannelState>>(() =>
    Object.fromEntries(stems.map((s) => [s.id, { volume: 1, muted: false, solo: false }])),
  );
  const stemKey = stems.map((s) => s.id).join(",");

  useEffect(() => {
    const m = new StemMixer();
    mixer.current = m;
    m.setMaster(0.9);
    m.onEnded = () => setPlaying(false);
    let alive = true;
    // Pause the main player: the mixer has its own audio graph.
    usePlayer.getState().pause();
    (async () => {
      await Promise.all(
        stems.map(async (s) => {
          try {
            const url = await signedUrl(s.file_path);
            if (!url) throw new Error("no url");
            await m.load(s.id, url, s.original_filename ?? s.name);
            if (alive) {
              setLoaded((n) => n + 1);
              setDuration(m.duration);
            }
          } catch {
            if (alive) setFailed((f) => [...f, s.name]);
          }
        }),
      );
    })();
    return () => {
      alive = false;
      m.dispose();
      mixer.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stemKey]);

  useEffect(() => {
    if (!playing) return;
    let raf = 0;
    const tick = () => {
      if (mixer.current) setTime(mixer.current.time);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing]);

  // Pause the mixer if the main player starts.
  useEffect(
    () =>
      usePlayer.subscribe((s) => {
        if (s.playing && mixer.current?.playing) {
          mixer.current.pause();
          setPlaying(false);
        }
      }),
    [],
  );

  const ready = loaded === stems.length - failed.length && loaded > 0;
  const anySolo = Object.values(channels).some((c) => c.solo);

  const set = (id: string, patch: Partial<ChannelState>) => {
    setChannels((c) => ({ ...c, [id]: { ...c[id], ...patch } }));
    mixer.current?.update(id, patch);
  };

  const toggle = async () => {
    const m = mixer.current;
    if (!m || !ready) return;
    if (m.playing) {
      m.pause();
      setPlaying(false);
    } else {
      usePlayer.getState().pause();
      await m.play();
      setPlaying(true);
    }
  };

  return (
    <div className="border-line bg-panel overflow-hidden rounded-xl border">
      <div className="border-line flex items-center gap-3 border-b px-3 py-2.5">
        <button
          onClick={toggle}
          disabled={!ready}
          className="bg-fg text-bg grid size-9 shrink-0 place-items-center rounded-full disabled:opacity-40"
          aria-label={playing ? "Mettre les stems en pause" : "Lire les stems"}
        >
          {!ready ? (
            <Spinner />
          ) : playing ? (
            <Pause className="size-4" fill="currentColor" />
          ) : (
            <Play className="size-4 translate-x-px" fill="currentColor" />
          )}
        </button>
        <div className="min-w-0 flex-1">
          <input
            type="range"
            min={0}
            max={duration || 1}
            step={0.01}
            value={time}
            onChange={(e) => {
              const t = Number(e.target.value);
              mixer.current?.seek(t);
              setTime(t);
            }}
            className="w-full accent-[var(--accent)]"
            aria-label="Position"
            disabled={!ready}
          />
          <div className="text-faint flex justify-between font-mono text-[10px]">
            <span>{formatDuration(time)}</span>
            <span>{ready ? formatDuration(duration) : `Chargement ${loaded}/${stems.length}…`}</span>
          </div>
        </div>
        <div className="hidden w-24 sm:block">
          <Slider
            label="Volume général"
            value={master}
            onChange={(v) => {
              setMaster(v);
              mixer.current?.setMaster(v);
            }}
          />
        </div>
        <button onClick={onClose} className="text-faint hover:text-fg rounded-md p-1.5" aria-label="Fermer le mixeur">
          <X className="size-4" />
        </button>
      </div>
      <ul className="divide-line divide-y">
        {stems.map((s) => {
          const c = channels[s.id];
          const audible = anySolo ? c.solo : !c.muted;
          return (
            <li
              key={s.id}
              className={cn("flex items-center gap-3 px-3 py-2 transition-opacity", !audible && "opacity-45")}
            >
              <span className="size-2 shrink-0 rounded-full" style={{ background: KIND_COLORS[s.kind] }} />
              <div className="w-28 min-w-0 shrink-0">
                <p className="truncate text-[12.5px] font-medium">{s.name}</p>
                <p className="text-faint text-[10px] tracking-wider uppercase">{STEM_LABELS[s.kind]}</p>
              </div>
              <button
                onClick={() => set(s.id, { muted: !c.muted })}
                className={cn(
                  "h-6 w-6 shrink-0 rounded text-[11px] font-bold",
                  c.muted ? "bg-danger/80 text-white" : "bg-hover text-muted hover:text-fg",
                )}
                aria-label={`Couper ${s.name}`}
                aria-pressed={c.muted}
              >
                M
              </button>
              <button
                onClick={() => set(s.id, { solo: !c.solo })}
                className={cn(
                  "h-6 w-6 shrink-0 rounded text-[11px] font-bold",
                  c.solo ? "bg-accent text-accent-fg" : "bg-hover text-muted hover:text-fg",
                )}
                aria-label={`Solo ${s.name}`}
                aria-pressed={c.solo}
              >
                S
              </button>
              <Slider
                label={`Volume ${s.name}`}
                value={c.volume}
                max={1.5}
                onChange={(v) => set(s.id, { volume: v })}
                className="flex-1"
              />
              <span className="text-faint w-9 text-right font-mono text-[10px]">{Math.round(c.volume * 100)}</span>
            </li>
          );
        })}
      </ul>
      {failed.length ? (
        <p className="text-danger px-3 py-2 text-[11px]">Chargement impossible : {failed.join(", ")}</p>
      ) : null}
    </div>
  );
}
