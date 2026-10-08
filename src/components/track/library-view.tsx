"use client";

import * as Popover from "@radix-ui/react-popover";
import { Check, Heart, Play, Search, Shuffle, SlidersHorizontal, Upload, X } from "lucide-react";
import { useDeferredValue, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";
import { EmptyState, TagPill } from "@/components/ui/misc";
import { Skeleton } from "@/components/ui/spinner";
import { useProjects, useTags } from "@/lib/data/library";
import { useTracks } from "@/lib/data/tracks";
import { ALL_KEYS, camelot, keyLabel, shortKey } from "@/lib/music";
import { usePlayer } from "@/lib/player/store";
import { activeFilterCount, applyFilters, buildIndex, searchTracks, type Filters } from "@/lib/search";
import type { Project, Track } from "@/lib/types";
import { pickAndImport } from "@/lib/upload/pick";
import { cn } from "@/lib/utils";
import { flattenProjects } from "./fields";
import { sortTracks, TrackList, type Sort } from "./track-list";

type Props = {
  /** Fixed filters for this view (e.g. favorites only, a project) */
  preset?: Filters;
  /** Pre-filter before search (e.g. only last 30 days) */
  scope?: (t: Track) => boolean;
  defaultSort?: Sort;
  showProject?: boolean;
  emptyState?: React.ReactNode;
  uploadProjectId?: string | null;
  header?: React.ReactNode;
  hideFilters?: (keyof Filters)[];
};

export function LibraryView({
  preset,
  scope,
  defaultSort = { key: "created_at", dir: "desc" },
  showProject = true,
  emptyState,
  uploadProjectId = null,
  header,
  hideFilters = [],
}: Props) {
  const { data: tracks, isLoading, error } = useTracks();
  const { data: projects = [] } = useProjects();
  const { data: tags = [] } = useTags();
  const [query, setQuery] = useState("");
  const deferredQuery = useDeferredValue(query);
  const [filters, setFilters] = useState<Filters>({});
  const [sort, setSort] = useState<Sort | null>(defaultSort);

  const scoped = useMemo(() => {
    let list = tracks ?? [];
    if (scope) list = list.filter(scope);
    if (preset) list = applyFilters(list, preset);
    return list;
  }, [tracks, scope, preset]);

  const index = useMemo(() => buildIndex(scoped, projects, tags), [scoped, projects, tags]);

  const visible = useMemo(() => {
    const filtered = applyFilters(scoped, filters);
    if (deferredQuery.trim()) {
      const allowed = new Set(filtered.map((t) => t.id));
      // Relevance order while searching, unless the user picked a column sort.
      const hits = searchTracks(index, deferredQuery).filter((t) => allowed.has(t.id));
      return sort && sort !== defaultSort ? sortTracks(hits, sort) : hits;
    }
    return sortTracks(filtered, sort);
  }, [scoped, filters, deferredQuery, index, sort, defaultSort]);

  const genres = useMemo(
    () => [...new Set(scoped.map((t) => t.genre).filter((g): g is string => !!g))].sort(),
    [scoped],
  );
  const filterCount = activeFilterCount(filters);
  const totalDuration = visible.reduce((s, t) => s + (t.duration ?? 0), 0);

  if (error) {
    return <p className="text-danger px-8 py-10 text-sm">Impossible de charger la bibliothèque : {error.message}</p>;
  }

  return (
    <div className="pb-10">
      {header}
      <div className="bg-bg/95 sticky top-0 z-20 flex flex-wrap items-center gap-2 px-4 py-3 backdrop-blur md:px-8">
        <div className="relative min-w-48 flex-1 md:max-w-80">
          <Search className="text-faint absolute top-2.5 left-3 size-4" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Filtrer… titre, tag, 140, F#m"
            className="pl-9"
            onKeyDown={(e) => {
              if (e.key === "Escape") {
                setQuery("");
                e.currentTarget.blur();
              }
            }}
          />
          {query ? (
            <button
              onClick={() => setQuery("")}
              className="text-faint hover:text-fg absolute top-2.5 right-2.5"
              aria-label="Effacer"
            >
              <X className="size-4" />
            </button>
          ) : null}
        </div>
        <FilterPopover
          filters={filters}
          setFilters={setFilters}
          genres={genres}
          tags={tags}
          projects={projects}
          count={filterCount}
          hide={hideFilters}
        />
        {!hideFilters.includes("favorites") ? (
          <Button
            variant={filters.favorites ? "secondary" : "ghost"}
            size="md"
            onClick={() => setFilters((f) => ({ ...f, favorites: !f.favorites }))}
            className={cn(filters.favorites && "text-accent")}
          >
            <Heart fill={filters.favorites ? "currentColor" : "none"} /> <span className="max-sm:hidden">Favoris</span>
          </Button>
        ) : null}
        <div className="ml-auto flex items-center gap-2">
          <span className="text-faint hidden text-xs lg:inline">
            {visible.length} morceau{visible.length === 1 ? "" : "x"}
            {totalDuration ? ` · ${Math.round(totalDuration / 60)} min` : ""}
          </span>
          <Button
            variant="ghost"
            size="icon"
            disabled={!visible.length}
            onClick={() => {
              const shuffled = visible.slice().sort(() => Math.random() - 0.5);
              void usePlayer.getState().playTracks(shuffled, 0);
            }}
            title="Lecture aléatoire"
            aria-label="Lecture aléatoire"
          >
            <Shuffle />
          </Button>
          <Button
            variant="secondary"
            disabled={!visible.length}
            onClick={() => void usePlayer.getState().playTracks(visible, 0)}
          >
            <Play fill="currentColor" /> Lire
          </Button>
          <Button variant="primary" onClick={() => pickAndImport(uploadProjectId)} className="max-sm:hidden">
            <Upload /> Importer
          </Button>
        </div>
        {filterCount ? (
          <ActiveFilters filters={filters} setFilters={setFilters} tags={tags} projects={projects} />
        ) : null}
      </div>

      {isLoading ? (
        <div className="space-y-2 px-4 pt-2 md:px-8">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="flex h-14 items-center gap-3">
              <Skeleton className="size-10" />
              <div className="flex-1 space-y-1.5">
                <Skeleton className="h-3 w-1/3" />
                <Skeleton className="h-2.5 w-1/5" />
              </div>
            </div>
          ))}
        </div>
      ) : (
        <TrackList
          tracks={visible}
          sort={sort}
          onSortChange={setSort}
          showProject={showProject}
          emptyState={
            scoped.length && (query || filterCount) ? (
              <EmptyState
                icon={Search}
                title="Aucun résultat"
                action={
                  <Button
                    onClick={() => {
                      setQuery("");
                      setFilters({});
                    }}
                  >
                    Effacer les filtres
                  </Button>
                }
              >
                Rien ne correspond à ces filtres.
              </EmptyState>
            ) : (
              (emptyState ?? (
                <EmptyState
                  icon={Upload}
                  title="Ta bibliothèque est vide"
                  action={
                    <Button variant="primary" onClick={() => pickAndImport(uploadProjectId)}>
                      <Upload /> Importer des beats
                    </Button>
                  }
                >
                  Dépose des fichiers WAV, MP3, AIFF ou M4A n’importe où dans la fenêtre.
                </EmptyState>
              ))
            )
          }
        />
      )}
    </div>
  );
}

