"use client";

import {
  ChevronLeft,
  Copy,
  Download,
  FolderInput,
  Heart,
  ImagePlus,
  MoreHorizontal,
  Pause,
  Play,
  SquarePen,
  Trash2,
  Wand2,
  X,
} from "lucide-react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { ActivityFeed } from "@/components/track/activity-feed";
import { KeySelect, ProjectSelect } from "@/components/track/fields";
import { InlineEdit } from "@/components/track/inline-edit";
import { NotesEditor } from "@/components/track/notes-editor";
import { StemsPanel } from "@/components/track/stems-panel";
import { TagInput } from "@/components/track/tag-input";
import { VersionsPanel } from "@/components/track/versions-panel";
import { Button } from "@/components/ui/button";
import { Cover } from "@/components/ui/cover";
import { DropdownMenu } from "@/components/ui/menu";
import { EmptyState } from "@/components/ui/misc";
import { Skeleton, Spinner } from "@/components/ui/spinner";
import { Waveform } from "@/components/ui/waveform";
import { uploadCover, useProjects } from "@/lib/data/library";
import { setTrackTags, toggleFavorite, updateTrack, usePeaks, useTrackDetail } from "@/lib/data/tracks";
import { camelot, keyLabel, normalizeKey } from "@/lib/music";
import { currentTime, trackToItem, usePlayer } from "@/lib/player/store";
import { removeFiles } from "@/lib/storage";
import { downloadTrack, duplicateWithToast, trashWithUndo } from "@/lib/track-actions";
import type { Track } from "@/lib/types";
import { useUI } from "@/lib/ui-store";
import { pickFiles } from "@/lib/upload/pick";
import { redetect } from "@/lib/upload/uploads";
import {
  cn,
  errorMessage,
  fileExtension,
  formatBpm,
  formatBytes,
  formatDuration,
  relativeDate,
  shortDate,
} from "@/lib/utils";

export default function TrackPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { data, isLoading, error } = useTrackDetail(id);
  const setFocusTrack = useUI((s) => s.setFocusTrack);

  useEffect(() => {
    setFocusTrack(id);
  }, [id, setFocusTrack]);

  if (isLoading) {
    return (
      <div className="px-4 pt-8 md:px-8">
        <div className="flex gap-6">
          <Skeleton className="size-40 md:size-56" />
          <div className="flex-1 space-y-3 pt-6">
            <Skeleton className="h-8 w-2/3" />
            <Skeleton className="h-4 w-1/3" />
          </div>
        </div>
        <Skeleton className="mt-8 h-24" />
      </div>
    );
  }
  if (error || !data || data.track.deleted_at) {
    return (
      <EmptyState
        icon={X}
        title="Morceau introuvable"
        action={<Button onClick={() => router.push("/library")}>Retour à la bibliothèque</Button>}
      >
        {data?.track.deleted_at ? "Ce morceau est dans la corbeille." : "Il a peut-être été supprimé."}
      </EmptyState>
    );
  }

  const { track, versions, stems, activity } = data;

  return (
    <div className="mx-auto max-w-[1400px] pb-16">
      <div className="px-4 pt-4 md:px-8 md:pt-6">
        <button
          onClick={() => router.back()}
          className="text-muted hover:text-fg -ml-1 inline-flex items-center gap-1 text-xs"
        >
          <ChevronLeft className="size-3.5" /> Retour
        </button>
      </div>
      <Header track={track} />
      <WaveSection track={track} />

      <div className="grid gap-10 px-4 pt-8 md:px-8 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="min-w-0 space-y-10">
          <NotesEditor key={track.id} trackId={track.id} initial={track.notes} />
          <VersionsPanel track={track} versions={versions} />
          <StemsPanel track={track} stems={stems} />
        </div>
        <aside className="space-y-10">
          <Details track={track} />
          <section>
            <h3 className="mb-3 text-[13px] font-semibold">Activité</h3>
            <ActivityFeed activity={activity} />
          </section>
        </aside>
      </div>
    </div>
  );
}

