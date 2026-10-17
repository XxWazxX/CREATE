"use client";

import { Headphones, Info, Mail, MousePointerClick, Send } from "lucide-react";
import { formatListened, formatRate, type TrackStats } from "@/lib/analytics/stats";
import type { TimelineItem } from "@/lib/analytics/timeline";
import { PERIODS, type Period } from "@/lib/data/analytics";
import { cn } from "@/lib/utils";

export function StatCard({
  label,
  value,
  hint,
  accent,
}: {
  label: string;
  value: React.ReactNode;
  hint?: React.ReactNode;
  accent?: boolean;
}) {
  return (
    <div className="border-line bg-panel rounded-xl border px-4 py-3">
      <p className={cn("text-xl font-semibold tabular-nums", accent && "text-accent")}>{value}</p>
      <p className="text-muted text-xs">{label}</p>
      {hint ? <p className="text-faint mt-1 text-[11px] leading-snug">{hint}</p> : null}
    </div>
  );
}

export function StatGrid({ children }: { children: React.ReactNode }) {
  return <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">{children}</div>;
}

export function Section({
  title,
  description,
  children,
  actions,
}: {
  title: string;
  description?: React.ReactNode;
  children: React.ReactNode;
  actions?: React.ReactNode;
}) {
  return (
    <section className="mb-8">
      <div className="mb-3 flex flex-wrap items-end justify-between gap-2">
        <div>
          <h2 className="text-[14px] font-semibold">{title}</h2>
          {description ? <p className="text-muted mt-0.5 text-[12.5px]">{description}</p> : null}
        </div>
        {actions}
      </div>
      {children}
    </section>
  );
}

export function PeriodPicker({ value, onChange }: { value: Period; onChange: (p: Period) => void }) {
  return (
    <div className="border-line flex rounded-lg border p-0.5">
      {PERIODS.map((p) => (
        <button
          key={p.id}
          onClick={() => onChange(p.id)}
          className={cn(
            "h-7 rounded-md px-2.5 text-xs",
            value === p.id ? "bg-hover text-fg" : "text-muted hover:text-fg",
          )}
          aria-pressed={value === p.id}
        >
          {p.label}
        </button>
      ))}
    </div>
  );
}

export function NoData({ children }: { children: React.ReactNode }) {
  return (
    <p className="border-line text-muted rounded-xl border border-dashed px-4 py-6 text-center text-[13px]">
      {children}
    </p>
  );
}

export function MethodNote({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-faint mt-2 flex items-start gap-1.5 text-[11.5px] leading-relaxed">
      <Info className="mt-0.5 size-3.5 shrink-0" />
      <span>{children}</span>
    </p>
  );
}

