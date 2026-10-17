"use client";

import { useMemo, useState } from "react";
import { Skeleton } from "@/components/ui/spinner";
import {
  formatListened,
  formatRate,
  isQualified,
  isStart,
  perTrack,
  sendStats,
  summarizeEmails,
  summarizePlays,
  type TrackStats,
} from "@/lib/analytics/stats";
import { buildTimeline } from "@/lib/analytics/timeline";
import { filterAnalytics, useAnalytics, type AnalyticsData, type Period } from "@/lib/data/analytics";
import { useTracks } from "@/lib/data/tracks";
import { relativeDate } from "@/lib/utils";
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
} from "./widgets";

const ZERO = {
  starts: 0,
  qualified: 0,
  complete: 0,
  listenedSeconds: 0,
  sessions: 0,
  repeats: 0,
  avgCompletion: null,
  lastActivity: null,
};

/** Ranking of the given tracks, the never-played ones last with measured zeros. */
export function withUnplayed(rows: TrackStats[], trackIds: string[]): TrackStats[] {
  const seen = new Set(rows.map((r) => r.trackId));
  return [...rows, ...trackIds.filter((id) => !seen.has(id)).map((trackId) => ({ trackId, ...ZERO }))];
}

/** Per email: opens / clicks and the listens that came through its link. */
export function RecipientTable({ view }: { view: AnalyticsData }) {
  if (!view.sends.length) return <NoData>Aucun e-mail envoyé pour ce projet sur cette période.</NoData>;
  return (
    <div className="border-line overflow-x-auto rounded-xl border">
      <table className="w-full min-w-[620px] text-left text-[13px]">
        <thead className="bg-panel text-faint border-line border-b text-xs">
          <tr>
            <th className="px-3 py-2 font-medium">Destinataire</th>
            <th className="px-3 py-2 font-medium">Envoyé</th>
            <th className="px-3 py-2 font-medium">Ouverture détectée</th>
            <th className="px-3 py-2 font-medium">Clic</th>
            <th className="px-3 py-2 text-right font-medium" title="Écoutes arrivées par le lien de cet e-mail">
              Écoutes qualifiées
            </th>
            <th className="px-3 py-2 text-right font-medium">Temps écouté</th>
          </tr>
        </thead>
        <tbody className="divide-line divide-y">
          {view.sends.map((s) => {
            const st = sendStats(view.emailEvents.filter((e) => e.email_send_id === s.id));
            const plays = view.plays.filter((p) => p.email_send_id === s.id && isStart(p));
            return (
              <tr key={s.id}>
                <td className="max-w-56 px-3 py-2">
                  <p className="truncate">{s.options?.artist_name || s.recipient}</p>
                  {s.options?.artist_name ? <p className="text-faint truncate text-xs">{s.recipient}</p> : null}
                </td>
                <td className="text-muted px-3 py-2 text-xs whitespace-nowrap">
                  {s.status === "failed" ? <span className="text-danger">Échec</span> : relativeDate(s.created_at)}
                </td>
                <td className="px-3 py-2 text-xs">
                  {s.tracked === false ? (
                    <span className="text-faint">Non suivi</span>
                  ) : st.opens ? (
                    <span className="text-ok">
                      {st.opens > 1 ? `${st.opens}× · ` : ""}
                      {relativeDate(st.lastOpen)}
                    </span>
                  ) : (
                    <span className="text-faint">Aucune ouverture détectée</span>
                  )}
                </td>
                <td className="px-3 py-2 text-xs">
                  {s.tracked === false ? (
                    <span className="text-faint">—</span>
                  ) : st.clicks ? (
                    <span className="text-ok">{relativeDate(st.lastClick)}</span>
                  ) : (
                    <span className="text-faint">
                      Aucun
                      {st.automatedClicks
                        ? ` (${st.automatedClicks} automatique${st.automatedClicks > 1 ? "s" : ""})`
                        : ""}
                    </span>
                  )}
                </td>
                <td className="px-3 py-2 text-right tabular-nums">
                  {plays.filter((p) => isQualified(p.listened_seconds, p.duration_seconds)).length}
                </td>
                <td className="px-3 py-2 text-right tabular-nums">
                  {formatListened(plays.reduce((n, p) => n + p.listened_seconds, 0))}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export function ProjectAnalytics({ projectId, projectName }: { projectId: string; projectName: string }) {
  const { data, isLoading, error } = useAnalytics();
  const { data: tracks = [] } = useTracks();
  const [period, setPeriod] = useState<Period>("all");
  const [shareId, setShareId] = useState<string | null>(null);

  const shares = useMemo(() => (data?.shares ?? []).filter((s) => s.project_id === projectId), [data, projectId]);
  const view = useMemo(
    () => (data ? filterAnalytics(data, { period, projectId, shareId }) : null),
    [data, period, projectId, shareId],
  );
  const projectTracks = tracks.filter((t) => t.project_id === projectId).map((t) => t.id);
  const trackTitle = (id: string | null) => tracks.find((t) => t.id === id)?.title ?? "Prod supprimée";

  if (error)
    return (
      <p className="border-danger/30 bg-danger/5 text-danger mx-4 rounded-xl border px-4 py-3 text-[13px] md:mx-8">
        {error.message}
      </p>
    );
  if (isLoading || !view)
    return (
      <div className="space-y-3 px-4 md:px-8">
        <Skeleton className="h-24" />
        <Skeleton className="h-40" />
      </div>
    );

  const emails = summarizeEmails(view.sends, view.emailEvents);
  const listens = summarizePlays(view.plays);
  const timeline = buildTimeline({ ...view, trackTitle, projectName: () => projectName, limit: 80 });

  return (
    <div className="px-4 pb-10 md:px-8">
      <div className="mb-6 flex flex-wrap items-center gap-2">
        <PeriodPicker value={period} onChange={setPeriod} />
        {shares.length > 1 ? (
          <select
            value={shareId ?? ""}
            onChange={(e) => setShareId(e.target.value || null)}
            className="border-line bg-raised h-8 rounded-lg border px-2 text-[13px] outline-none"
            aria-label="Lien de partage"
          >
            <option value="">Tous les liens ({shares.length})</option>
            {shares.map((s) => (
              <option key={s.id} value={s.id}>
                {s.label || "Lien sans nom"} — créé {relativeDate(s.created_at)}
              </option>
            ))}
          </select>
        ) : null}
      </div>

      <Section title="Vue d’ensemble">
        <StatGrid>
          <StatCard label="Liens de partage créés" value={shares.length} />
          <StatCard label="E-mails envoyés" value={emails.sent} />
          <StatCard label="Ouverture détectée" value={emails.opened} hint={`Taux : ${formatRate(emails.openRate)}`} />
          <StatCard label="Clic sur le lien" value={emails.clicked} hint={`Taux : ${formatRate(emails.clickRate)}`} />
          <StatCard
            label="Sessions d’écoute"
            value={listens.sessions}
            hint="Estimation : onglets distincts, pas des personnes"
          />
          <StatCard label="Démarrages" value={listens.starts} />
          <StatCard label="Écoutes qualifiées" value={listens.qualified} accent />
          <StatCard label="Temps d’écoute cumulé" value={formatListened(listens.listenedSeconds)} />
        </StatGrid>
        <MethodNote>{LISTEN_METHOD}</MethodNote>
      </Section>

      <Section
        title="Classement des prods"
        description="Par écoutes qualifiées ; les prods jamais lancées apparaissent à 0."
      >
        {projectTracks.length ? (
          <TrackTable rows={withUnplayed(perTrack(view.plays), projectTracks)} title={trackTitle} />
        ) : (
          <NoData>Ce projet n’a pas encore de prod.</NoData>
        )}
      </Section>

      <Section
        title="Destinataires"
        description="Les écoutes ne sont attribuées à un artiste que s’il est arrivé par le lien de son e-mail."
      >
        <RecipientTable view={view} />
        {emails.sent ? (
          <>
            <MethodNote>{OPEN_METHOD}</MethodNote>
            <MethodNote>{CLICK_METHOD}</MethodNote>
          </>
        ) : null}
      </Section>

      <Section title="Activité">
        <Timeline items={timeline} />
      </Section>
    </div>
  );
}
