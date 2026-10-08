"use client";

import { Check, Download, MoreHorizontal, Pause, Play, Plus, Star, Trash2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { DropdownMenu } from "@/components/ui/menu";
import { Spinner } from "@/components/ui/spinner";
import { deleteVersion, setCurrentVersion, updateVersion } from "@/lib/data/tracks";
import { hasType } from "@/lib/dnd";
import { shortKey } from "@/lib/music";
import { usePlayer, versionToItem } from "@/lib/player/store";
import { downloadUrl, triggerDownload } from "@/lib/storage";
import type { Track, TrackVersion } from "@/lib/types";
import { confirm } from "@/lib/ui-store";
import { pickFiles } from "@/lib/upload/pick";
import { uploadNewVersion } from "@/lib/upload/uploads";
import {
  cn,
  errorMessage,
  fileExtension,
  formatBpm,
  formatBytes,
  formatDuration,
  relativeDate,
  safeFilename,
} from "@/lib/utils";
import { InlineEdit } from "./inline-edit";

export function VersionsPanel({ track, versions }: { track: Track; versions: TrackVersion[] }) {
  const [over, setOver] = useState(false);
  const playingId = usePlayer((s) => (s.current?.trackId === track.id ? s.current.versionId : null));
  const isPlaying = usePlayer((s) => s.playing);

  const upload = (files: File[]) => {
    const f = files[0];
    if (!f) return;
    uploadNewVersion(track.id, f)
      .then(() =>
        toast.success("Nouvelle version en cours d'import", { description: "Elle devient la version actuelle." }),
      )
      .catch((e) => toast.error(errorMessage(e)));
  };

  const play = (v: TrackVersion) => {
    const p = usePlayer.getState();
    if (p.current?.trackId === track.id && p.current.versionId === v.id) p.toggle();
    else {
      const item = versionToItem(track, v);
      if (v.id === track.current_version_id) item.versionLabel = null;
      void p.playItem(item, [item]);
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
        upload(Array.from(e.dataTransfer.files));
      }}
      className={cn("rounded-xl transition-colors", over && "bg-accent/5 ring-accent/50 ring-1")}
    >
      <div className="mb-2 flex items-center justify-between">
        <h3 className="text-[13px] font-semibold">
          Versions <span className="text-faint font-normal">{versions.length}</span>
        </h3>
        <Button variant="ghost" size="sm" onClick={() => pickFiles(upload, { multiple: false })}>
          <Plus /> Nouvelle version
        </Button>
      </div>
      <ul className="divide-line border-line divide-y overflow-hidden rounded-xl border">
        {versions.map((v) => {
          const current = v.id === track.current_version_id;
          const thisPlaying = playingId === v.id && isPlaying;
          return (
            <li key={v.id} className={cn("group flex items-center gap-3 px-3 py-2.5", current && "bg-raised")}>
              <button
                onClick={() => play(v)}
                disabled={v.status === "uploading"}
                className="bg-hover text-fg hover:bg-active grid size-8 shrink-0 place-items-center rounded-full disabled:opacity-40"
                aria-label={thisPlaying ? "Pause" : `Lire ${v.label}`}
              >
                {v.status === "uploading" ? (
                  <Spinner className="size-3.5" />
                ) : thisPlaying ? (
                  <Pause className="size-3.5" fill="currentColor" />
                ) : (
                  <Play className="size-3.5 translate-x-px" fill="currentColor" />
                )}
              </button>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <InlineEdit
                    value={v.label}
                    onSave={(label) =>
                      updateVersion(v.id, track.id, { label: label || `V${v.version_number}` }).catch((e) =>
                        toast.error(errorMessage(e)),
                      )
                    }
                    className="text-[13px] font-medium"
                  />
                  {current ? (
                    <span className="bg-accent/15 text-accent rounded px-1.5 py-px text-[10px] font-semibold tracking-wider uppercase">
                      Actuelle
                    </span>
                  ) : null}
                </div>
                <p className="text-faint truncate text-[11.5px]">
                  {[
                    relativeDate(v.created_at),
                    formatDuration(v.duration),
                    v.bpm ? `${formatBpm(v.bpm)} BPM` : null,
                    v.key ? shortKey(v.key) : null,
                    formatBytes(v.file_size),
                    v.original_filename,
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                  {v.status === "error" ? <span className="text-danger"> · échec de l’import</span> : null}
                </p>
              </div>
              {!current && v.status === "ready" ? (
                <Button
                  size="sm"
                  variant="ghost"
                  className="opacity-0 group-hover:opacity-100 max-md:opacity-100"
                  onClick={() =>
                    setCurrentVersion(track.id, v.id)
                      .then(() => toast.success(`${v.label} est maintenant la version actuelle`))
                      .catch((e) => toast.error(errorMessage(e)))
                  }
                >
                  <Check /> Définir actuelle
                </Button>
              ) : null}
              <DropdownMenu
                entries={[
                  {
                    label: "Définir comme version actuelle",
                    icon: Star,
                    disabled: current || v.status !== "ready",
                    onSelect: () => void setCurrentVersion(track.id, v.id).catch((e) => toast.error(errorMessage(e))),
                  },
                  {
                    label: "Télécharger",
                    icon: Download,
                    disabled: v.status === "uploading",
                    onSelect: async () => {
                      try {
                        const ext = fileExtension(v.original_filename ?? v.file_path) || "wav";
                        triggerDownload(
                          await downloadUrl(v.file_path, `${safeFilename(track.title)} (${v.label}).${ext}`),
                        );
                      } catch (e) {
                        toast.error(errorMessage(e));
                      }
                    },
                  },
                  { type: "separator" },
                  {
                    label: "Supprimer la version",
                    icon: Trash2,
                    danger: true,
                    disabled: current,
                    onSelect: async () => {
                      const ok = await confirm({
                        title: `Supprimer ${v.label} ?`,
                        body: "Son fichier audio sera définitivement supprimé.",
                        confirmLabel: "Supprimer",
                        danger: true,
                      });
                      if (ok) await deleteVersion(v, track).catch((e) => toast.error(errorMessage(e)));
                    },
                  },
                ]}
                trigger={
                  <button
                    className="text-faint hover:bg-active hover:text-fg rounded-md p-1.5"
                    aria-label="Options de la version"
                  >
                    <MoreHorizontal className="size-4" />
                  </button>
                }
              />
            </li>
          );
        })}
      </ul>
      <p className="text-faint mt-2 text-[11px]">Dépose un fichier audio ici pour ajouter une version.</p>
    </section>
  );
}
