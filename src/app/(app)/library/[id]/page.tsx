"use client";

import {
  ChevronRight,
  Download,
  ExternalLink,
  FileAudio,
  FileBox,
  Folder,
  FolderOpen,
  Pause,
  Play,
  Trash2,
  Upload,
} from "lucide-react";
import Link from "next/link";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/misc";
import { Skeleton, Spinner } from "@/components/ui/spinner";
import { deleteFolderFile, useTrackFolder } from "@/lib/data/track-folders";
import { deleteStem, useTrackDetail } from "@/lib/data/tracks";
import { hasType } from "@/lib/dnd";
import { usePlayer } from "@/lib/player/store";
import { downloadUrl, signedUrl, triggerDownload } from "@/lib/storage";
import { confirm } from "@/lib/ui-store";
import { AUDIO_ACCEPT, pickFiles } from "@/lib/upload/pick";
import { uploadFolderFiles, uploadStems } from "@/lib/upload/uploads";
import { cn, errorMessage, fileExtension, formatBytes, isAudioFile, safeFilename, shortDate } from "@/lib/utils";

type Dir = "prod" | "stems" | "session";

const DIRS: { id: Dir; label: string; hint: string; drop: string }[] = [
  { id: "prod", label: "Prod", hint: "WAV, MP3", drop: "Dépose ici le .wav et le .mp3 de la prod." },
  { id: "stems", label: "Stems", hint: "Pistes séparées", drop: "Dépose ici les pistes séparées (WAV, MP3, AIFF…)." },
  {
    id: "session",
    label: "Session",
    hint: "Session de compo",
    drop: "Dépose ici la session de compo (.flp, .als, .zip…). Un projet en dossier (Logic, Ableton) doit être zippé.",
  },
];

/** One line of a folder: a stored file the owner can play, download and (usually) delete. */
type Entry = {
  key: string;
  name: string;
  path: string | null;
  size: number | null;
  date: string | null;
  audio: boolean;
  badge?: string;
  busy?: boolean;
  onDelete?: () => Promise<void>;
};

export default function TrackFolderPage() {
  return (
    <Suspense>
      <TrackFolder />
    </Suspense>
  );
}

