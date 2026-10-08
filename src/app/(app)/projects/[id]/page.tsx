"use client";

import { ChevronRight, Disc3, Folder, FolderPlus, ImagePlus, MoreHorizontal, Share2, Upload, X } from "lucide-react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useMemo } from "react";
import { LibraryView } from "@/components/track/library-view";
import {
  pickProjectCover,
  ProjectCard,
  projectMenu,
  removeProjectCover,
  useProjectDrop,
} from "@/components/track/project-card";
import { Cover } from "@/components/ui/cover";
import { Button } from "@/components/ui/button";
import { DropdownMenu } from "@/components/ui/menu";
import { EmptyState } from "@/components/ui/misc";
import { Skeleton } from "@/components/ui/spinner";
import { useProjects } from "@/lib/data/library";
import { useTracks } from "@/lib/data/tracks";
import type { Filters } from "@/lib/search";
import type { Project } from "@/lib/types";
import { useUI } from "@/lib/ui-store";
import { pickAndImport } from "@/lib/upload/pick";
import { cn, formatDuration } from "@/lib/utils";

export default function ProjectPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { data: projects, isLoading } = useProjects();
  const { data: tracks = [] } = useTracks();
  const openDialog = useUI((s) => s.openDialog);
  const project = projects?.find((p) => p.id === id);
  const preset = useMemo<Filters>(() => ({ projectId: id }), [id]);

  const { crumbs, children, ownTracks } = useMemo(() => {
    const list = projects ?? [];
    const crumbs: Project[] = [];
    let cur = list.find((p) => p.id === id);
    while (cur?.parent_id) {
      const parent = list.find((p) => p.id === cur!.parent_id);
      if (!parent) break;
      crumbs.unshift(parent);
      cur = parent;
    }
    return {
      crumbs,
      children: list
        .filter((p) => p.parent_id === id)
        .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true })),
      ownTracks: tracks.filter((t) => t.project_id === id),
    };
  }, [projects, tracks, id]);

  if (isLoading) {
    return (
      <div className="space-y-3 px-4 pt-8 md:px-8">
        <Skeleton className="h-4 w-40" />
        <Skeleton className="h-8 w-64" />
      </div>
    );
  }
  if (!project) {
    return (
      <EmptyState
        icon={Disc3}
        title="Projet introuvable"
        action={<Button onClick={() => router.push("/projects")}>Tous les projets</Button>}
      >
        Il a peut-être été supprimé ou mis à la corbeille.
      </EmptyState>
    );
  }

  const Icon = project.kind === "folder" ? Folder : Disc3;
  const total = ownTracks.reduce((s, t) => s + (t.duration ?? 0), 0);

  return (
    <LibraryView
      key={id}
      preset={preset}
      showProject={false}
      uploadProjectId={id}
      hideFilters={["projectId"]}
      header={
        <>
          <ProjectHeader project={project} crumbs={crumbs}>
            <div className="flex items-center gap-2">
              <span className="text-muted text-[13px]">
                {ownTracks.length} morceau{ownTracks.length === 1 ? "" : "x"}
                {total ? ` · ${formatDuration(total)}` : ""}
              </span>
              <Button
                variant="ghost"
                onClick={() => openDialog({ type: "project", mode: "create", kind: "folder", parentId: id })}
              >
                <FolderPlus /> <span className="max-sm:hidden">Sous-dossier</span>
              </Button>
              <Button
                variant="primary"
                onClick={() => openDialog({ type: "project-share", projectId: id })}
                title="Partager (S)"
              >
                <Share2 /> Partager
              </Button>
              <Button variant="ghost" onClick={() => pickAndImport(id)} className="sm:hidden" aria-label="Importer">
                <Upload />
              </Button>
              <DropdownMenu
                entries={projectMenu(project, router)}
                trigger={
                  <Button variant="ghost" size="icon" aria-label="Plus d'options">
                    <MoreHorizontal />
                  </Button>
                }
              />
            </div>
          </ProjectHeader>
          {children.length ? (
            <div className="grid grid-cols-3 gap-1 px-2 pb-2 sm:grid-cols-4 md:px-6 lg:grid-cols-6 xl:grid-cols-8">
              {children.map((c) => (
                <ProjectCard
                  key={c.id}
                  project={c}
                  tracks={tracks.filter((t) => t.project_id === c.id)}
                  childCount={(projects ?? []).filter((p) => p.parent_id === c.id).length}
                />
              ))}
            </div>
          ) : null}
        </>
      }
      emptyState={
        <EmptyState
          icon={Icon}
          title={children.length ? "Aucun morceau directement ici" : "Projet vide"}
          action={
            <Button variant="primary" onClick={() => pickAndImport(id)}>
              <Upload /> Importer dans {project.name}
            </Button>
          }
        >
          Dépose des fichiers audio ici, ou glisse des morceaux de la bibliothèque sur ce projet dans la barre latérale.
        </EmptyState>
      }
    />
  );
}

