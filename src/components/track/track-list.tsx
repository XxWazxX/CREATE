"use client";

import { useVirtualizer } from "@tanstack/react-virtual";
import { ArrowDown, ArrowUp, Heart, MoreHorizontal, Pause, Play } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { Cover } from "@/components/ui/cover";
import { ContextMenu, DropdownMenu } from "@/components/ui/menu";
import { PlayingBars, TagPill } from "@/components/ui/misc";
import { Spinner } from "@/components/ui/spinner";
import { useProjects, useTags } from "@/lib/data/library";
import { toggleFavorite } from "@/lib/data/tracks";
import { setTrackDrag } from "@/lib/dnd";
import { shortKey } from "@/lib/music";
import { usePlayer } from "@/lib/player/store";
import { trackMenu, trashWithUndo } from "@/lib/track-actions";
import type { Project, Tag, Track } from "@/lib/types";
import { useUI } from "@/lib/ui-store";
import { useUploads } from "@/lib/upload/uploads";
import { cn, errorMessage, formatBpm, formatDuration, isTypingTarget, shortDate } from "@/lib/utils";

export type SortKey = "title" | "bpm" | "key" | "created_at" | "duration" | "last_played_at";
export type Sort = { key: SortKey; dir: "asc" | "desc" };

export function sortTracks(tracks: Track[], sort: Sort | null): Track[] {
  if (!sort) return tracks;
  const dir = sort.dir === "asc" ? 1 : -1;
  const val = (t: Track): string | number => {
    switch (sort.key) {
      case "title":
        return t.title.toLowerCase();
      case "bpm":
        return t.bpm ?? -1;
      case "key":
        return t.key ?? "";
      case "duration":
        return t.duration ?? -1;
      case "last_played_at":
        return t.last_played_at ?? "";
      default:
        return t.created_at;
    }
  };
  return tracks.slice().sort((a, b) => {
    const x = val(a);
    const y = val(b);
    return x < y ? -dir : x > y ? dir : 0;
  });
}

type Props = {
  tracks: Track[];
  sort?: Sort | null;
  onSortChange?: (s: Sort) => void;
  showProject?: boolean;
  /** Render without virtualization (short lists, e.g. dashboard) */
  plain?: boolean;
  emptyState?: React.ReactNode;
};

export function TrackList({ tracks, sort = null, onSortChange, showProject = true, plain, emptyState }: Props) {
  const router = useRouter();
  const { data: projects = [] } = useProjects();
  const { data: tags = [] } = useTags();
  const [selection, setSelection] = useState<string[]>([]);
  const anchor = useRef<string | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const [scrollEl, setScrollEl] = useState<HTMLElement | null>(null);
  const [margin, setMargin] = useState(0);
  const setFocusTrack = useUI((s) => s.setFocusTrack);

  const projectById = useMemo(() => new Map(projects.map((p) => [p.id, p])), [projects]);
  const tagById = useMemo(() => new Map(tags.map((t) => [t.id, t])), [tags]);

  useEffect(() => {
    setScrollEl(document.getElementById("app-scroll"));
  }, []);

  useEffect(() => {
    if (!scrollEl || !listRef.current) return;
    const update = () => {
      const top =
        listRef.current!.getBoundingClientRect().top - scrollEl.getBoundingClientRect().top + scrollEl.scrollTop;
      setMargin(top);
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(scrollEl);
    return () => ro.disconnect();
  }, [scrollEl, tracks.length]);

  // Drop stale selections when the list changes.
  useEffect(() => {
    setSelection((sel) => sel.filter((id) => tracks.some((t) => t.id === id)));
  }, [tracks]);

  // Delete / Escape on selection
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isTypingTarget(e.target) || !selection.length) return;
      if (e.key === "Delete" || (e.key === "Backspace" && (e.metaKey || e.ctrlKey))) {
        e.preventDefault();
        void trashWithUndo(selection);
        setSelection([]);
      } else if (e.key === "Escape") {
        setSelection([]);
      } else if (e.key === "a" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        setSelection(tracks.map((t) => t.id));
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selection, tracks]);

  const rowH = 56;
  const virtualizer = useVirtualizer({
    count: tracks.length,
    getScrollElement: () => scrollEl,
    estimateSize: () => rowH,
    overscan: 12,
    scrollMargin: margin,
    enabled: !plain && !!scrollEl,
  });

  const onRowClick = useCallback(
    (e: React.MouseEvent, track: Track, index: number) => {
      if (e.metaKey || e.ctrlKey) {
        setSelection((s) => (s.includes(track.id) ? s.filter((x) => x !== track.id) : [...s, track.id]));
        anchor.current = track.id;
        return;
      }
      if (e.shiftKey && anchor.current) {
        const a = tracks.findIndex((t) => t.id === anchor.current);
        const [from, to] = a < index ? [a, index] : [index, a];
        setSelection(tracks.slice(from, to + 1).map((t) => t.id));
        return;
      }
      anchor.current = track.id;
      setSelection([]);
      setFocusTrack(track.id);
      router.push(`/tracks/${track.id}`);
    },
    [tracks, router, setFocusTrack],
  );

  const play = useCallback(
    (track: Track) => {
      const s = usePlayer.getState();
      if (s.current?.trackId === track.id && !s.current.versionLabel) s.toggle();
      else void s.playTracks(tracks, tracks.indexOf(track));
    },
    [tracks],
  );

  if (!tracks.length) return <>{emptyState ?? null}</>;

  const header = (
    <div className="border-line text-faint hidden h-9 items-center gap-4 border-b px-4 text-[11px] font-medium tracking-wider uppercase md:flex md:px-8">
      <span className="w-8 text-center">#</span>
      <SortHeader label="Titre" k="title" sort={sort} onSort={onSortChange} className="flex-1" />
      <SortHeader label="BPM" k="bpm" sort={sort} onSort={onSortChange} className="w-14" />
      <SortHeader label="Tonalité" k="key" sort={sort} onSort={onSortChange} className="w-14" />
      <span className="hidden w-44 lg:block">Tags</span>
      {showProject ? <span className="hidden w-32 xl:block">Projet</span> : null}
      <SortHeader label="Ajouté" k="created_at" sort={sort} onSort={onSortChange} className="hidden w-20 lg:flex" />
      <SortHeader label="Durée" k="duration" sort={sort} onSort={onSortChange} className="w-12 justify-end" />
      <span className="w-16" />
    </div>
  );

  const renderRow = (track: Track, index: number) => (
    <TrackRow
      track={track}
      index={index}
      selected={selection.includes(track.id)}
      selection={selection}
      project={track.project_id ? projectById.get(track.project_id) : undefined}
      tagById={tagById}
      showProject={showProject}
      projects={projects}
      queue={tracks}
      onClick={onRowClick}
      onPlay={play}
      router={router}
    />
  );

  if (plain) {
    return (
      <div ref={listRef}>
        {header}
        {tracks.map((t, i) => (
          <div key={t.id}>{renderRow(t, i)}</div>
        ))}
      </div>
    );
  }

  const items = virtualizer.getVirtualItems();
  return (
    <div ref={listRef}>
      {header}
      <div style={{ height: virtualizer.getTotalSize(), position: "relative" }}>
        {items.map((v) => (
          <div
            key={tracks[v.index].id}
            style={{ position: "absolute", top: 0, left: 0, right: 0, transform: `translateY(${v.start - margin}px)` }}
          >
            {renderRow(tracks[v.index], v.index)}
          </div>
        ))}
      </div>
    </div>
  );
}

