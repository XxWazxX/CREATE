"use client";

import { ArrowRight, Heart, Search, Upload } from "lucide-react";
import Link from "next/link";
import { useMemo } from "react";
import { ProjectCard } from "@/components/track/project-card";
import { TrackList } from "@/components/track/track-list";
import { Button } from "@/components/ui/button";
import { Kbd } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/spinner";
import { useProfile, useProjects } from "@/lib/data/library";
import { useTracks } from "@/lib/data/tracks";
import type { Track } from "@/lib/types";
import { useUI } from "@/lib/ui-store";
import { pickAndImport } from "@/lib/upload/pick";

function greeting() {
  const h = new Date().getHours();
  return h < 5 ? "Session de nuit" : h < 18 ? "Bonjour" : "Bonsoir";
}

function Section({ title, href, children }: { title: string; href?: string; children: React.ReactNode }) {
  return (
    <section className="mt-10">
      <div className="mb-2 flex items-baseline justify-between px-4 md:px-8">
        <h2 className="text-[15px] font-semibold">{title}</h2>
        {href ? (
          <Link href={href} className="text-muted hover:text-fg flex items-center gap-1 text-xs">
            Tout voir <ArrowRight className="size-3" />
          </Link>
        ) : null}
      </div>
      {children}
    </section>
  );
}

export default function Dashboard() {
  const { data: tracks, isLoading } = useTracks();
  const { data: projects = [] } = useProjects();
  const { data: profile } = useProfile();
  const setPalette = useUI((s) => s.setPalette);

  const { added, modified, played, favorites, recentProjects, tracksBy } = useMemo(() => {
    const list = tracks ?? [];
    const by = (key: (t: Track) => string | null) =>
      list.filter((t) => key(t)).sort((a, b) => (key(b) ?? "").localeCompare(key(a) ?? ""));
    const addedIds = new Set(list.slice(0, 6).map((t) => t.id));
    const tracksBy = new Map<string, Track[]>();
    for (const t of list) if (t.project_id) tracksBy.set(t.project_id, [...(tracksBy.get(t.project_id) ?? []), t]);
    return {
      added: by((t) => t.created_at).slice(0, 6),
      modified: by((t) => (t.updated_at !== t.created_at ? t.updated_at : null))
        .filter((t) => !addedIds.has(t.id))
        .slice(0, 5),
      played: by((t) => t.last_played_at).slice(0, 5),
      favorites: by((t) => t.favorited_at)
        .filter((t) => t.favorite)
        .slice(0, 5),
      recentProjects: projects
        .slice()
        .sort((a, b) => b.updated_at.localeCompare(a.updated_at))
        .slice(0, 6),
      tracksBy,
    };
  }, [tracks, projects]);

  const name = profile?.settings.email.fromName || profile?.display_name;

  return (
    <div className="mx-auto max-w-[1400px] pb-16">
      <div className="px-4 pt-8 md:px-8 md:pt-12">
        <p className="text-muted text-[13px]">
          {greeting()}
          {name ? `, ${name}` : ""}
        </p>
        <h1 className="mt-1 text-3xl font-semibold tracking-tight">Accueil</h1>
        <button
          onClick={() => setPalette(true)}
          className="border-line bg-panel text-faint hover:border-line-strong hover:bg-raised mt-6 flex h-12 w-full max-w-2xl items-center gap-3 rounded-xl border px-4 text-left text-[14px] transition-colors"
        >
          <Search className="size-4" />
          <span className="flex-1">Rechercher dans ta bibliothèque…</span>
          <span className="hidden gap-1 sm:flex">
            <Kbd>Ctrl</Kbd>
            <Kbd>K</Kbd>
          </span>
        </button>
      </div>

      {isLoading ? (
        <div className="mt-10 space-y-3 px-4 md:px-8">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-12" />
          ))}
        </div>
      ) : !tracks?.length ? (
        <div className="border-line-strong mx-4 mt-10 flex flex-col items-center rounded-2xl border border-dashed px-6 py-16 text-center md:mx-8">
          <Upload className="text-accent size-8" />
          <h2 className="mt-4 text-lg font-medium">Lance ta bibliothèque</h2>
          <p className="text-muted mt-1 max-w-sm text-[13px]">
            Dépose tes beats n’importe où dans la fenêtre, ou choisis des fichiers. BPM, tonalité et waveform sont
            détectés automatiquement.
          </p>
          <Button variant="primary" size="lg" className="mt-6" onClick={() => pickAndImport(null)}>
            <Upload /> Importer des fichiers
          </Button>
        </div>
      ) : (
        <>
          {recentProjects.length ? (
            <Section title="Projets récents" href="/projects">
              <div className="grid grid-cols-2 gap-1 px-2 sm:grid-cols-3 md:px-6 lg:grid-cols-6">
                {recentProjects.map((p) => (
                  <ProjectCard
                    key={p.id}
                    project={p}
                    tracks={tracksBy.get(p.id) ?? []}
                    childCount={projects.filter((c) => c.parent_id === p.id).length}
                  />
                ))}
              </div>
            </Section>
          ) : null}

          <Section title="Ajouts récents" href="/recent">
            <TrackList tracks={added} plain />
          </Section>

          {played.length ? (
            <Section title="Écoutés récemment">
              <TrackList tracks={played} plain />
            </Section>
          ) : null}

          {modified.length ? (
            <Section title="Modifiés récemment">
              <TrackList tracks={modified} plain />
            </Section>
          ) : null}

          <Section title="Favoris" href="/favorites">
            {favorites.length ? (
              <TrackList tracks={favorites} plain />
            ) : (
              <p className="text-faint flex items-center gap-2 px-4 text-[13px] md:px-8">
                <Heart className="size-4" /> Ajoute un morceau en favori pour l’épingler ici.
              </p>
            )}
          </Section>
        </>
      )}
    </div>
  );
}
