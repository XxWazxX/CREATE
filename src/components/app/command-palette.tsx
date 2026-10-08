"use client";

import * as D from "@radix-ui/react-dialog";
import { Command } from "cmdk";
import { CornerDownLeft, Disc3, Folder, Play, Search, Upload, FolderPlus } from "lucide-react";
import { useRouter } from "next/navigation";
import { useDeferredValue, useMemo, useState } from "react";
import { Cover } from "@/components/ui/cover";
import { Kbd } from "@/components/ui/input";
import { useProjects, useTags } from "@/lib/data/library";
import { useTracks } from "@/lib/data/tracks";
import { shortKey } from "@/lib/music";
import { usePlayer } from "@/lib/player/store";
import { buildIndex, searchTracks } from "@/lib/search";
import { useUI } from "@/lib/ui-store";
import { pickAndImport } from "@/lib/upload/pick";
import { formatBpm, formatDuration } from "@/lib/utils";
import { NAV } from "./sidebar";

export function CommandPalette() {
  const open = useUI((s) => s.paletteOpen);
  const setOpen = useUI((s) => s.setPalette);
  const openDialog = useUI((s) => s.openDialog);
  const router = useRouter();
  const [query, setQuery] = useState("");
  const deferred = useDeferredValue(query);
  const { data: tracks = [] } = useTracks();
  const { data: projects = [] } = useProjects();
  const { data: tags = [] } = useTags();

  const index = useMemo(() => buildIndex(tracks, projects, tags), [tracks, projects, tags]);
  const results = useMemo(() => {
    if (!deferred.trim()) {
      return tracks
        .filter((t) => t.last_played_at)
        .sort((a, b) => (b.last_played_at ?? "").localeCompare(a.last_played_at ?? ""))
        .slice(0, 6);
    }
    return searchTracks(index, deferred, 40);
  }, [index, deferred, tracks]);

  const projectResults = useMemo(() => {
    const q = deferred.trim().toLowerCase();
    if (!q) return [];
    return projects.filter((p) => p.name.toLowerCase().includes(q)).slice(0, 6);
  }, [projects, deferred]);

  const close = () => {
    setOpen(false);
    setQuery("");
  };
  const go = (href: string) => {
    close();
    router.push(href);
  };

  const itemCls =
    "flex h-11 cursor-default items-center gap-3 rounded-lg px-3 text-[13px] data-[selected=true]:bg-hover [&_svg]:size-4 [&_svg]:text-muted";

  return (
    <D.Root open={open} onOpenChange={(o) => (o ? setOpen(true) : close())}>
      <D.Portal>
        <D.Overlay className="data-[state=open]:animate-in fixed inset-0 z-50 bg-black/60 backdrop-blur-[2px]" />
        <D.Content className="border-line-strong bg-panel data-[state=open]:animate-pop fixed top-[10vh] left-1/2 z-50 w-[calc(100vw-24px)] max-w-xl -translate-x-1/2 overflow-hidden rounded-2xl border shadow-2xl">
          <D.Title className="sr-only">Recherche</D.Title>
          <D.Description className="sr-only">Rechercher des morceaux, projets et actions</D.Description>
          <Command shouldFilter={false} loop>
            <div className="border-line flex items-center gap-3 border-b px-4">
              <Search className="text-faint size-4" />
              <Command.Input
                value={query}
                onValueChange={setQuery}
                placeholder="Titre, artiste, tag, 140, F#m, notes…"
                className="placeholder:text-faint h-13 flex-1 bg-transparent text-[15px] outline-none"
              />
              <Kbd>Esc</Kbd>
            </div>
            <Command.List className="max-h-[60vh] overflow-y-auto p-2">
              <Command.Empty className="text-muted py-10 text-center text-[13px]">
                Aucun résultat pour « {query} »
              </Command.Empty>

              {results.length ? (
                <Command.Group
                  heading={deferred.trim() ? `Morceaux · ${results.length}` : "Écoutés récemment"}
                  className="[&_[cmdk-group-heading]]:text-faint [&_[cmdk-group-heading]]:px-3 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:text-[11px] [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group-heading]]:tracking-wider [&_[cmdk-group-heading]]:uppercase"
                >
                  {results.map((t) => (
                    <Command.Item
                      key={t.id}
                      value={`track-${t.id}`}
                      onSelect={() => go(`/tracks/${t.id}`)}
                      className={itemCls}
                    >
                      <Cover path={t.cover_path} seed={t.id} className="size-8" rounded="rounded" />
                      <div className="min-w-0 flex-1">
                        <p className="truncate font-medium">{t.title}</p>
                        <p className="text-muted truncate text-xs">
                          {[
                            t.artist,
                            t.bpm ? `${formatBpm(t.bpm)} BPM` : null,
                            shortKey(t.key) || null,
                            formatDuration(t.duration),
                          ]
                            .filter(Boolean)
                            .join(" · ")}
                        </p>
                      </div>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          void usePlayer.getState().playTracks(results, results.indexOf(t));
                          close();
                        }}
                        className="hover:bg-active rounded-md p-1.5"
                        aria-label="Lire"
                        tabIndex={-1}
                      >
                        <Play className="!text-fg" fill="currentColor" />
                      </button>
                    </Command.Item>
                  ))}
                </Command.Group>
              ) : null}

              {projectResults.length ? (
                <Command.Group
                  heading="Projets"
                  className="[&_[cmdk-group-heading]]:text-faint [&_[cmdk-group-heading]]:px-3 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:text-[11px] [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group-heading]]:tracking-wider [&_[cmdk-group-heading]]:uppercase"
                >
                  {projectResults.map((p) => (
                    <Command.Item
                      key={p.id}
                      value={`project-${p.id}`}
                      onSelect={() => go(`/projects/${p.id}`)}
                      className={itemCls}
                    >
                      {p.kind === "folder" ? <Folder /> : <Disc3 />}
                      <span className="flex-1 truncate">{p.name}</span>
                    </Command.Item>
                  ))}
                </Command.Group>
              ) : null}

              {!deferred.trim() ? (
                <Command.Group
                  heading="Aller à"
                  className="[&_[cmdk-group-heading]]:text-faint [&_[cmdk-group-heading]]:px-3 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:text-[11px] [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group-heading]]:tracking-wider [&_[cmdk-group-heading]]:uppercase"
                >
                  <Command.Item
                    value="upload"
                    onSelect={() => {
                      close();
                      pickAndImport(null);
                    }}
                    className={itemCls}
                  >
                    <Upload /> Importer des fichiers
                  </Command.Item>
                  <Command.Item
                    value="new-project"
                    onSelect={() => {
                      close();
                      openDialog({ type: "project", mode: "create", kind: "project" });
                    }}
                    className={itemCls}
                  >
                    <FolderPlus /> Nouveau projet
                  </Command.Item>
                  {NAV.map((n) => (
                    <Command.Item key={n.href} value={`nav-${n.href}`} onSelect={() => go(n.href)} className={itemCls}>
                      <n.icon /> {n.label}
                    </Command.Item>
                  ))}
                </Command.Group>
              ) : null}
            </Command.List>
            <div className="border-line text-faint flex items-center gap-4 border-t px-4 py-2 text-[11px]">
              <span className="flex items-center gap-1">
                <CornerDownLeft className="size-3" /> ouvrir
              </span>
              <span>↑↓ naviguer</span>
              <span className="ml-auto">{tracks.length} morceaux indexés</span>
            </div>
          </Command>
        </D.Content>
      </D.Portal>
    </D.Root>
  );
}
