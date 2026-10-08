"use client";

import {
  ChevronRight,
  Clock,
  Disc3,
  Folder,
  FolderPlus,
  Heart,
  Home,
  Library,
  Mail,
  Plus,
  Search,
  Settings,
  Trash2,
  Upload,
} from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useMemo, useState, useSyncExternalStore } from "react";
import { toast } from "sonner";
import { Cover } from "@/components/ui/cover";
import { DropdownMenu } from "@/components/ui/menu";
import { Kbd } from "@/components/ui/input";
import { updateProject, useProjects } from "@/lib/data/library";
import { moveTracks } from "@/lib/data/tracks";
import { DND_PROJECT, DND_TRACKS, hasType, readTrackDrag } from "@/lib/dnd";
import type { Project } from "@/lib/types";
import { useUI } from "@/lib/ui-store";
import { pickAndImport } from "@/lib/upload/pick";
import { importFiles } from "@/lib/upload/uploads";
import { cn, errorMessage } from "@/lib/utils";

export const NAV = [
  { href: "/", label: "Accueil", icon: Home },
  { href: "/library", label: "Bibliothèque", icon: Library },
  { href: "/projects", label: "Projets", icon: Disc3 },
  { href: "/favorites", label: "Favoris", icon: Heart },
  { href: "/recent", label: "Ajouts récents", icon: Clock },
  { href: "/sent", label: "Envoyés", icon: Mail },
  { href: "/trash", label: "Corbeille", icon: Trash2 },
] as const;

export function isActive(pathname: string, href: string) {
  return href === "/" ? pathname === "/" : pathname === href || pathname.startsWith(href + "/");
}

export function useAddMenu() {
  const openDialog = useUI((s) => s.openDialog);
  const pathname = usePathname();
  const projectId = pathname.startsWith("/projects/") ? pathname.split("/")[2] : null;
  return [
    { label: "Importer des fichiers", icon: Upload, shortcut: "U", onSelect: () => pickAndImport(projectId) },
    { type: "separator" as const },
    {
      label: "Créer un dossier",
      icon: FolderPlus,
      onSelect: () => openDialog({ type: "project", mode: "create", kind: "folder", parentId: projectId }),
    },
    {
      label: "Créer un projet",
      icon: Disc3,
      onSelect: () => openDialog({ type: "project", mode: "create", kind: "project", parentId: projectId }),
    },
  ];
}

export function Sidebar() {
  const pathname = usePathname();
  const addMenu = useAddMenu();
  const setPalette = useUI((s) => s.setPalette);

  return (
    <aside className="border-line bg-panel hidden w-60 shrink-0 flex-col border-r md:flex">
      <div className="flex h-14 items-center justify-between px-4">
        <Link href="/" className="flex items-center gap-2 text-[15px] font-semibold tracking-[0.18em]">
          <Logo />
          CREATE
        </Link>
      </div>

      <div className="flex gap-2 px-3 pb-3">
        <DropdownMenu
          align="start"
          entries={addMenu}
          trigger={
            <button className="bg-accent text-accent-fg flex h-8 flex-1 items-center justify-center gap-1.5 rounded-lg text-[13px] font-medium transition hover:brightness-110">
              <Plus className="size-4" /> Ajouter
            </button>
          }
        />
        <button
          onClick={() => setPalette(true)}
          className="border-line text-muted hover:bg-hover hover:text-fg grid h-8 w-8 place-items-center rounded-lg border"
          aria-label="Rechercher"
          title="Rechercher (Ctrl K)"
        >
          <Search className="size-4" />
        </button>
      </div>

      <nav className="flex flex-col gap-px px-2">
        {NAV.map((item) => (
          <NavLink key={item.href} {...item} active={isActive(pathname, item.href)} />
        ))}
      </nav>

      <ProjectTree />

      <div className="border-line mt-auto border-t p-2">
        <NavLink href="/settings" label="Réglages" icon={Settings} active={isActive(pathname, "/settings")} />
        <button
          onClick={() => setPalette(true)}
          className="text-faint hover:text-muted mt-1 flex w-full items-center justify-between rounded-md px-2.5 py-1.5 text-xs"
        >
          Recherche rapide
          <span className="flex gap-0.5">
            <Kbd>Ctrl</Kbd>
            <Kbd>K</Kbd>
          </span>
        </button>
      </div>
    </aside>
  );
}

