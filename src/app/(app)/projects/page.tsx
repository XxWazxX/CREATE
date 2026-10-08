"use client";

import { Disc3, FolderPlus, Plus } from "lucide-react";
import { useMemo } from "react";
import { ProjectCard } from "@/components/track/project-card";
import { Button } from "@/components/ui/button";
import { EmptyState, PageHeader } from "@/components/ui/misc";
import { Skeleton } from "@/components/ui/spinner";
import { useProjects } from "@/lib/data/library";
import { useTracks } from "@/lib/data/tracks";
import { useUI } from "@/lib/ui-store";

export default function ProjectsPage() {
  const { data: projects, isLoading } = useProjects();
  const { data: tracks = [] } = useTracks();
  const openDialog = useUI((s) => s.openDialog);

  const { roots, tracksBy, childCount } = useMemo(() => {
    const list = projects ?? [];
    const ids = new Set(list.map((p) => p.id));
    const tracksBy = new Map<string, typeof tracks>();
    for (const t of tracks) if (t.project_id) tracksBy.set(t.project_id, [...(tracksBy.get(t.project_id) ?? []), t]);
    const childCount = new Map<string, number>();
    for (const p of list) if (p.parent_id) childCount.set(p.parent_id, (childCount.get(p.parent_id) ?? 0) + 1);
    const roots = list
      .filter((p) => !p.parent_id || !ids.has(p.parent_id))
      .sort((a, b) => b.updated_at.localeCompare(a.updated_at));
    return { roots, tracksBy, childCount };
  }, [projects, tracks]);

  return (
    <div className="pb-10">
      <PageHeader
        title="Projets"
        subtitle={
          projects
            ? `${projects.length} projet${projects.length > 1 ? "s" : ""} et dossier${projects.length > 1 ? "s" : ""}`
            : " "
        }
        actions={
          <>
            <Button variant="ghost" onClick={() => openDialog({ type: "project", mode: "create", kind: "folder" })}>
              <FolderPlus /> Dossier
            </Button>
            <Button variant="primary" onClick={() => openDialog({ type: "project", mode: "create", kind: "project" })}>
              <Plus /> Projet
            </Button>
          </>
        }
      />
      {isLoading ? (
        <div className="grid grid-cols-2 gap-4 px-4 sm:grid-cols-3 md:px-8 lg:grid-cols-4 xl:grid-cols-6">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="aspect-square" />
          ))}
        </div>
      ) : roots.length ? (
        <div className="grid grid-cols-2 gap-2 px-2 sm:grid-cols-3 md:px-6 lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6">
          {roots.map((p) => (
            <ProjectCard
              key={p.id}
              project={p}
              tracks={tracksBy.get(p.id) ?? []}
              childCount={childCount.get(p.id) ?? 0}
            />
          ))}
        </div>
      ) : (
        <EmptyState
          icon={Disc3}
          title="Aucun projet pour l'instant"
          action={
            <Button variant="primary" onClick={() => openDialog({ type: "project", mode: "create", kind: "project" })}>
              <Plus /> Nouveau projet
            </Button>
          }
        >
          Regroupe tes beats en albums, placements ou dossiers d’artistes. Glisse des morceaux sur un projet pour les
          ranger.
        </EmptyState>
      )}
    </div>
  );
}
