"use client";

import Link from "next/link";
import { useMemo } from "react";
import { StatCard } from "@/components/analytics/widgets";
import { Cover } from "@/components/ui/cover";
import { Skeleton } from "@/components/ui/spinner";
import { formatListened, formatRate, perTrack, summarizeEmails, summarizePlays } from "@/lib/analytics/stats";
import { filterAnalytics, useAnalytics } from "@/lib/data/analytics";
import type { Track } from "@/lib/types";

/** Home page: the last 30 days of the Analytics section at a glance. */
export function AnalyticsHomeSummary({ tracks }: { tracks: Track[] }) {
  const { data, isLoading, error } = useAnalytics();
  const view = useMemo(() => (data ? filterAnalytics(data, { period: "30" }) : null), [data]);

  if (error) return <p className="text-faint px-4 text-[13px] md:px-8">Statistiques indisponibles.</p>;
  if (isLoading || !view) {
    return (
      <div className="grid grid-cols-2 gap-2 px-4 sm:grid-cols-3 md:px-8 lg:grid-cols-6">
        {Array.from({ length: 6 }).map((_, i) => (
          <Skeleton key={i} className="h-[74px] rounded-xl" />
        ))}
      </div>
    );
  }

  const emails = summarizeEmails(view.sends, view.emailEvents);
  const listens = summarizePlays(view.plays);
  const top = perTrack(view.plays)
    .filter((t) => t.qualified || t.starts)
    .slice(0, 3);
  const track = (id: string) => tracks.find((t) => t.id === id);

  if (!emails.sent && !listens.starts) {
    return (
      <p className="text-faint px-4 text-[13px] md:px-8">
        Rien sur les 30 derniers jours. Envoie un projet par e-mail pour suivre ouvertures, clics et écoutes.
      </p>
    );
  }

  return (
    <div className="px-4 md:px-8">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
        <StatCard label="E-mails envoyés" value={emails.sent} />
        <StatCard label="Ouvertures" value={emails.opened} hint={`Taux : ${formatRate(emails.openRate)}`} />
        <StatCard label="Clics sur le lien" value={emails.clicked} hint={`Taux : ${formatRate(emails.clickRate)}`} />
        <StatCard label="Écoutes qualifiées" value={listens.qualified} accent />
        <StatCard label="Temps d’écoute" value={formatListened(listens.listenedSeconds)} />
        <StatCard label="Complétion moyenne" value={formatRate(listens.avgCompletion)} />
      </div>

      {top.length ? (
        <div className="border-line bg-panel mt-2 rounded-xl border p-2">
          <p className="text-faint px-2 pt-1 pb-2 text-[10.5px] tracking-[0.18em] uppercase">Les plus écoutées</p>
          <ol>
            {top.map((s, i) => {
              const t = track(s.trackId);
              return (
                <li key={s.trackId}>
                  <Link
                    href={t ? `/tracks/${t.id}` : "/analytics"}
                    className="hover:bg-hover flex items-center gap-3 rounded-lg px-2 py-1.5"
                  >
                    <span className="text-faint w-4 text-center text-xs tabular-nums">{i + 1}</span>
                    <Cover path={t?.cover_path ?? null} seed={s.trackId} className="size-8" />
                    <span className="min-w-0 flex-1 truncate text-[13px] font-medium">
                      {t?.title ?? "Prod supprimée"}
                    </span>
                    <span className="text-muted shrink-0 text-xs tabular-nums">
                      {s.qualified} écoute{s.qualified > 1 ? "s" : ""} · {formatListened(s.listenedSeconds)}
                    </span>
                  </Link>
                </li>
              );
            })}
          </ol>
        </div>
      ) : null}
    </div>
  );
}