function FilterPopover({
  filters,
  setFilters,
  genres,
  tags,
  projects,
  count,
  hide,
}: {
  filters: Filters;
  setFilters: React.Dispatch<React.SetStateAction<Filters>>;
  genres: string[];
  tags: { id: string; name: string; color: string | null }[];
  projects: Project[];
  count: number;
  hide: (keyof Filters)[];
}) {
  const toggleIn = (k: "keys" | "genres" | "tagIds", v: string) =>
    setFilters((f) => {
      const list = f[k] ?? [];
      return { ...f, [k]: list.includes(v) ? list.filter((x) => x !== v) : [...list, v] };
    });

  return (
    <Popover.Root>
      <Popover.Trigger asChild>
        <Button variant={count ? "secondary" : "ghost"} className={cn(count && "text-accent")}>
          <SlidersHorizontal /> <span className="max-sm:hidden">Filtres</span>
          {count ? <span className="bg-accent text-accent-fg rounded px-1 font-mono text-[10px]">{count}</span> : null}
        </Button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          align="start"
          sideOffset={6}
          className="border-line-strong bg-raised data-[state=open]:animate-pop z-50 max-h-[70vh] w-[min(92vw,420px)] overflow-y-auto rounded-xl border p-4 shadow-2xl"
        >
          <div className="space-y-4">
            <div>
              <Label>BPM</Label>
              <div className="flex items-center gap-2">
                <Input
                  inputMode="numeric"
                  placeholder="Min"
                  value={filters.bpmMin ?? ""}
                  onChange={(e) =>
                    setFilters((f) => ({ ...f, bpmMin: e.target.value ? Number(e.target.value) : null }))
                  }
                  className="font-mono"
                />
                <span className="text-faint">–</span>
                <Input
                  inputMode="numeric"
                  placeholder="Max"
                  value={filters.bpmMax ?? ""}
                  onChange={(e) =>
                    setFilters((f) => ({ ...f, bpmMax: e.target.value ? Number(e.target.value) : null }))
                  }
                  className="font-mono"
                />
              </div>
              <div className="mt-1.5 flex flex-wrap gap-1">
                {[
                  [70, 90],
                  [90, 110],
                  [130, 150],
                  [140, 145],
                  [150, 170],
                ].map(([a, b]) => (
                  <button
                    key={`${a}-${b}`}
                    onClick={() => setFilters((f) => ({ ...f, bpmMin: a, bpmMax: b }))}
                    className="bg-hover text-muted hover:text-fg rounded-md px-2 py-0.5 font-mono text-[11px]"
                  >
                    {a}–{b}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <Label>Tonalité</Label>
              <div className="grid grid-cols-6 gap-1">
                {ALL_KEYS.map((k) => {
                  const on = filters.keys?.includes(k);
                  return (
                    <button
                      key={k}
                      onClick={() => toggleIn("keys", k)}
                      title={`${keyLabel(k)} · ${camelot(k)}`}
                      className={cn(
                        "rounded-md py-1 text-[11px]",
                        on ? "bg-accent text-accent-fg" : "bg-hover text-muted hover:text-fg",
                      )}
                    >
                      {shortKey(k)}
                    </button>
                  );
                })}
              </div>
            </div>

            {genres.length ? (
              <div>
                <Label>Genre</Label>
                <div className="flex flex-wrap gap-1">
                  {genres.map((g) => (
                    <Chip key={g} on={!!filters.genres?.includes(g)} onClick={() => toggleIn("genres", g)}>
                      {g}
                    </Chip>
                  ))}
                </div>
              </div>
            ) : null}

            {tags.length ? (
              <div>
                <Label>Tags</Label>
                <div className="flex flex-wrap gap-1">
                  {tags.map((t) => (
                    <Chip key={t.id} on={!!filters.tagIds?.includes(t.id)} onClick={() => toggleIn("tagIds", t.id)}>
                      <span className="size-1.5 rounded-full" style={{ background: t.color ?? "var(--muted)" }} />
                      {t.name}
                    </Chip>
                  ))}
                </div>
              </div>
            ) : null}

            {!hide.includes("projectId") ? (
              <div>
                <Label>Projet</Label>
                <select
                  value={filters.projectId ?? ""}
                  onChange={(e) => setFilters((f) => ({ ...f, projectId: e.target.value || null }))}
                  className="border-line bg-panel h-9 w-full rounded-lg border px-3 text-[13px] outline-none"
                >
                  <option value="">Tous</option>
                  <option value="none">Sans projet</option>
                  {flattenProjects(projects).map(({ project, depth }) => (
                    <option key={project.id} value={project.id}>
                      {"  ".repeat(depth)}
                      {project.name}
                    </option>
                  ))}
                </select>
              </div>
            ) : null}

            <div>
              <Label>Ajouté</Label>
              <div className="flex items-center gap-2">
                <Input
                  type="date"
                  value={filters.dateFrom ?? ""}
                  onChange={(e) => setFilters((f) => ({ ...f, dateFrom: e.target.value || null }))}
                />
                <span className="text-faint">–</span>
                <Input
                  type="date"
                  value={filters.dateTo ?? ""}
                  onChange={(e) => setFilters((f) => ({ ...f, dateTo: e.target.value || null }))}
                />
              </div>
            </div>

            {count ? (
              <Button variant="ghost" className="w-full justify-center" onClick={() => setFilters({})}>
                Effacer tous les filtres
              </Button>
            ) : null}
          </div>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

function Chip({ on, onClick, children }: { on: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs",
        on ? "border-accent bg-accent/15 text-fg" : "border-line-strong text-muted hover:text-fg",
      )}
    >
      {on ? <Check className="text-accent size-3" /> : null}
      {children}
    </button>
  );
}

function ActiveFilters({
  filters,
  setFilters,
  tags,
  projects,
}: {
  filters: Filters;
  setFilters: React.Dispatch<React.SetStateAction<Filters>>;
  tags: { id: string; name: string; color: string | null }[];
  projects: { id: string; name: string }[];
}) {
  const pills: { label: React.ReactNode; clear: () => void; key: string }[] = [];
  if (filters.bpmMin != null || filters.bpmMax != null)
    pills.push({
      key: "bpm",
      label: `${filters.bpmMin ?? "…"}–${filters.bpmMax ?? "…"} BPM`,
      clear: () => setFilters((f) => ({ ...f, bpmMin: null, bpmMax: null })),
    });
  filters.keys?.forEach((k) =>
    pills.push({
      key: k,
      label: shortKey(k),
      clear: () => setFilters((f) => ({ ...f, keys: f.keys?.filter((x) => x !== k) })),
    }),
  );
  filters.genres?.forEach((g) =>
    pills.push({
      key: `g${g}`,
      label: g,
      clear: () => setFilters((f) => ({ ...f, genres: f.genres?.filter((x) => x !== g) })),
    }),
  );
  filters.tagIds?.forEach((id) => {
    const t = tags.find((x) => x.id === id);
    if (t)
      pills.push({
        key: id,
        label: <TagPill tag={t} className="border-0 px-0" />,
        clear: () => setFilters((f) => ({ ...f, tagIds: f.tagIds?.filter((x) => x !== id) })),
      });
  });
  if (filters.projectId)
    pills.push({
      key: "p",
      label:
        filters.projectId === "none"
          ? "Sans projet"
          : (projects.find((p) => p.id === filters.projectId)?.name ?? "Projet"),
      clear: () => setFilters((f) => ({ ...f, projectId: null })),
    });
  if (filters.dateFrom || filters.dateTo)
    pills.push({
      key: "d",
      label: `${filters.dateFrom ?? "…"} → ${filters.dateTo ?? "…"}`,
      clear: () => setFilters((f) => ({ ...f, dateFrom: null, dateTo: null })),
    });

  return (
    <div className="flex w-full flex-wrap gap-1.5">
      {pills.map((p) => (
        <span
          key={p.key}
          className="bg-hover text-muted inline-flex h-6 items-center gap-1 rounded-full pr-1 pl-2.5 text-xs"
        >
          {p.label}
          <button onClick={p.clear} className="hover:text-fg rounded-full p-0.5" aria-label="Retirer le filtre">
            <X className="size-3" />
          </button>
        </span>
      ))}
    </div>
  );
}
