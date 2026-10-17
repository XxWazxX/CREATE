"use client";

import { ChevronRight } from "lucide-react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useMemo, useState } from "react";
import { RecipientTable, withUnplayed } from "@/components/analytics/project-analytics";
import {
  LISTEN_METHOD,
  MethodNote,
  NoData,
  OPEN_METHOD,
  PeriodPicker,
  Section,
  StatCard,
  StatGrid,
  Timeline,
  TrackTable,
} from "@/components/analytics/widgets";
import { Skeleton } from "@/components/ui/spinner";
import { formatRate, isStart, perTrack, sendStats, summarizePlays } from "@/lib/analytics/stats";
import { buildTimeline } from "@/lib/analytics/timeline";
import { filterAnalytics, useAnalytics, type Period } from "@/lib/data/analytics";
import { useArtists } from "@/lib/data/artists";
import { useProjects } from "@/lib/data/library";
import { useTracks } from "@/lib/data/tracks";
import { relativeDate } from "@/lib/utils";

/**
 * One artist (one address): emails sent to it, detected opens / clicks, and the
 * listens that came through the link of THOSE emails. Direct-link listens are
 * never attributed to anyone.
 */
export default function ArtistStatsPage() {
  const { id } = useParams<{ id: string }>();
  const { data: artists = [], isLoading: loadingArtists } = useArtists();
  const { data, isLoading, error } = useAnalytics();
  const { data: tracks = [] } = useTracks();
  const { data: projects = [] } = useProjects();
  const [period, setPeriod] = useState<Period>("all");
  const artist = artists.find((a) => a.id === id);

  const view = useMemo(() => {
    if (!data || !artist) return null;
    const sendIds = new Set(data.sends.filter((s) => s.recipient.toLowerCase() === artist.email).map((s) => s.id));
    return filterAnalytics(data, { period, sendIds });
  }, [data, artist, period]);

  const trackTitle = (tid: string | null) => tracks.find((t) => t.id === tid)?.title ?? "Prod supprimée";
  const projectName = (pid: string | null) => projects.find((p) => p.id === pid)?.name ?? "Projet supprimé";

  const header = (
    <div className="px-4 pt-6 pb-4 md:px-8 md:pt-8">
      <nav className="text-muted mb-3 flex items-center gap-1 text-[13px]">
        <Link href="/artists" className="hover:text-fg">
          Artistes
        </Link>
        <ChevronRight className="text-faint size-3.5" />
        <span className="text-fg max-w-72 truncate">{artist?.artist_name ?? "…"}</span>
      </nav>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <h1 className="truncate text-2xl font-semibold tracking-tight">{artist?.artist_name ?? " "}</h1>
          <p className="text-muted font-mono text-[12.5px]">{artist?.email}</p>
        </div>
        <PeriodPicker value={period} onChange={setPeriod} />
      </div>
    </div>
  );

  if (loadingArtists || isLoading) {
    return (
      <div className="space-y-3 px-4 pt-8 md:px-8">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-24" />
      </div>
    );
  }
  if (!artist) return <NoData>Artiste introuvable : il a peut-être été supprimé.</NoData>;
  if (error || !view) {
    return (
      <div className="pb-10">
        {header}
        <p className="border-danger/30 bg-danger/5 text-danger mx-4 rounded-xl border px-4 py-3 text-[13px] md:mx-8">
          {error?.message ?? "Statistiques indisponibles"}
        </p>
      </div>
    );
  }

  const stats = view.sends.map((s) => sendStats(view.emailEvents.filter((e) => e.email_send_id === s.id)));
  const lastOpen =
    stats
      .map((s) => s.lastOpen)
      .filter(Boolean)
      .sort()
      .at(-1) ?? null;
  const lastClick =
    stats
      .map((s) => s.lastClick)
      .filter(Boolean)
      .sort()
      .at(-1) ?? null;
  const started = view.plays.filter(isStart);
  const listens = summarizePlays(view.plays);
  const projectIds = [...new Set(view.sends.map((s) => s.project_id).filter((x): x is string => !!x))];
  const listenedProjects = new Set(started.map((p) => p.project_id));
  const lastActivity = [lastOpen, lastClick, listens.lastActivity].filter(Boolean).sort().at(-1) ?? null;
  const timeline = buildTimeline({ ...view, trackTitle, projectName, limit: 100 });

  return (
    <div className="pb-10">
      {header}
      <div className="px-4 md:px-8">
        {!view.sends.length ? (
          <NoData>Aucun e-mail envoyé à cette adresse{period === "all" ? "" : " sur cette période"}.</NoData>
        ) : (
          <>
            <Section title="Résumé">
              <StatGrid>
                <StatCard label="E-mails envoyés" value={view.sends.filter((s) => s.status === "sent").length} />
                <StatCard
                  label="Dernière ouverture détectée"
                  value={lastOpen ? relativeDate(lastOpen) : "—"}
                  hint={lastOpen ? undefined : "Aucune ouverture détectée"}
                />
                <StatCard
                  label="Dernier clic"
                  value={lastClick ? relativeDate(lastClick) : "—"}
                  hint={lastClick ? undefined : "Aucun clic détecté"}
                />
                <StatCard
                  label="Projets consultés"
                  value={`${listenedProjects.size} / ${projectIds.length}`}
                  hint="Avec au moins une lecture"
                />
                <StatCard label="Prods écoutées" value={new Set(started.map((p) => p.track_id)).size} />
                <StatCard label="Écoutes qualifiées" value={listens.qualified} accent />
                <StatCard label="Complétion moyenne" value={formatRate(listens.avgCompletion)} />
                <StatCard label="Dernière activité détectée" value={lastActivity ? relativeDate(lastActivity) : "—"} />
              </StatGrid>
              <MethodNote>
                Seules les écoutes arrivées en cliquant sur le lien d’un e-mail envoyé à cette adresse sont attribuées à
                cet artiste. Si le lien a été transféré, ces écoutes peuvent venir d’une autre personne.
              </MethodNote>
            </Section>

            {projectIds.map((pid) => {
              const plays = view.plays.filter((p) => p.project_id === pid);
              const ids = tracks.filter((t) => t.project_id === pid).map((t) => t.id);
              return (
                <Section key={pid} title={`Projet : ${projectName(pid)}`}>
                  {ids.length || plays.length ? (
                    <TrackTable rows={withUnplayed(perTrack(plays), ids)} title={trackTitle} showRank={false} />
                  ) : (
                    <NoData>Ce projet n’a plus de prod.</NoData>
                  )}
                </Section>
              );
            })}
            <MethodNote>{LISTEN_METHOD}</MethodNote>

            <Section title="E-mails">
              <RecipientTable view={view} />
              <MethodNote>{OPEN_METHOD}</MethodNote>
            </Section>

            <Section
              title="Chronologie"
              description="Dans l’ordre réel : envois, ouvertures, clics, puis lectures prod par prod."
            >
              <Timeline items={timeline} />
            </Section>
          </>
        )}
      </div>
    </div>
  );
}
