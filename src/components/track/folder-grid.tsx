"use client";

import { Folder } from "lucide-react";
import Link from "next/link";
import { shortKey } from "@/lib/music";
import type { Track } from "@/lib/types";
import { formatBpm } from "@/lib/utils";

/** Library as folders: one folder per track, opening on its Prod / Stems / Session sub-folders. */
export function FolderGrid({ tracks, emptyState }: { tracks: Track[]; emptyState?: React.ReactNode }) {
  if (!tracks.length) return <>{emptyState}</>;
  return (
    <div className="grid grid-cols-[repeat(auto-fill,minmax(160px,1fr))] gap-3 px-4 pt-2 md:px-8">
      {tracks.map((t) => (
        <Link
          key={t.id}
          href={`/library/${t.id}`}
          className="border-line bg-panel hover:bg-raised flex min-w-0 flex-col gap-3 rounded-2xl border p-4 transition-colors"
        >
          <Folder className="text-accent size-9" fill="currentColor" fillOpacity={0.15} />
          <span className="min-w-0">
            <span className="block truncate text-[13.5px] font-semibold">{t.title}</span>
            <span className="text-faint block truncate text-xs">
              {[t.bpm ? `${formatBpm(t.bpm)} BPM` : null, t.key ? shortKey(t.key) : null].filter(Boolean).join(" · ") ||
                "Prod · Stems · Session"}
            </span>
          </span>
        </Link>
      ))}
    </div>
  );
}
