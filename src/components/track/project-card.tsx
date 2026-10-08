"use client";

import {
  Copy,
  Disc3,
  ExternalLink,
  Folder,
  FolderInput,
  ImageMinus,
  ImagePlus,
  Mail,
  MoreHorizontal,
  Pencil,
  Share2,
  Trash2,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { Cover, generatedArt } from "@/components/ui/cover";
import { ContextMenu, DropdownMenu, type MenuEntry } from "@/components/ui/menu";
import { duplicateProject, trashProject, updateProject, uploadCover } from "@/lib/data/library";
import { moveTracks } from "@/lib/data/tracks";
import { DND_PROJECT, DND_TRACKS, hasType, readTrackDrag } from "@/lib/dnd";
import type { Project, Track } from "@/lib/types";
import { confirm, useUI } from "@/lib/ui-store";
import { removeFiles } from "@/lib/storage";
import { pickFiles } from "@/lib/upload/pick";
import { importFiles } from "@/lib/upload/uploads";
import { cn, errorMessage } from "@/lib/utils";

/** Uploads an image as the project cover (resized to a 600px JPEG) and drops the old one. */
export async function setProjectCover(project: Project, file: File) {
  if (!file.type.startsWith("image/")) {
    toast.error("Choisis une image (JPG, PNG, WebP…)");
    return;
  }
  const id = toast.loading("Ajout de la pochette…");
  try {
    const old = project.cover_path;
    const path = await uploadCover(project.id, file);
    await updateProject(project.id, { cover_path: path });
    if (old) void removeFiles([old]);
    toast.success("Pochette mise à jour", { id });
  } catch (e) {
    toast.error("Échec de l'ajout de la pochette", { id, description: errorMessage(e) });
  }
}

export async function removeProjectCover(project: Project) {
  if (!project.cover_path) return;
  try {
    await updateProject(project.id, { cover_path: null });
    void removeFiles([project.cover_path]);
  } catch (e) {
    toast.error(errorMessage(e));
  }
}

export function pickProjectCover(project: Project) {
  pickFiles((files) => void setProjectCover(project, files[0]), { multiple: false, accept: "image/*" });
}

export function projectMenu(project: Project, router: { push: (h: string) => void }): MenuEntry[] {
  const ui = useUI.getState();
  return [
    { label: "Ouvrir", icon: ExternalLink, onSelect: () => router.push(`/projects/${project.id}`) },
    {
      label: "Partager…",
      icon: Share2,
      shortcut: "S",
      onSelect: () => ui.openDialog({ type: "project-share", projectId: project.id }),
    },
    {
      label: "Envoyer par e-mail…",
      icon: Mail,
      shortcut: "E",
      onSelect: () => ui.openDialog({ type: "project-share", projectId: project.id, view: "email" }),
    },
    { type: "separator" },
    {
      label: "Renommer",
      icon: Pencil,
      onSelect: () => ui.openDialog({ type: "project", mode: "rename", projectId: project.id }),
    },
    {
      label: project.cover_path ? "Changer la pochette" : "Ajouter une pochette",
      icon: ImagePlus,
      onSelect: () => pickProjectCover(project),
    },
    ...(project.cover_path
      ? [{ label: "Retirer la pochette", icon: ImageMinus, onSelect: () => void removeProjectCover(project) }]
      : []),
    {
      label: "Déplacer vers…",
      icon: FolderInput,
      onSelect: () => ui.openDialog({ type: "move-project", projectId: project.id }),
    },
    {
      label: "Dupliquer",
      icon: Copy,
      onSelect: async () => {
        const id = toast.loading(`Duplication de ${project.name}…`);
        try {
          const p = await duplicateProject(project.id);
          toast.success("Dupliqué", {
            id,
            action: { label: "Ouvrir", onClick: () => router.push(`/projects/${p.id}`) },
          });
        } catch (e) {
          toast.error("Échec de la duplication", { id, description: errorMessage(e) });
        }
      },
    },
    {
      label: project.kind === "folder" ? "Convertir en projet" : "Convertir en dossier",
      icon: project.kind === "folder" ? Disc3 : Folder,
      onSelect: () => void updateProject(project.id, { kind: project.kind === "folder" ? "project" : "folder" }),
    },
    { type: "separator" },
    {
      label: "Supprimer",
      icon: Trash2,
      danger: true,
      onSelect: async () => {
        const ok = await confirm({
          title: `Supprimer « ${project.name} » ?`,
          body: "Le projet, ses sous-projets et leurs morceaux vont dans la corbeille. Tu pourras les restaurer depuis là.",
          confirmLabel: "Mettre à la corbeille",
          danger: true,
        });
        if (!ok) return;
        try {
          await trashProject(project.id);
          toast.success("Mis à la corbeille");
        } catch (e) {
          toast.error(errorMessage(e));
        }
      },
    },
  ];
}

/** Drag & drop target behaviour shared by project cards and tree rows. */
export function useProjectDrop(project: Project) {
  const [over, setOver] = useState(false);
  return {
    over,
    props: {
      onDragOver: (e: React.DragEvent) => {
        if (hasType(e, DND_TRACKS) || hasType(e, DND_PROJECT) || hasType(e, "Files")) {
          e.preventDefault();
          e.stopPropagation();
          setOver(true);
        }
      },
      onDragLeave: () => setOver(false),
      onDrop: async (e: React.DragEvent) => {
        e.preventDefault();
        e.stopPropagation();
        setOver(false);
        try {
          const ids = readTrackDrag(e);
          if (ids?.length) {
            await moveTracks(ids, project.id);
            toast.success(`Déplacé dans ${project.name}`);
            return;
          }
          const pid = e.dataTransfer.getData(DND_PROJECT);
          if (pid && pid !== project.id) {
            await updateProject(pid, { parent_id: project.id });
            return;
          }
          const files = Array.from(e.dataTransfer.files);
          // An image dropped on a project becomes its cover; audio files are imported into it.
          const image = files.find((f) => f.type.startsWith("image/"));
          if (image) await setProjectCover(project, image);
          const audio = files.filter((f) => !f.type.startsWith("image/"));
          if (audio.length) await importFiles(audio, { projectId: project.id });
        } catch (err) {
          toast.error(errorMessage(err));
        }
      },
    },
  };
}

export function ProjectCard({
  project,
  tracks,
  childCount,
}: {
  project: Project;
  tracks: Track[];
  childCount: number;
}) {
  const router = useRouter();
  const { over, props } = useProjectDrop(project);
  const covers = tracks.filter((t) => t.cover_path).slice(0, 4);
  const Icon = project.kind === "folder" ? Folder : Disc3;
  const entries = projectMenu(project, router);

  return (
    <ContextMenu entries={entries}>
      <div
        draggable
        onDragStart={(e) => {
          e.dataTransfer.setData(DND_PROJECT, project.id);
          e.dataTransfer.effectAllowed = "move";
        }}
        {...props}
        className={cn(
          "group hover:bg-hover/60 relative rounded-xl p-2 transition-colors",
          over && "bg-accent/10 ring-accent/60 ring-1",
        )}
      >
        <Link href={`/projects/${project.id}`} className="block">
          <div className="relative aspect-square overflow-hidden rounded-lg" style={generatedArt(project.id)}>
            {project.cover_path ? (
              <Cover path={project.cover_path} seed={project.id} className="absolute inset-0 size-full" rounded="" />
            ) : covers.length >= 4 ? (
              <div className="grid size-full grid-cols-2 grid-rows-2">
                {covers.map((t) => (
                  <Cover key={t.id} path={t.cover_path} seed={t.id} className="size-full" rounded="" />
                ))}
              </div>
            ) : covers.length ? (
              <Cover
                path={covers[0].cover_path}
                seed={covers[0].id}
                className="absolute inset-0 size-full"
                rounded=""
              />
            ) : (
              <div className="grid size-full place-items-center">
                <Icon className="size-10 text-white/50" strokeWidth={1.25} />
              </div>
            )}
          </div>
        </Link>
        <div className="mt-2.5 flex items-center gap-1.5 px-0.5">
          <Link href={`/projects/${project.id}`} className="min-w-0 flex-1">
            <p className="truncate text-[13.5px] font-medium">{project.name}</p>
            <p className="text-muted truncate text-xs">
              {tracks.length} morceau{tracks.length === 1 ? "" : "x"}
              {childCount ? ` · ${childCount} dossier${childCount === 1 ? "" : "s"}` : ""}
            </p>
          </Link>
          <button
            onClick={() => useUI.getState().openDialog({ type: "project-share", projectId: project.id })}
            className="border-line-strong text-muted hover:text-fg hover:bg-hover inline-flex h-7 shrink-0 items-center gap-1 rounded-full border px-2.5 text-xs font-medium"
            title="Partager le projet (S)"
          >
            <Share2 className="size-3.5" /> Partager
          </button>
        </div>
        <div className="absolute top-3.5 right-3.5 opacity-0 transition-opacity group-hover:opacity-100 max-md:opacity-100">
          <DropdownMenu
            entries={entries}
            trigger={
              <button
                className="grid size-7 place-items-center rounded-full bg-black/60 text-white backdrop-blur"
                aria-label="Plus d'options"
              >
                <MoreHorizontal className="size-4" />
              </button>
            }
          />
        </div>
      </div>
    </ContextMenu>
  );
}
