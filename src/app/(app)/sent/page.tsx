"use client";

import { CheckCircle2, Eye, Mail, Search, XCircle } from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { Dialog } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { EmptyState, PageHeader } from "@/components/ui/misc";
import { Skeleton, Spinner } from "@/components/ui/spinner";
import { fetchSendHtml, useSends } from "@/lib/data/library";
import type { EmailSend } from "@/lib/types";
import { useUI } from "@/lib/ui-store";
import { cn, relativeDate } from "@/lib/utils";

function dayLabel(iso: string) {
  const d = new Date(iso);
  const today = new Date();
  const yesterday = new Date(Date.now() - 86_400_000);
  if (d.toDateString() === today.toDateString()) return "Aujourd'hui";
  if (d.toDateString() === yesterday.toDateString()) return "Hier";
  return d.toLocaleDateString("fr-FR", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: d.getFullYear() === today.getFullYear() ? undefined : "numeric",
  });
}

function Status({ send }: { send: EmailSend }) {
  if (send.status === "failed")
    return (
      <span className="text-danger inline-flex items-center gap-1 text-xs" title={send.error ?? ""}>
        <XCircle className="size-3.5" /> Échec
      </span>
    );
  if (send.status === "queued")
    return (
      <span className="text-muted inline-flex items-center gap-1 text-xs">
        <Spinner className="size-3" /> Envoi
      </span>
    );
  if (send.share && send.share.view_count > 0)
    return (
      <span
        className="text-ok inline-flex items-center gap-1 text-xs"
        title={`Dernière ouverture ${relativeDate(send.share.last_viewed_at)}`}
      >
        <Eye className="size-3.5" /> Ouvert{send.share.view_count > 1 ? ` ×${send.share.view_count}` : ""}
        {send.share.play_count ? ` · ${send.share.play_count} écoute${send.share.play_count > 1 ? "s" : ""}` : ""}
      </span>
    );
  return (
    <span className="text-muted inline-flex items-center gap-1 text-xs">
      <CheckCircle2 className="size-3.5" /> Envoyé
    </span>
  );
}

export default function SentPage() {
  const { data: sends, isLoading } = useSends();
  const [q, setQ] = useState("");
  const [viewing, setViewing] = useState<EmailSend | null>(null);
  const openDialog = useUI((s) => s.openDialog);

  const groups = useMemo(() => {
    const s = q.trim().toLowerCase();
    const list = (sends ?? []).filter(
      (x) =>
        !s ||
        x.recipient.toLowerCase().includes(s) ||
        x.track_title.toLowerCase().includes(s) ||
        x.subject.toLowerCase().includes(s),
    );
    const map = new Map<string, EmailSend[]>();
    for (const x of list) {
      const k = dayLabel(x.created_at);
      map.set(k, [...(map.get(k) ?? []), x]);
    }
    return [...map.entries()];
  }, [sends, q]);

  const opened = sends?.filter((s) => (s.share?.view_count ?? 0) > 0).length ?? 0;

  return (
    <div className="pb-10">
      <PageHeader
        title="Envoyés"
        subtitle={
          sends?.length ? `${sends.length} e-mails · ${opened} ouverts` : "Les projets que tu as envoyés par e-mail"
        }
        actions={
          sends?.length ? (
            <div className="relative w-64 max-sm:w-full">
              <Search className="text-faint absolute top-2.5 left-3 size-4" />
              <Input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Destinataire ou projet"
                className="pl-9"
              />
            </div>
          ) : null
        }
      />
      {isLoading ? (
        <div className="space-y-2 px-4 md:px-8">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-12" />
          ))}
        </div>
      ) : !sends?.length ? (
        <EmptyState icon={Mail} title="Rien d'envoyé pour l'instant">
          Ouvre un projet, clique sur « Partager » puis « Envoyer par e-mail » — sans quitter CREATE.
        </EmptyState>
      ) : (
        groups.map(([day, items]) => (
          <section key={day} className="mb-6">
            <h2 className="text-faint px-4 pb-1.5 text-[11px] font-medium tracking-wider uppercase md:px-8">{day}</h2>
            <ul className="divide-line border-line divide-y border-y">
              {items.map((s) => (
                <li
                  key={s.id}
                  onClick={() => setViewing(s)}
                  className="hover:bg-hover/60 flex cursor-pointer items-center gap-4 px-4 py-3 md:px-8"
                >
                  <div className="bg-raised text-muted grid size-9 shrink-0 place-items-center rounded-full text-[13px] font-medium uppercase">
                    {s.recipient[0]}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[13.5px]">
                      <span className="font-medium">{s.recipient.split("@")[0]}</span>
                      <span className="text-faint"> — </span>
                      {s.project_id ? (
                        <Link
                          href={`/projects/${s.project_id}`}
                          onClick={(e) => e.stopPropagation()}
                          className="hover:underline"
                        >
                          {s.track_title}
                        </Link>
                      ) : (
                        s.track_title
                      )}
                    </p>
                    <p className="text-muted truncate text-xs">
                      {s.recipient} · {s.subject}
                    </p>
                  </div>
                  <Status send={s} />
                  <span className="text-faint hidden w-24 text-right text-xs sm:block">
                    {new Date(s.created_at).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        ))
      )}
      {viewing ? (
        <SentViewer
          send={viewing}
          onClose={() => setViewing(null)}
          onResend={() => {
            setViewing(null);
            if (viewing.project_id) openDialog({ type: "project-share", projectId: viewing.project_id, view: "email" });
          }}
        />
      ) : null}
    </div>
  );
}

function SentViewer({ send, onClose, onResend }: { send: EmailSend; onClose: () => void; onResend: () => void }) {
  const [html, setHtml] = useState<string | null | undefined>(undefined);
  useEffect(() => {
    let alive = true;
    fetchSendHtml(send.id).then((h) => alive && setHtml(h ?? null));
    return () => {
      alive = false;
    };
  }, [send.id]);
  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      wide
      title={send.subject}
      description={`À ${send.recipient} · ${new Date(send.created_at).toLocaleString("fr-FR")}`}
      footer={
        <>
          <span className="mr-auto">
            <Status send={send} />
          </span>
          {send.project_id ? (
            <button onClick={onResend} className="text-muted hover:text-fg text-[13px]">
              Renvoyer…
            </button>
          ) : null}
        </>
      }
    >
      {send.error ? <p className="bg-danger/10 text-danger mb-3 rounded-lg px-3 py-2 text-xs">{send.error}</p> : null}
      <div
        className={cn("border-line overflow-hidden rounded-xl border bg-white", html === undefined && "animate-pulse")}
      >
        {html ? (
          <iframe title="E-mail envoyé" srcDoc={html} sandbox="" className="h-[60vh] w-full" />
        ) : html === null ? (
          <pre className="p-4 text-sm whitespace-pre-wrap text-black">{send.message}</pre>
        ) : (
          <div className="h-[60vh]" />
        )}
      </div>
    </Dialog>
  );
}
