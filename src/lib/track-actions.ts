"use client";

import {
  Copy,
  Download,
  ExternalLink,
  FolderInput,
  FolderPlus,
  Heart,
  HeartOff,
  ListPlus,
  Play,
  SquarePen,
  Trash2,
  Type,
} from "lucide-react";
import { toast } from "sonner";
import type { MenuEntry } from "@/components/ui/menu";
import { getQueryClient, qk } from "@/lib/data/client";
import { duplicateTrack, moveTracks, restoreTracks, toggleFavorite, trashTracks } from "@/lib/data/tracks";
import { usePlayer, trackToItem } from "@/lib/player/store";
import { downloadUrl, triggerDownload } from "@/lib/storage";
import type { Project, Track } from "@/lib/types";
import { useUI } from "@/lib/ui-store";
import { errorMessage, fileExtension, safeFilename } from "@/lib/utils";

type Router = { push: (href: string) => void };

export function findTrack(id: string): Track | undefined {
  const qc = getQueryClient();
  return (
    qc.getQueryData<Track[]>(qk.tracks)?.find((t) => t.id === id) ??
    qc.getQueryData<{ track: Track }>(qk.track(id))?.track
  );
}

export async function downloadTrack(track: Track, kind: "original" | "mp3") {
  try {
    const base = safeFilename(track.title);
    if (kind === "mp3") {
      const path = track.preview_path ?? (track.mime_type === "audio/mpeg" ? track.file_path : null);
      if (!path) throw new Error("Aucun MP3 disponible pour ce morceau pour l'instant");
      triggerDownload(await downloadUrl(path, `${base}.mp3`));
    } else {
      if (!track.file_path) throw new Error("Import en cours");
      const ext = fileExtension(track.original_filename ?? track.file_path) || "wav";
      triggerDownload(await downloadUrl(track.file_path, `${base}.${ext}`));
    }
  } catch (e) {
    toast.error("Échec du téléchargement", { description: errorMessage(e) });
  }
}

export async function trashWithUndo(ids: string[]) {
  try {
    await trashTracks(ids);
    toast(`${ids.length > 1 ? `${ids.length} morceaux déplacés` : "Morceau déplacé"} dans la corbeille`, {
      action: {
        label: "Annuler",
        onClick: () => void restoreTracks(ids).catch((e) => toast.error(errorMessage(e))),
      },
    });
  } catch (e) {
    toast.error("Suppression impossible", { description: errorMessage(e) });
  }
}

export async function duplicateWithToast(track: Track) {
  const id = toast.loading(`Duplication de « ${track.title} »…`);
  try {
    await duplicateTrack(track.id);
    toast.success("Dupliqué", { id });
  } catch (e) {
    toast.error("Échec de la duplication", { id, description: errorMessage(e) });
  }
}

export function trackMenu(
  track: Track,
  ctx: { router: Router; projects: Project[]; queue?: Track[]; selection?: string[] },
): MenuEntry[] {
  const ui = useUI.getState();
  const ids =
    ctx.selection && ctx.selection.length > 1 && ctx.selection.includes(track.id) ? ctx.selection : [track.id];
  const multi = ids.length > 1;
  const isMp3Available = !!track.preview_path || track.mime_type === "audio/mpeg";
  const isLosslessOriginal = !!track.mime_type && track.mime_type !== "audio/mpeg";

  const projectItems: MenuEntry[] = [
    { label: "Aucun projet", onSelect: () => void moveTracks(ids, null).catch((e) => toast.error(errorMessage(e))) },
    ...(ctx.projects.length ? [{ type: "separator" } as MenuEntry] : []),
    ...ctx.projects.slice(0, 30).map<MenuEntry>((p) => ({
      label: p.name,
      onSelect: () =>
        void moveTracks(ids, p.id)
          .then(() => toast.success(`Déplacé dans ${p.name}`))
          .catch((e) => toast.error(errorMessage(e))),
    })),
    { type: "separator" },
    {
      label: "Nouveau projet…",
      icon: FolderPlus,
      onSelect: () => ui.openDialog({ type: "project", mode: "create", kind: "project", moveTrackIds: ids }),
    },
    { label: "Choisir…", icon: FolderInput, onSelect: () => ui.openDialog({ type: "move", trackIds: ids }) },
  ];

  if (multi) {
    return [
      { type: "label", label: `${ids.length} morceaux sélectionnés` },
      {
        label: "Lire la sélection",
        icon: Play,
        onSelect: () => {
          const list = ids.map(findTrack).filter((t): t is Track => !!t);
          void usePlayer.getState().playTracks(list, 0);
        },
      },
      { type: "submenu", label: "Ajouter à un projet", icon: FolderInput, items: projectItems },
      { type: "separator" },
      { label: `Supprimer ${ids.length} morceaux`, icon: Trash2, danger: true, onSelect: () => trashWithUndo(ids) },
    ];
  }

  return [
    {
      label: "Lire",
      icon: Play,
      shortcut: "Space",
      onSelect: () => {
        const queue = ctx.queue?.length ? ctx.queue : [track];
        void usePlayer.getState().playTracks(
          queue,
          Math.max(
            0,
            queue.findIndex((t) => t.id === track.id),
          ),
        );
      },
    },
    {
      label: "Lire ensuite",
      icon: ListPlus,
      onSelect: () => {
        const s = usePlayer.getState();
        if (!s.current) return void s.playTracks([track]);
        const q = s.queue.slice();
        q.splice(s.index + 1, 0, trackToItem(track));
        usePlayer.setState({ queue: q });
        toast("Lecture ensuite", { description: track.title });
      },
    },
    { label: "Ouvrir", icon: ExternalLink, onSelect: () => ctx.router.push(`/tracks/${track.id}`) },
    { type: "separator" },
    {
      label: "Modifier les infos",
      icon: SquarePen,
      onSelect: () => ui.openDialog({ type: "edit", trackId: track.id }),
    },
    { label: "Renommer", icon: Type, onSelect: () => ui.openDialog({ type: "rename-track", trackId: track.id }) },
    { type: "submenu", label: "Ajouter à un projet", icon: FolderInput, items: projectItems },
    {
      label: track.favorite ? "Retirer des favoris" : "Ajouter aux favoris",
      icon: track.favorite ? HeartOff : Heart,
      shortcut: "F",
      onSelect: () => toggleFavorite(track).catch((e) => toast.error(errorMessage(e))),
    },
    { type: "separator" },
    {
      type: "submenu",
      label: "Télécharger",
      icon: Download,
      items: [
        { label: "MP3", disabled: !isMp3Available, onSelect: () => downloadTrack(track, "mp3") },
        {
          label: isLosslessOriginal
            ? `Original (${fileExtension(track.original_filename ?? "").toUpperCase() || "WAV"})`
            : "Original",
          onSelect: () => downloadTrack(track, "original"),
        },
      ],
    },
    { type: "separator" },
    { label: "Dupliquer", icon: Copy, onSelect: () => duplicateWithToast(track) },
    { label: "Supprimer", icon: Trash2, danger: true, shortcut: "⌫", onSelect: () => trashWithUndo([track.id]) },
  ];
}
