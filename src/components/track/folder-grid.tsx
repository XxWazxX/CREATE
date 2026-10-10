"use client";

import { ChevronRight, Folder, FolderOpen } from "lucide-react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Cover } from "@/components/ui/cover";
import { shortKey } from "@/lib/music";
import type { Project, Track } from "@/lib/types";
import { formatBpm } from "@/lib/utils";

const TILE =
  "border-line bg-panel hover:bg-raised flex min-w-0 flex-col gap-3 rounded-2xl border p-4 transition-colors";

/** URL of a project folder inside the library (`/library?projet={id}`). */
export function libraryProjectHref(projectId: string) {
  return `/library?projet=${projectId}`;
}

/**
 * Library as folders. Browsing (`grouped`): project folders first, each holding the
 * folders of its tracks; tracks without a project stay at the root. While searching
 * or filtering, the matching track folders are shown flat.
 * A track folder opens on its Prod / Stems / Session sub-folders.
 */
export function FolderGrid({
  tracks,
  projects,
  grouped,
  emptyState,
}: {
  tracks: Track[];
  projects: Project[];
  grouped: boolean;
  emptyState?: React.ReactNode;
}) {
  const openId = useSearchParams().get("projet");
  const byId = new Map(projects.map((p) => [p.id, p]));
  const open = grouped && openId ? (byId.get(openId) ?? null) : null;

  // Parents that aren't loaded (trashed) count as "no parent", like the sidebar does.
  const parentOf = (p: Project) => (p.parent_id && byId.has(p.parent_id) ? p.parent_id : null);
  const projectOf = (t: Track) => (t.project_id && byId.has(t.project_id) ? t.project_id : null);
  const here = open?.id ?? null;

  const subProjects = grouped
    ? projects
        .filter((p) => parentOf(p) === here)
        .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }))
    : [];
  const shown = grouped ? tracks.filter((t) => projectOf(t) === here) : tracks;

  /** Tracks in a project, sub-projects included. */
  const countIn = (id: string): number =>
    tracks.filter((t) => projectOf(t) === id).length +
    projects.filter((p) => parentOf(p) === id).reduce((n, p) => n + countIn(p.id), 0);

  const trail: Project[] = [];
  for (let p: Project | null = open; p; p = parentOf(p) ? (byId.get(parentOf(p)!) ?? null) : null) trail.unshift(p);

  if (!tracks.length && !subProjects.length && !open) return <>{emptyState}</>;

  return (
    <div className="px-4 pt-2 md:px-8">
      {open ? (
        <nav className="text-muted mb-4 flex min-w-0 flex-wrap items-center gap-1 text-[13px]">
          <Link href="/library" className="hover:text-fg">
            Bibliothèque
          </Link>
          {trail.map((p, i) => (
            <span key={p.id} className="flex min-w-0 items-center gap-1">
              <ChevronRight className="text-faint size-3.5 shrink-0" />
              {i === trail.length - 1 ? (
                <span className="text-fg flex min-w-0 items-center gap-1.5">
                  <FolderOpen className="text-accent size-4 shrink-0" />
                  <span className="max-w-60 truncate">{p.name}</span>
                </span>
              ) : (
                <Link href={libraryProjectHref(p.id)} className="hover:text-fg max-w-60 truncate">
                  {p.name}
                </Link>
              )}
            </span>
          ))}
        </nav>
      ) : null}

      {subProjects.length || shown.length ? (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(160px,1fr))] gap-3">
          {subProjects.map((p) => {
            const n = countIn(p.id);
            return (
              <Link key={p.id} href={libraryProjectHref(p.id)} className={TILE}>
                {p.cover_path ? (
                  <Cover path={p.cover_path} seed={p.id} className="size-9" />
                ) : (
                  <Folder className="text-accent size-9" fill="currentColor" fillOpacity={0.55} />
                )}
                <span className="min-w-0">
                  <span className="block truncate text-[13.5px] font-semibold">{p.name}</span>
                  <span className="text-faint block truncate text-xs">
                    Projet · {n} instru{n > 1 ? "s" : ""}
                  </span>
                </span>
              </Link>
            );
          })}
          {shown.map((t) => (
            <Link key={t.id} href={`/library/${t.id}`} className={TILE}>
              <Folder className="text-accent size-9" fill="currentColor" fillOpacity={0.15} />
              <span className="min-w-0">
                <span className="block truncate text-[13.5px] font-semibold">{t.title}</span>
                <span className="text-faint block truncate text-xs">
                  {[t.bpm ? `${formatBpm(t.bpm)} BPM` : null, t.key ? shortKey(t.key) : null]
                    .filter(Boolean)
                    .join(" · ") || "Prod · Stems · Session"}
                </span>
              </span>
            </Link>
          ))}
        </div>
      ) : (
        <p className="text-muted py-10 text-center text-[13px]">Aucune instru dans ce projet pour l’instant.</p>
      )}
    </div>
  );
}