function Header({ track }: { track: Track }) {
  const router = useRouter();
  const openDialog = useUI((s) => s.openDialog);
  const isCurrent = usePlayer((s) => s.current?.trackId === track.id && !s.current.versionLabel);
  const playing = usePlayer((s) => s.playing) && isCurrent;
  const [coverBusy, setCoverBusy] = useState(false);
  const { data: projects = [] } = useProjects();
  const project = projects.find((p) => p.id === track.project_id);

  const save = (patch: Parameters<typeof updateTrack>[1]) =>
    updateTrack(track.id, patch)
      .then(() => syncPlayer(track.id, patch))
      .catch((e) => toast.error("Enregistrement impossible", { description: errorMessage(e) }));

  const changeCover = () =>
    pickFiles(
      async (files) => {
        setCoverBusy(true);
        try {
          const old = track.cover_path;
          const path = await uploadCover(track.id, files[0]);
          await updateTrack(track.id, { cover_path: path });
          if (old) void removeFiles([old]);
          syncPlayer(track.id, { cover_path: path });
        } catch (e) {
          toast.error("Échec de l'import de la pochette", { description: errorMessage(e) });
        } finally {
          setCoverBusy(false);
        }
      },
      { multiple: false, accept: "image/*" },
    );

  const play = () => {
    const p = usePlayer.getState();
    if (isCurrent) p.toggle();
    else void p.playItem(trackToItem(track), [trackToItem(track)]);
  };

  return (
    <div className="flex flex-col gap-6 px-4 pt-4 sm:flex-row sm:items-end md:px-8">
      <div className="group relative w-40 shrink-0 md:w-56">
        <Cover
          path={track.cover_path}
          seed={track.id}
          className="aspect-square w-full shadow-2xl shadow-black/40"
          rounded="rounded-xl"
        />
        <div className="absolute inset-0 flex items-center justify-center gap-2 rounded-xl bg-black/50 opacity-0 transition-opacity group-hover:opacity-100">
          {coverBusy ? (
            <Spinner className="size-6 text-white" />
          ) : (
            <>
              <button
                onClick={changeCover}
                className="rounded-full bg-black/60 p-2.5 text-white hover:bg-black/80"
                aria-label="Changer la pochette"
              >
                <ImagePlus className="size-5" />
              </button>
              {track.cover_path ? (
                <button
                  onClick={async () => {
                    const old = track.cover_path;
                    await save({ cover_path: null });
                    void removeFiles([old]);
                  }}
                  className="rounded-full bg-black/60 p-2.5 text-white hover:bg-black/80"
                  aria-label="Retirer la pochette"
                >
                  <X className="size-5" />
                </button>
              ) : null}
            </>
          )}
        </div>
      </div>

      <div className="min-w-0 flex-1">
        <p className="text-faint mb-1 text-[11px] font-medium tracking-wider uppercase">
          {project ? (
            <Link href={`/projects/${project.id}`} className="hover:text-fg">
              {project.name}
            </Link>
          ) : (
            "Morceau"
          )}
          {track.version_number > 1 ? ` · V${track.version_number}` : ""}
        </p>
        <InlineEdit
          value={track.title}
          onSave={(v) => (v ? save({ title: v }) : undefined)}
          className="block text-3xl font-semibold tracking-tight md:text-4xl"
        />
        <div className="text-muted mt-1 text-[15px]">
          <InlineEdit
            value={track.artist ?? ""}
            placeholder="Ajouter un artiste"
            onSave={(v) => save({ artist: v || null })}
          />
        </div>

        <div className="mt-5 flex flex-wrap items-center gap-2">
          <Button variant="primary" size="lg" onClick={play} className="rounded-full px-5" disabled={!track.file_path}>
            {playing ? <Pause fill="currentColor" /> : <Play fill="currentColor" />}
            {playing ? "Pause" : "Lire"}
          </Button>
          <Button
            variant="outline"
            size="lg"
            onClick={() => toggleFavorite(track).catch((e) => toast.error(errorMessage(e)))}
            className={cn("rounded-full", track.favorite && "border-accent/50 text-accent")}
            aria-label="Favori"
            title="Favori (F)"
          >
            <Heart fill={track.favorite ? "currentColor" : "none"} />
          </Button>
          <DropdownMenu
            entries={[
              {
                label: "Télécharger le MP3",
                icon: Download,
                disabled: !track.preview_path && track.mime_type !== "audio/mpeg",
                onSelect: () => downloadTrack(track, "mp3"),
              },
              {
                label: `Télécharger l'original (${fileExtension(track.original_filename ?? "").toUpperCase() || "fichier"})`,
                icon: Download,
                onSelect: () => downloadTrack(track, "original"),
              },
            ]}
            trigger={
              <Button variant="outline" size="lg" className="rounded-full" aria-label="Télécharger">
                <Download />
              </Button>
            }
          />
          <DropdownMenu
            entries={[
              {
                label: "Modifier les infos",
                icon: SquarePen,
                onSelect: () => openDialog({ type: "edit", trackId: track.id }),
              },
              {
                label: "Déplacer vers…",
                icon: FolderInput,
                onSelect: () => openDialog({ type: "move", trackIds: [track.id] }),
              },
              { label: "Dupliquer", icon: Copy, onSelect: () => duplicateWithToast(track) },
              { type: "separator" },
              {
                label: "Supprimer",
                icon: Trash2,
                danger: true,
                onSelect: () => {
                  void trashWithUndo([track.id]);
                  router.push("/library");
                },
              },
            ]}
            trigger={
              <Button variant="ghost" size="lg" className="rounded-full" aria-label="Plus d'options">
                <MoreHorizontal />
              </Button>
            }
          />
        </div>
      </div>
    </div>
  );
}

