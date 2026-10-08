"use client";

import { useMemo } from "react";
import { useTracks } from "@/lib/data/tracks";
import { ALL_KEYS, camelot, keyLabel } from "@/lib/music";
import type { Project } from "@/lib/types";
import { cn } from "@/lib/utils";

const selectCls =
  "h-9 w-full appearance-none rounded-lg border border-line bg-raised px-3 text-[13px] text-fg outline-none focus:border-line-strong";

export function KeySelect({
  value,
  onChange,
  className,
}: {
  value: string | null;
  onChange: (v: string | null) => void;
  className?: string;
}) {
  return (
    <select value={value ?? ""} onChange={(e) => onChange(e.target.value || null)} className={cn(selectCls, className)}>
      <option value="">—</option>
      {ALL_KEYS.map((k) => (
        <option key={k} value={k}>
          {keyLabel(k)} ({camelot(k)})
        </option>
      ))}
    </select>
  );
}

export function ProjectSelect({
  value,
  onChange,
  projects,
  className,
}: {
  value: string | null;
  onChange: (v: string | null) => void;
  projects: Project[];
  className?: string;
}) {
  const ordered = useMemo(() => flattenProjects(projects), [projects]);
  return (
    <select value={value ?? ""} onChange={(e) => onChange(e.target.value || null)} className={cn(selectCls, className)}>
      <option value="">Aucun projet</option>
      {ordered.map(({ project, depth }) => (
        <option key={project.id} value={project.id}>
          {"  ".repeat(depth)}
          {project.name}
        </option>
      ))}
    </select>
  );
}

export function flattenProjects(projects: Project[]) {
  const out: { project: Project; depth: number }[] = [];
  const ids = new Set(projects.map((p) => p.id));
  // Roots: no parent, or a parent that isn't loaded (e.g. in the trash).
  const childrenOf = (parent: string | null) =>
    projects.filter((p) => (parent === null ? !p.parent_id || !ids.has(p.parent_id) : p.parent_id === parent));
  const walk = (parent: string | null, depth: number) => {
    childrenOf(parent)
      .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }))
      .forEach((p) => {
        out.push({ project: p, depth });
        walk(p.id, depth + 1);
      });
  };
  walk(null, 0);
  return out;
}

/** Distinct genres / artists already used, for quick autocompletion. */
export function useSuggestions() {
  const { data: tracks = [] } = useTracks();
  return useMemo(() => {
    const genres = new Set<string>();
    const artists = new Set<string>();
    for (const t of tracks) {
      if (t.genre) genres.add(t.genre);
      if (t.artist) artists.add(t.artist);
      if (t.producer) artists.add(t.producer);
    }
    return { genres: [...genres].sort(), artists: [...artists].sort() };
  }, [tracks]);
}

export function Datalist({ id, values }: { id: string; values: string[] }) {
  return (
    <datalist id={id}>
      {values.map((v) => (
        <option key={v} value={v} />
      ))}
    </datalist>
  );
}