function NavLink({
  href,
  label,
  icon: Icon,
  active,
}: {
  href: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  active: boolean;
}) {
  return (
    <Link
      href={href}
      className={cn(
        "flex h-8 items-center gap-2.5 rounded-md px-2.5 text-[13px] transition-colors",
        active ? "bg-hover text-fg" : "text-muted hover:bg-hover/60 hover:text-fg",
      )}
    >
      <Icon className={cn("size-4", active && "text-accent")} />
      {label}
    </Link>
  );
}

export function Logo({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 20 20" className={cn("text-accent size-5", className)} fill="currentColor" aria-hidden>
      <rect x="2" y="8" width="3" height="5" rx="1.5" />
      <rect x="6.5" y="5" width="3" height="11" rx="1.5" />
      <rect x="11" y="2.5" width="3" height="15" rx="1.5" />
      <rect x="15.5" y="6.5" width="3" height="7" rx="1.5" />
    </svg>
  );
}

// ---------------------------------------------------------------------------
// Project tree with drag & drop
// ---------------------------------------------------------------------------

const EXPANDED_KEY = "crate.tree.expanded";

const EXPANDED_EVENT = "crate:tree-expanded";

function readExpanded(): string {
  try {
    return localStorage.getItem(EXPANDED_KEY) || "[]";
  } catch {
    return "[]";
  }
}

function subscribeExpanded(cb: () => void) {
  window.addEventListener(EXPANDED_EVENT, cb);
  window.addEventListener("storage", cb);
  return () => {
    window.removeEventListener(EXPANDED_EVENT, cb);
    window.removeEventListener("storage", cb);
  };
}

function ProjectTree() {
  const { data: projects = [] } = useProjects();
  // Server snapshot is "nothing expanded" so the prerendered shell hydrates cleanly.
  const raw = useSyncExternalStore(subscribeExpanded, readExpanded, () => "[]");
  const expanded = useMemo(() => new Set<string>(JSON.parse(raw) as string[]), [raw]);
  const [rootOver, setRootOver] = useState(false);
  const children = useMemo(() => {
    const map = new Map<string | null, Project[]>();
    for (const p of projects) {
      const k = p.parent_id && projects.some((x) => x.id === p.parent_id) ? p.parent_id : null;
      map.set(k, [...(map.get(k) ?? []), p]);
    }
    for (const list of map.values()) list.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
    return map;
  }, [projects]);

  const toggle = (id: string) => {
    const next = new Set(expanded);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    try {
      localStorage.setItem(EXPANDED_KEY, JSON.stringify([...next]));
    } catch {
      /* ignore */
    }
    window.dispatchEvent(new Event(EXPANDED_EVENT));
  };

  const roots = children.get(null) ?? [];

  return (
    <div className="mt-5 flex min-h-0 flex-1 flex-col">
      <div
        className={cn(
          "text-faint mx-2 flex items-center justify-between rounded-md px-2.5 py-1 text-[11px] font-medium tracking-wider uppercase",
          rootOver && "bg-accent/10 text-accent",
        )}
        onDragOver={(e) => {
          if (hasType(e, DND_PROJECT)) {
            e.preventDefault();
            setRootOver(true);
          }
        }}
        onDragLeave={() => setRootOver(false)}
        onDrop={(e) => {
          setRootOver(false);
          const id = e.dataTransfer.getData(DND_PROJECT);
          if (id) void updateProject(id, { parent_id: null }).catch((err) => toast.error(errorMessage(err)));
        }}
      >
        Projets
        <ProjectAddButton />
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-2">
        {roots.length === 0 ? (
          <p className="text-faint px-2.5 py-1.5 text-xs">Aucun projet</p>
        ) : (
          roots.map((p) => (
            <TreeNode key={p.id} project={p} depth={0} childrenMap={children} expanded={expanded} toggle={toggle} />
          ))
        )}
      </div>
    </div>
  );
}