function WaveSection({ track }: { track: Track }) {
  const { data: peaks, isLoading } = usePeaks(track.current_version_id);
  const isCurrent = usePlayer(
    (s) => s.current?.trackId === track.id && s.current.versionId === track.current_version_id,
  );
  const playing = usePlayer((s) => s.playing) && isCurrent;
  const time = usePlayer((s) => (isCurrent ? s.time : 0));

  const seek = (t: number) => {
    const p = usePlayer.getState();
    if (isCurrent) p.seek(t);
    else {
      const item = trackToItem(track);
      void p.playItem(item, [item]).then(() => usePlayer.getState().seek(t));
    }
  };

  return (
    <div className="px-4 pt-8 md:px-8">
      <div className="border-line bg-panel rounded-2xl border px-4 pt-7 pb-3">
        {track.status === "uploading" ? (
          <div className="text-muted flex h-20 items-center justify-center gap-2 text-[13px]">
            <Spinner /> Import en cours…
          </div>
        ) : isLoading ? (
          <Skeleton className="h-20" />
        ) : (
          <Waveform
            peaks={peaks}
            duration={track.duration}
            time={time}
            getTime={currentTime}
            animate={playing}
            onSeek={seek}
            height={80}
            barWidth={3}
            gap={1}
            active={isCurrent}
          />
        )}
        <div className="text-faint mt-2 flex justify-between font-mono text-[11px]">
          <span>{formatDuration(time)}</span>
          <span>{formatDuration(track.duration)}</span>
        </div>
      </div>
    </div>
  );
}