function TrackFolder() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const d = useSearchParams().get("d");
  const dir = DIRS.find((x) => x.id === d) ?? null;
  const { data, isLoading, error } = useTrackDetail(id);
  const prod = useTrackFolder(id, "prod");
  const session = useTrackFolder(id, "session");

  if (error) return <p className="text-danger px-8 py-10 text-sm">Dossier introuvable : {error.message}</p>;
  if (isLoading || !data) {
    return (
      <div className="space-y-3 px-4 pt-8 md:px-8">
        <Skeleton className="h-7 w-64" />
        <Skeleton className="h-28" />
      </div>
    );
  }

  const { track, stems } = data;
  const go = (d: Dir | null) => router.push(d ? `/library/${id}?d=${d}` : `/library/${id}`);

  const entries: Record<Dir, Entry[]> = {
    prod: [
      ...(track.file_path
        ? [
            {
              key: "original",
              name: track.original_filename ?? track.title,
              path: track.status === "uploading" ? null : track.file_path,
              size: track.file_size,
              date: track.created_at,
              audio: true,
              badge: "Fichier déposé",
              busy: track.status === "uploading",
            },
          ]
        : []),
      ...(prod.data ?? []).map((f) => ({
        key: f.path,
        name: f.name,
        path: f.path,
        size: f.size,
        date: f.created_at,
        audio: isAudioName(f.name),
        onDelete: () => deleteFolderFile(id, "prod", f),
      })),
    ],
    stems: stems.map((s) => {
      const ext = fileExtension(s.original_filename ?? s.file_path);
      return {
        key: s.id,
        name: s.original_filename ?? `${s.name}${ext ? `.${ext}` : ""}`,
        path: s.status === "ready" ? s.file_path : null,
        size: s.file_size,
        date: s.created_at,
        audio: true,
        busy: s.status === "uploading",
        badge: s.status === "error" ? "Échec de l'import" : undefined,
        onDelete: () => deleteStem(s),
      };
    }),
    session: (session.data ?? []).map((f) => ({
      key: f.path,
      name: f.name,
      path: f.path,
      size: f.size,
      date: f.created_at,
      audio: isAudioName(f.name),
      onDelete: () => deleteFolderFile(id, "session", f),
    })),
  };
  const loading: Record<Dir, boolean> = { prod: prod.isLoading, stems: false, session: session.isLoading };

  const add = (d: Dir, files: File[]) => {
    const audio = files.filter(isAudioFile);
    if (d !== "session" && audio.length < files.length) {
      toast.error(
        d === "stems" ? "Les stems doivent être des fichiers audio" : "Seuls les fichiers audio vont dans Prod",
      );
    }
    if (d === "session") return void uploadFolderFiles(id, "session", files);
    if (!audio.length) return;
    if (d === "prod") return void uploadFolderFiles(id, "prod", audio);
    void uploadStems(id, audio, track.current_version_id).catch((e) => toast.error(errorMessage(e)));
  };
  const pick = (d: Dir) =>
    pickFiles((files) => add(d, files), { multiple: true, accept: d === "session" ? "" : AUDIO_ACCEPT });

  return (
    <div className="px-4 pt-6 pb-10 md:px-8 md:pt-8">
      <nav className="text-muted mb-5 flex min-w-0 flex-wrap items-center gap-1 text-[13px]">
        <Link href="/library" className="hover:text-fg">
          Bibliothèque
        </Link>
        <ChevronRight className="text-faint size-3.5 shrink-0" />
        {dir ? (
          <button onClick={() => go(null)} className="hover:text-fg max-w-60 truncate">
            {track.title}
          </button>
        ) : (
          <span className="text-fg max-w-60 truncate">{track.title}</span>
        )}
        {dir ? (
          <>
            <ChevronRight className="text-faint size-3.5 shrink-0" />
            <span className="text-fg">{dir.label}</span>
          </>
        ) : null}
      </nav>

      <div className="mb-6 flex flex-wrap items-center gap-3">
        <FolderOpen className="text-accent size-7 shrink-0" />
        <h1 className="min-w-0 flex-1 truncate text-2xl font-semibold tracking-tight">
          {dir ? dir.label : track.title}
        </h1>
        {dir ? (
          <Button variant="primary" onClick={() => pick(dir.id)}>
            <Upload /> Importer
          </Button>
        ) : (
          <Button variant="ghost" onClick={() => router.push(`/tracks/${id}`)}>
            <ExternalLink /> Fiche du morceau
          </Button>
        )}
      </div>

      {!dir ? (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(180px,1fr))] gap-3">
          {DIRS.map((d) => (
            <FolderTile
              key={d.id}
              label={d.label}
              hint={d.hint}
              count={loading[d.id] ? null : entries[d.id].length}
              onOpen={() => go(d.id)}
              onDropFiles={(files) => add(d.id, files)}
            />
          ))}
        </div>
      ) : (
        <FolderContents
          entries={entries[dir.id]}
          loading={loading[dir.id]}
          dropHint={dir.drop}
          onFiles={(files) => add(dir.id, files)}
          onPick={() => pick(dir.id)}
        />
      )}
    </div>
  );
}

function isAudioName(name: string) {
  return /\.(wav|mp3|aif|aiff|m4a|flac|ogg|aac)$/i.test(name);
}

function useFileDrop(onFiles: (files: File[]) => void) {
  const [over, setOver] = useState(false);
  return {
    over,
    props: {
      onDragOver: (e: React.DragEvent) => {
        if (!hasType(e, "Files")) return;
        e.preventDefault();
        e.stopPropagation();
        setOver(true);
      },
      onDragLeave: () => setOver(false),
      onDrop: (e: React.DragEvent) => {
        if (!hasType(e, "Files")) return;
        e.preventDefault();
        e.stopPropagation();
        setOver(false);
        const files = Array.from(e.dataTransfer.files);
        if (files.length) onFiles(files);
      },
    },
  };
}

function FolderTile({
  label,
  hint,
  count,
  onOpen,
  onDropFiles,
}: {
  label: string;
  hint: string;
  count: number | null;
  onOpen: () => void;
  onDropFiles: (files: File[]) => void;
}) {
  const drop = useFileDrop(onDropFiles);
  return (
    <button
      onClick={onOpen}
      {...drop.props}
      className={cn(
        "border-line bg-panel hover:bg-raised flex flex-col items-start gap-3 rounded-2xl border p-4 text-left transition-colors",
        drop.over && "ring-accent/60 bg-accent/5 ring-1",
      )}
    >
      <Folder className="text-accent size-8" fill="currentColor" fillOpacity={0.15} />
      <span>
        <span className="block text-[14px] font-semibold">{label}</span>
        <span className="text-faint block text-xs">
          {count === null ? "…" : `${count} fichier${count > 1 ? "s" : ""}`} · {hint}
        </span>
      </span>
    </button>
  );
}