function SortHeader({
  label,
  k,
  sort,
  onSort,
  className,
}: {
  label: string;
  k: SortKey;
  sort: Sort | null;
  onSort?: (s: Sort) => void;
  className?: string;
}) {
  const active = sort?.key === k;
  if (!onSort) return <span className={className}>{label}</span>;
  return (
    <button
      onClick={() =>
        onSort({
          key: k,
          dir: active && sort?.dir === "desc" ? "asc" : active ? "desc" : k === "title" || k === "key" ? "asc" : "desc",
        })
      }
      className={cn("hover:text-fg flex items-center gap-1 uppercase", active && "text-fg", className)}
    >
      {label}
      {active ? sort?.dir === "asc" ? <ArrowUp className="size-3" /> : <ArrowDown className="size-3" /> : null}
    </button>
  );
}

type RowProps = {
  track: Track;
  index: number;
  selected: boolean;
  selection: string[];
  project?: Project;
  tagById: Map<string, Tag>;
  showProject: boolean;
  projects: Project[];
  queue: Track[];
  onClick: (e: React.MouseEvent, t: Track, i: number) => void;
  onPlay: (t: Track) => void;
  router: ReturnType<typeof useRouter>;
};

const TrackRow = memo(function TrackRow({
  track,
  index,
  selected,
  selection,
  project,
  tagById,
  showProject,
  projects,
  queue,
  onClick,
  onPlay,
  router,
}: RowProps) {
  const isCurrent = usePlayer((s) => s.current?.trackId === track.id);
  const playing = usePlayer((s) => s.playing && s.current?.trackId === track.id);
  const job = useUploads((s) => s.jobs.find((j) => j.trackId === track.id && j.kind === "track" && j.stage !== "done"));
  const [menuOpen, setMenuOpen] = useState(false);
  const entries = () => trackMenu(track, { router, projects, queue, selection });
  const tags = track.tag_ids.map((id) => tagById.get(id)).filter((t): t is Tag => !!t);
  const meta = [track.bpm ? `${formatBpm(track.bpm)} BPM` : null, track.key ? shortKey(track.key) : null].filter(
    Boolean,
  );

  return (
    <ContextMenu entries={entries}>
      <div
        draggable
        onDragStart={(e) => setTrackDrag(e, selected && selection.length ? selection : [track.id], track.title)}
        onClick={(e) => onClick(e, track, index)}
        onDoubleClick={() => onPlay(track)}
        className={cn(
          "group flex h-14 cursor-default items-center gap-4 px-4 transition-colors md:px-8",
          selected ? "bg-accent/10" : "hover:bg-hover/70",
          menuOpen && "bg-hover/70",
        )}
      >
        <div className="relative hidden w-8 shrink-0 place-items-center md:grid">
          <span className={cn("tabular text-faint font-mono text-xs group-hover:invisible", isCurrent && "invisible")}>
            {index + 1}
          </span>
          {playing ? (
            <span className="absolute group-hover:invisible">
              <PlayingBars />
            </span>
          ) : null}
          <button
            onClick={(e) => {
              e.stopPropagation();
              onPlay(track);
            }}
            className={cn(
              "text-fg absolute grid size-8 place-items-center rounded-full opacity-0 group-hover:opacity-100",
              isCurrent && !playing && "text-accent opacity-100",
            )}
            aria-label={playing ? "Pause" : "Lecture"}
          >
            {playing ? (
              <Pause className="size-4" fill="currentColor" />
            ) : (
              <Play className="size-4" fill="currentColor" />
            )}
          </button>
        </div>

        <div className="flex min-w-0 flex-1 items-center gap-3">
          <Cover path={track.cover_path} seed={track.id} className="size-10">
            <button
              onClick={(e) => {
                e.stopPropagation();
                onPlay(track);
              }}
              className="absolute inset-0 grid place-items-center bg-black/40 opacity-0 transition-opacity group-hover:opacity-100 md:hidden"
              aria-label="Lecture"
            >
              {playing ? <Pause className="size-4" fill="white" /> : <Play className="size-4" fill="white" />}
            </button>
          </Cover>
          <div className="min-w-0">
            <Link
              href={`/tracks/${track.id}`}
              onClick={(e) => e.preventDefault()}
              className={cn("block truncate text-[13.5px] font-medium", isCurrent && "text-accent")}
              draggable={false}
            >
              {track.title}
              {track.version_number > 1 ? (
                <span className="border-line-strong text-faint ml-2 rounded border px-1 py-px align-middle font-mono text-[10px]">
                  V{track.version_number}
                </span>
              ) : null}
            </Link>
            <p className="text-muted truncate text-xs">
              {track.status === "uploading" && job ? (
                <span className="text-accent inline-flex items-center gap-1.5">
                  <Spinner className="size-3" /> Import {Math.round(job.progress * 100)} %
                </span>
              ) : track.status === "processing" ? (
                <span className="text-muted inline-flex items-center gap-1.5">
                  <Spinner className="size-3" /> Traitement
                </span>
              ) : track.status === "error" ? (
                <span className="text-danger">Échec de l’import</span>
              ) : (
                <>
                  {track.artist || <span className="text-faint">—</span>}
                  <span className="md:hidden">
                    {meta.length ? ` · ${meta.join(" · ")}` : ""} · {formatDuration(track.duration)}
                  </span>
                </>
              )}
            </p>
          </div>
        </div>

        <span className="tabular text-muted hidden w-14 font-mono text-[12.5px] md:block">
          {formatBpm(track.bpm) || "—"}
        </span>
        <span className="text-muted hidden w-14 text-[12.5px] md:block">{shortKey(track.key) || "—"}</span>
        <div className="hidden w-44 gap-1 overflow-hidden lg:flex">
          {tags.slice(0, 2).map((t) => (
            <TagPill key={t.id} tag={t} />
          ))}
          {tags.length > 2 ? <span className="text-faint text-[11px]">+{tags.length - 2}</span> : null}
        </div>
        {showProject ? (
          <span className="text-muted hidden w-32 truncate text-[12.5px] xl:block">
            {project ? (
              <Link
                href={`/projects/${project.id}`}
                onClick={(e) => e.stopPropagation()}
                className="hover:text-fg hover:underline"
              >
                {project.name}
              </Link>
            ) : (
              <span className="text-faint">—</span>
            )}
          </span>
        ) : null}
        <span className="text-muted hidden w-20 text-[12.5px] lg:block">{shortDate(track.created_at)}</span>
        <span className="tabular text-muted hidden w-12 text-right font-mono text-[12.5px] md:block">
          {formatDuration(track.duration)}
        </span>

        <div className="flex w-16 shrink-0 items-center justify-end gap-0.5" onClick={(e) => e.stopPropagation()}>
          <button
            onClick={() => toggleFavorite(track).catch((e) => toast.error(errorMessage(e)))}
            className={cn(
              "hover:bg-active rounded-md p-1.5 transition",
              track.favorite
                ? "text-accent"
                : "text-faint hover:text-fg opacity-0 group-hover:opacity-100 max-md:hidden",
            )}
            aria-label={track.favorite ? "Retirer des favoris" : "Favori"}
          >
            <Heart className="size-4" fill={track.favorite ? "currentColor" : "none"} />
          </button>
          <DropdownMenu
            entries={entries()}
            onOpenChange={setMenuOpen}
            trigger={
              <button
                className={cn(
                  "text-faint hover:bg-active hover:text-fg rounded-md p-1.5 transition md:opacity-0 md:group-hover:opacity-100",
                  menuOpen && "opacity-100",
                )}
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
});