/** Prods ranked by qualified listens. */
export function TrackTable({
  rows,
  title,
  showRank = true,
}: {
  rows: TrackStats[];
  title: (trackId: string) => React.ReactNode;
  showRank?: boolean;
}) {
  if (!rows.length) return <NoData>Aucune lecture enregistrée pour l’instant.</NoData>;
  return (
    <div className="border-line overflow-x-auto rounded-xl border">
      <table className="w-full min-w-[560px] text-left text-[13px]">
        <thead className="bg-panel text-faint border-line border-b text-xs">
          <tr>
            {showRank ? <th className="w-10 px-3 py-2 font-medium">#</th> : null}
            <th className="px-3 py-2 font-medium">Prod</th>
            <th className="px-3 py-2 text-right font-medium" title="Lectures effectivement lancées">
              Démarrages
            </th>
            <th className="px-3 py-2 text-right font-medium" title="≥ 30 s écoutées (ou la moitié si < 1 min)">
              Écoutes qualifiées
            </th>
            <th className="px-3 py-2 text-right font-medium" title="≥ 90 % du morceau écouté">
              Complètes
            </th>
            <th className="px-3 py-2 text-right font-medium">Temps écouté</th>
            <th className="px-3 py-2 text-right font-medium" title="Part moyenne du morceau écoutée">
              Complétion
            </th>
            <th className="px-3 py-2 text-right font-medium" title="Onglets distincts · relectures dans le même onglet">
              Sessions · relectures
            </th>
          </tr>
        </thead>
        <tbody className="divide-line divide-y">
          {rows.map((r, i) => (
            <tr key={r.trackId}>
              {showRank ? <td className="text-faint px-3 py-2 font-mono text-xs">{i + 1}</td> : null}
              <td className="max-w-64 truncate px-3 py-2">{title(r.trackId)}</td>
              <td className="px-3 py-2 text-right tabular-nums">{r.starts}</td>
              <td className="text-accent px-3 py-2 text-right font-medium tabular-nums">{r.qualified}</td>
              <td className="px-3 py-2 text-right tabular-nums">{r.complete}</td>
              <td className="px-3 py-2 text-right tabular-nums">{formatListened(r.listenedSeconds)}</td>
              <td className="px-3 py-2 text-right tabular-nums">{formatRate(r.avgCompletion)}</td>
              <td className="text-muted px-3 py-2 text-right tabular-nums">
                {r.sessions} · {r.repeats}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const SOURCE_ICON = { send: Send, email: Mail, player: Headphones } as const;

export function Timeline({ items }: { items: TimelineItem[] }) {
  if (!items.length) return <NoData>Aucun événement reçu pour l’instant.</NoData>;
  const dayOf = (iso: string) =>
    new Date(iso).toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long" });
  return (
    <ol className="border-line divide-line divide-y overflow-hidden rounded-xl border">
      {items.map((it, i) => {
        const d = new Date(it.at);
        const header = i === 0 || dayOf(items[i - 1].at) !== dayOf(it.at) ? dayOf(it.at) : null;
        const Icon = it.label.startsWith("Clic") ? MousePointerClick : SOURCE_ICON[it.source];
        return (
          <li key={it.id}>
            {header ? (
              <p className="bg-panel text-faint px-3 py-1.5 text-[11px] font-medium tracking-wider uppercase">
                {header}
              </p>
            ) : null}
            <div className={cn("flex items-start gap-3 px-3 py-2", it.muted && "opacity-55")}>
              <span className="text-faint w-11 shrink-0 pt-px font-mono text-[11.5px] tabular-nums">
                {d.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })}
              </span>
              <Icon
                className={cn(
                  "mt-0.5 size-3.5 shrink-0",
                  it.source === "player" ? "text-accent" : it.source === "email" ? "text-ok" : "text-muted",
                )}
              />
              <div className="min-w-0 flex-1">
                <p className="text-[13px]">{it.label}</p>
                {it.detail ? <p className="text-faint truncate text-xs">{it.detail}</p> : null}
              </div>
              <span className="text-faint hidden shrink-0 text-[10.5px] tracking-wider uppercase sm:inline">
                {it.source === "player" ? "Player" : it.source === "email" ? "Messagerie" : "Envoi"}
              </span>
            </div>
          </li>
        );
      })}
    </ol>
  );
}

export const OPEN_METHOD =
  "Taux d’ouverture = e-mails avec au moins une ouverture détectée ÷ e-mails suivis envoyés. Une ouverture est détectée quand l’image invisible de l’e-mail est chargée : certaines messageries la bloquent (ouverture non vue), d’autres la chargent automatiquement (Apple Mail), et Gmail la charge aussi quand tu consultes l’e-mail dans tes « Envoyés ». Ce n’est donc pas la preuve d’une lecture.";

export const CLICK_METHOD =
  "Taux de clic = e-mails dont le lien a été cliqué ÷ e-mails suivis envoyés. Les clics faits par des logiciels (antivirus de messagerie, aperçus de liens, préchargements) ou moins de 10 s après l’envoi sont mis à part.";

export const LISTEN_METHOD =
  "Démarrage = lecture réellement lancée. Écoute qualifiée = au moins 30 s jouées (la moitié du morceau s’il dure moins d’une minute). Écoute complète = au moins 90 % joués. Le temps n’avance que pendant la lecture (pauses et sauts exclus). Ces mesures ne prouvent pas l’identité de l’auditeur.";