function Details({ track }: { track: Track }) {
  const { data: projects = [] } = useProjects();
  const [detecting, setDetecting] = useState(false);

  const save = (patch: Parameters<typeof updateTrack>[1]) =>
    updateTrack(track.id, patch)
      .then(() => syncPlayer(track.id, patch))
      .catch((e) => toast.error("Enregistrement impossible", { description: errorMessage(e) }));

  const detect = async () => {
    if (!track.file_path || !track.current_version_id) return;
    setDetecting(true);
    try {
      const r = await redetect(track.id, track.file_path, track.current_version_id);
      toast.success("Analyse terminée", {
        description: [r.bpm && `${r.bpm} BPM`, keyLabel(r.key)].filter(Boolean).join(" · ") || "Rien détecté",
      });
    } catch (e) {
      toast.error("Échec de la détection", { description: errorMessage(e) });
    } finally {
      setDetecting(false);
    }
  };

  return (
    <section>
      <div className="mb-2 flex items-center justify-between">
        <h3 className="text-[13px] font-semibold">Infos</h3>
        <Button
          variant="ghost"
          size="sm"
          onClick={detect}
          loading={detecting}
          disabled={!track.file_path || track.status === "uploading"}
        >
          {!detecting ? <Wand2 /> : null} Détecter BPM et tonalité
        </Button>
      </div>
      <div>
        <Row label="BPM">
          <InlineEdit
            value={formatBpm(track.bpm)}
            placeholder="—"
            inputMode="decimal"
            className="font-mono"
            validate={(v) => !v || (Number(v.replace(",", ".")) > 0 && Number(v.replace(",", ".")) < 1000)}
            onSave={(v) => save({ bpm: v ? Number(v.replace(",", ".")) : null })}
          />
        </Row>
        <Row label="Tonalité">
          <div className="flex items-center gap-2">
            {track.key ? <span className="text-faint font-mono text-[11px]">{camelot(track.key)}</span> : null}
            <KeySelect
              value={normalizeKey(track.key)}
              onChange={(v) => save({ key: v })}
              className="hover:bg-hover h-8 w-36 border-0 bg-transparent text-right"
            />
          </div>
        </Row>
        <Row label="Genre">
          <InlineEdit value={track.genre ?? ""} placeholder="—" onSave={(v) => save({ genre: v || null })} />
        </Row>
        <Row label="Producteur">
          <InlineEdit value={track.producer ?? ""} placeholder="—" onSave={(v) => save({ producer: v || null })} />
        </Row>
        <Row label="Projet">
          <ProjectSelect
            value={track.project_id}
            onChange={(v) => save({ project_id: v })}
            projects={projects}
            className="hover:bg-hover h-8 w-44 border-0 bg-transparent text-right"
          />
        </Row>
        <div className="border-line border-b py-2.5">
          <span className="text-muted mb-2 block text-[13px]">Tags</span>
          <TagInput
            value={track.tag_ids}
            onChange={(ids) => setTrackTags(track.id, ids).catch((e) => toast.error(errorMessage(e)))}
          />
        </div>
        <Row label="Durée">
          <span className="text-muted font-mono">{formatDuration(track.duration)}</span>
        </Row>
        <Row label="Fichier">
          <span className="text-muted truncate" title={track.original_filename ?? ""}>
            {fileExtension(track.original_filename ?? "").toUpperCase() || "—"} · {formatBytes(track.file_size)}
          </span>
        </Row>
        <Row label="Ajouté le">
          <span className="text-muted">{shortDate(track.created_at)}</span>
        </Row>
        <Row label="Écoutes">
          <span className="text-muted">
            {track.play_count}
            {track.last_played_at ? ` · dernière ${relativeDate(track.last_played_at)}` : ""}
          </span>
        </Row>
      </div>
    </section>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="border-line flex min-h-9 items-center justify-between gap-4 border-b py-1 text-[13px] last:border-0">
      <span className="text-muted shrink-0">{label}</span>
      <div className="flex min-w-0 justify-end text-right">{children}</div>
    </div>
  );
}

/** Keeps the player bar in sync when the playing track's metadata is edited. */
function syncPlayer(trackId: string, patch: Parameters<typeof updateTrack>[1]) {
  const p = usePlayer.getState();
  if (p.current?.trackId !== trackId) return;
  p.updateCurrentMeta({
    ...(patch.title !== undefined ? { title: patch.title } : {}),
    ...(patch.artist !== undefined ? { artist: patch.artist } : {}),
    ...(patch.bpm !== undefined ? { bpm: patch.bpm } : {}),
    ...(patch.key !== undefined ? { key: patch.key } : {}),
    ...(patch.cover_path !== undefined ? { coverPath: patch.cover_path } : {}),
  });
}