function FolderContents({
  entries,
  loading,
  dropHint,
  onFiles,
  onPick,
}: {
  entries: Entry[];
  loading: boolean;
  dropHint: string;
  onFiles: (files: File[]) => void;
  onPick: () => void;
}) {
  const drop = useFileDrop(onFiles);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [playing, setPlaying] = useState<string | null>(null);

  useEffect(() => () => audioRef.current?.pause(), []);

  const toggle = async (e: Entry) => {
    if (!e.path) return;
    const a = (audioRef.current ??= new Audio());
    a.onended = () => setPlaying(null);
    if (playing === e.key) {
      a.pause();
      setPlaying(null);
      return;
    }
    const url = await signedUrl(e.path);
    if (!url) return void toast.error("Lecture impossible");
    usePlayer.getState().pause();
    a.src = url;
    setPlaying(e.key);
    a.play().catch(() => setPlaying(null));
  };

  const download = async (e: Entry) => {
    if (!e.path) return;
    try {
      triggerDownload(await downloadUrl(e.path, safeFilename(e.name)));
    } catch (err) {
      toast.error("Échec du téléchargement", { description: errorMessage(err) });
    }
  };

  const remove = async (e: Entry) => {
    if (!e.onDelete) return;
    const ok = await confirm({
      title: `Supprimer « ${e.name} » ?`,
      body: "Le fichier sera supprimé définitivement.",
      confirmLabel: "Supprimer",
      danger: true,
    });
    if (!ok) return;
    if (playing === e.key) audioRef.current?.pause();
    e.onDelete().catch((err) => toast.error("Suppression impossible", { description: errorMessage(err) }));
  };

  return (
    <div
      {...drop.props}
      className={cn("min-h-[50vh] rounded-2xl transition-colors", drop.over && "ring-accent/60 bg-accent/5 ring-1")}
    >
      {loading ? (
        <div className="space-y-2">
          <Skeleton className="h-12" />
          <Skeleton className="h-12" />
        </div>
      ) : entries.length ? (
        <div className="border-line divide-line divide-y overflow-hidden rounded-2xl border">
          {entries.map((e) => (
            <div key={e.key} className="bg-panel flex items-center gap-3 px-3 py-2.5">
              {e.audio ? (
                <button
                  onClick={() => void toggle(e)}
                  disabled={!e.path}
                  className="bg-raised hover:bg-hover grid size-9 shrink-0 place-items-center rounded-lg disabled:opacity-40"
                  aria-label={playing === e.key ? "Pause" : "Écouter"}
                >
                  {playing === e.key ? <Pause className="size-4" /> : <Play className="size-4" />}
                </button>
              ) : (
                <span className="bg-raised text-muted grid size-9 shrink-0 place-items-center rounded-lg">
                  <FileBox className="size-4" />
                </span>
              )}
              <div className="min-w-0 flex-1">
                <p className="truncate text-[13.5px]">{e.name}</p>
                <p className="text-faint truncate text-xs">
                  {[
                    fileExtension(e.name).toUpperCase() || null,
                    e.size ? formatBytes(e.size) : null,
                    e.date ? shortDate(e.date) : null,
                    e.badge ?? null,
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </p>
              </div>
              {e.busy ? <Spinner className="text-faint size-4" /> : null}
              <Button
                variant="ghost"
                size="icon-sm"
                disabled={!e.path}
                onClick={() => void download(e)}
                aria-label="Télécharger"
              >
                <Download />
              </Button>
              {e.onDelete ? (
                <Button variant="ghost" size="icon-sm" onClick={() => void remove(e)} aria-label="Supprimer">
                  <Trash2 />
                </Button>
              ) : null}
            </div>
          ))}
        </div>
      ) : (
        <EmptyState
          icon={FileAudio}
          title="Dossier vide"
          action={
            <Button variant="primary" onClick={onPick}>
              <Upload /> Importer
            </Button>
          }
        >
          {dropHint}
        </EmptyState>
      )}
      {entries.length ? <p className="text-faint mt-3 text-xs">{dropHint}</p> : null}
    </div>
  );
}