function ProjectAddButton() {
  const openDialog = useUI((s) => s.openDialog);
  return (
    <button
      onClick={() => openDialog({ type: "project", mode: "create", kind: "project" })}
      className="text-faint hover:bg-hover hover:text-fg rounded p-0.5"
      aria-label="Nouveau projet"
    >
      <Plus className="size-3.5" />
    </button>
  );
}

function TreeNode({
  project,
  depth,
  childrenMap,
  expanded,
  toggle,
}: {
  project: Project;
  depth: number;
  childrenMap: Map<string | null, Project[]>;
  expanded: Set<string>;
  toggle: (id: string) => void;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const [over, setOver] = useState(false);
  const kids = childrenMap.get(project.id) ?? [];
  const open = expanded.has(project.id);
  const active = pathname === `/projects/${project.id}`;
  const Icon = project.kind === "folder" ? Folder : Disc3;

  const onDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    setOver(false);
    try {
      const ids = readTrackDrag(e);
      if (ids?.length) {
        await moveTracks(ids, project.id);
        toast.success(`${ids.length > 1 ? `${ids.length} morceaux déplacés` : "Morceau déplacé"} dans ${project.name}`);
        return;
      }
      const pid = e.dataTransfer.getData(DND_PROJECT);
      if (pid && pid !== project.id) {
        await updateProject(pid, { parent_id: project.id });
        if (!open) toggle(project.id);
        return;
      }
      if (e.dataTransfer.files.length) {
        await importFiles(Array.from(e.dataTransfer.files), { projectId: project.id });
        router.push(`/projects/${project.id}`);
      }
    } catch (err) {
      toast.error(errorMessage(err));
    }
  };

  return (
    <div>
      <div
        draggable
        onDragStart={(e) => {
          e.dataTransfer.setData(DND_PROJECT, project.id);
          e.dataTransfer.effectAllowed = "move";
        }}
        onDragOver={(e) => {
          if (hasType(e, DND_TRACKS) || hasType(e, DND_PROJECT) || hasType(e, "Files")) {
            e.preventDefault();
            e.stopPropagation();
            setOver(true);
          }
        }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => {
          e.stopPropagation();
          void onDrop(e);
        }}
        className={cn(
          "group flex h-7 items-center rounded-md pr-2 text-[13px] transition-colors",
          active ? "bg-hover text-fg" : "text-muted hover:bg-hover/60 hover:text-fg",
          over && "bg-accent/15 text-fg ring-accent/50 ring-1",
        )}
        style={{ paddingLeft: 4 + depth * 12 }}
      >
        <button
          onClick={() => toggle(project.id)}
          className={cn("text-faint hover:text-fg grid size-5 place-items-center rounded", !kids.length && "invisible")}
          aria-label={open ? "Replier" : "Déplier"}
        >
          <ChevronRight className={cn("size-3.5 transition-transform", open && "rotate-90")} />
        </button>
        <Link href={`/projects/${project.id}`} className="flex min-w-0 flex-1 items-center gap-2 py-1">
          {project.cover_path ? (
            <Cover path={project.cover_path} seed={project.id} className="size-4" rounded="rounded-[3px]" />
          ) : (
            <Icon className={cn("size-3.5 shrink-0", active ? "text-accent" : "text-faint")} />
          )}
          <span className="truncate">{project.name}</span>
        </Link>
      </div>
      {open && kids.length ? (
        <div>
          {kids.map((k) => (
            <TreeNode
              key={k.id}
              project={k}
              depth={depth + 1}
              childrenMap={childrenMap}
              expanded={expanded}
              toggle={toggle}
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}