function ProjectHeader({
  project,
  crumbs,
  children,
}: {
  project: Project;
  crumbs: Project[];
  children: React.ReactNode;
}) {
  const { over, props } = useProjectDrop(project);
  const Icon = project.kind === "folder" ? Folder : Disc3;
  return (
    <div {...props} className={cn("px-4 pt-6 pb-4 md:px-8 md:pt-8", over && "bg-accent/5")}>
      <nav className="text-faint mb-2 flex flex-wrap items-center gap-1 text-xs">
        <Link href="/projects" className="hover:text-fg">
          Projets
        </Link>
        {crumbs.map((c) => (
          <span key={c.id} className="flex items-center gap-1">
            <ChevronRight className="size-3" />
            <Link href={`/projects/${c.id}`} className="hover:text-fg">
              {c.name}
            </Link>
          </span>
        ))}
      </nav>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex min-w-0 items-end gap-4">
          <div className="group relative size-24 shrink-0 md:size-32">
            <Cover
              path={project.cover_path}
              seed={project.id}
              className="size-full shadow-xl shadow-black/40"
              rounded="rounded-xl"
            >
              {!project.cover_path ? (
                <div className="absolute inset-0 grid place-items-center">
                  <Icon className="size-9 text-white/50" strokeWidth={1.25} />
                </div>
              ) : null}
            </Cover>
            <div className="absolute inset-0 flex items-center justify-center gap-2 rounded-xl bg-black/50 opacity-0 transition-opacity group-hover:opacity-100 max-md:items-end max-md:justify-end max-md:bg-transparent max-md:p-1.5 max-md:opacity-100">
              <button
                onClick={() => pickProjectCover(project)}
                className="rounded-full bg-black/60 p-2 text-white hover:bg-black/80"
                aria-label={project.cover_path ? "Changer la pochette" : "Ajouter une pochette"}
                title={project.cover_path ? "Changer la pochette" : "Ajouter une pochette (ou glisse une image ici)"}
              >
                <ImagePlus className="size-4" />
              </button>
              {project.cover_path ? (
                <button
                  onClick={() => void removeProjectCover(project)}
                  className="rounded-full bg-black/60 p-2 text-white hover:bg-black/80 max-md:hidden"
                  aria-label="Retirer la pochette"
                  title="Retirer la pochette"
                >
                  <X className="size-4" />
                </button>
              ) : null}
            </div>
          </div>
          <div className="min-w-0 pb-1">
            <p className="text-faint mb-1 text-[11px] font-medium tracking-wider uppercase">
              {project.kind === "folder" ? "Dossier" : "Projet"}
            </p>
            <h1 className="truncate text-2xl font-semibold tracking-tight md:text-3xl">{project.name}</h1>
          </div>
        </div>
        {children}
      </div>
    </div>
  );
}
