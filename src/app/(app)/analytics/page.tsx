"use client";

import { useMemo, useState } from "react";
import {
  CLICK_METHOD,
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
import { PageHeader } from "@/components/ui/misc";
import { Skeleton } from "@/components/ui/spinner";
import { formatListened, formatRate, perTrack, summarizeEmails, summarizePlays } from "@/lib/analytics/stats";
import { buildTimeline } from "@/lib/analytics/timeline";
import { filterAnalytics, useAnalytics, type Period } from "@/lib/data/analytics";
import { useProjects } from "@/lib/data/library";
import { useTracks } from "@/lib/data/tracks";

export default function AnalyticsPage() {
  const { data, isLoading, error } = useAnalytics();
  const { data: tracks = [] } = useTracks();
  const { data: projects = [] } = useProjects();
  const [period, setPeriod] = useState<Period>("30");

  const view = useMemo(() => (data ? filterAnalytics(data, { period }) : null), [data, period]);
  const trackTitle = (id: string | null) => tracks.find((t) => t.id === id)?.title ?? "Prod supprimée";
  const projectName = (id: string | null) => projects.find((p) => p.id === id)?.name ?? "Projet supprimé";
  const projectOfTrack = (id: string) => tracks.find((t) => t.id === id)?.project_id ?? null;

  return (
    <div className="pb-10">
      <PageHeader
        title="Analytics"
        subtitle="Ouvertures, clics et écoutes de tes prods envoyées"
        actions={<PeriodPicker value={period} onChange={setPeriod} />}
      />
      <div className="px-4 md:px-8">
        {error ? (
          <p className="border-danger/30 bg-danger/5 text-danger rounded-xl border px-4 py-3 text-[13px]">
            {error.message}
          </p>
        ) : isLoading || !view ? (
          <div className="space-y-3">
            <Skeleton className="h-24" />
            <Skeleton className="h-40" />
          </div>
        ) : (
          <Content
            view={view}
            totalViews={period === "all" ? view.shares.reduce((s, x) => s + x.view_count, 0) : null}
            trackTitle={trackTitle}
            projectName={projectName}
            projectOfTrack={projectOfTrack}
          />
        )}
      </div>
    </div>
  );
}

function Content({
  view,
  totalViews,
  trackTitle,
  projectName,
  projectOfTrack,
}: {
  view: ReturnType<typeof filterAnalytics>;
  totalViews: number | null;
  trackTitle: (id: string | null) => string;
  projectName: (id: string | null) => string;
  projectOfTrack: (id: string) => string | null;
}) {
  const emails = summarizeEmails(view.sends, view.emailEvents);
  const listens = summarizePlays(view.plays);
  const ranking = perTrack(view.plays).slice(0, 15);
  const automatedClicks = view.emailEvents.filter((e) => e.event_type === "click" && e.origin === "automated").length;
  const listenedProjects = new Set(
    view.plays.filter((p) => p.started || p.listened_seconds > 0).map((p) => p.project_id),
  );
  const timeline = buildTimeline({ ...view, trackTitle, projectName, limit: 120 });

  return (
    <>
      <Section title="E-mails" description="Envoyés depuis CREATE avec un lien de projet.">
        {emails.sent ? (
          <>
            <StatGrid>
              <StatCard label="E-mails envoyés" value={emails.sent} />
              <StatCard
                label="Ouverture détectée"
                value={emails.opened}
                hint={`Taux : ${formatRate(emails.openRate)}`}
                accent
              />
              <StatCard
                label="Clic sur le lien"
                value={emails.clicked}
                hint={`Taux : ${formatRate(emails.clickRate)}`}
                accent
              />
              <StatCard label="Clics automatiques écartés" value={automatedClicks} hint="Scanners, aperçus de liens" />
            </StatGrid>
            {emails.sent > emails.tracked ? (
              <p className="text-faint mt-2 text-[11.5px]">
                {emails.sent - emails.tracked} e-mail{emails.sent - emails.tracked > 1 ? "s" : ""} envoyé
                {emails.sent - emails.tracked > 1 ? "s" : ""} avant l’activation du suivi : exclus des taux.
              </p>
            ) : null}
            <MethodNote>{OPEN_METHOD}</MethodNote>
            <MethodNote>{CLICK_METHOD}</MethodNote>
          </>
        ) : (
          <NoData>Aucun e-mail envoyé sur cette période.</NoData>
        )}
      </Section>

      <Section
        title="Écoutes"
        description="Mesurées sur les pages publiques de tes projets (tes propres visites ne comptent pas)."
      >
        {listens.starts ? (
          <>
            <StatGrid>
              <StatCard
                label="Projets écoutés"
                value={listenedProjects.size}
                hint={totalViews != null ? `${totalViews} ouvertures de pages (depuis toujours)` : undefined}
              />
              <StatCard label="Démarrages de lecture" value={listens.starts} />
              <StatCard label="Écoutes qualifiées" value={listens.qualified} accent />
              <StatCard label="Écoutes complètes" value={listens.complete} />
              <StatCard label="Temps d’écoute cumulé" value={formatListened(listens.listenedSeconds)} />
              <StatCard
                label="Sessions d’écoute"
                value={listens.sessions}
                hint="Onglets distincts (pas des personnes)"
              />
              <StatCard label="Relectures" value={listens.repeats} hint="Même prod relancée dans la même session" />
              <StatCard label="Complétion moyenne" value={formatRate(listens.avgCompletion)} />
            </StatGrid>
            <MethodNote>{LISTEN_METHOD}</MethodNote>
          </>
        ) : (
          <NoData>Aucune lecture enregistrée sur cette période.</NoData>
        )}
      </Section>

      <Section title="Prods les plus écoutées" description="Classées par écoutes qualifiées.">
        <TrackTable
          rows={ranking}
          title={(id) => (
            <>
              {trackTitle(id)} <span className="text-faint text-xs">· {projectName(projectOfTrack(id))}</span>
            </>
          )}
        />
      </Section>

      <Section
        title="Activité"
        description="Uniquement les événements réellement reçus : messagerie (ouvertures, clics) et player (lectures)."
      >
        <Timeline items={timeline} />
      </Section>
    </>
  );
}
