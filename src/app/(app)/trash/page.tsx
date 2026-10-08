"use client";

import { Disc3, Folder, RotateCcw, Trash2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Cover } from "@/components/ui/cover";
import { EmptyState, PageHeader } from "@/components/ui/misc";
import { Skeleton } from "@/components/ui/spinner";
import { deleteProjectForever, restoreProject, useTrash } from "@/lib/data/library";
import { deleteTracksForever, restoreTracks } from "@/lib/data/tracks";
import { confirm } from "@/lib/ui-store";
import { errorMessage, formatDuration, relativeDate } from "@/lib/utils";

export default function TrashPage() {
  const { data, isLoading } = useTrash();
  const [busy, setBusy] = useState<string | null>(null);
  // Tracks trashed along with their project are listed under the project.
  const trashedProjectIds = new Set(data?.projects.map((p) => p.id));
  const looseTracks = data?.tracks.filter((t) => !t.project_id || !trashedProjectIds.has(t.project_id)) ?? [];
  const empty = !isLoading && !looseTracks.length && !data?.projects.length;

  const run = async (key: string, fn: () => Promise<unknown>, ok: string) => {
    setBusy(key);
    try {
      await fn();
      toast.success(ok);
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(null);
    }
  };

  const emptyTrash = async () => {
    const ok = await confirm({
      title: "Vider la corbeille ?",
      body: "Tous les fichiers audio, versions et stems de la corbeille seront définitivement supprimés. C'est irréversible.",
      confirmLabel: "Supprimer définitivement",
      danger: true,
    });
    if (!ok || !data) return;
    await run(
      "all",
      async () => {
        for (const p of data.projects.filter((p) => !p.parent_id || !trashedProjectIds.has(p.parent_id))) {
          await deleteProjectForever(p.id);
        }
        if (looseTracks.length) await deleteTracksForever(looseTracks.map((t) => t.id));
      },
      "Corbeille vidée",
    );
  };

  return (
    <div className="pb-10">
      <PageHeader
        title="Corbeille"
        subtitle="Restaure ce que tu veux, ou supprime-le pour de bon."
        actions={
          !empty ? (
            <Button variant="danger" onClick={emptyTrash} loading={busy === "all"}>
              <Trash2 /> Vider la corbeille
            </Button>
          ) : null
        }
      />
      {isLoading ? (
        <div className="space-y-2 px-4 md:px-8">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-12" />
          ))}
        </div>
      ) : empty ? (
        <EmptyState icon={Trash2} title="La corbeille est vide" />
      ) : (
        <div className="divide-line border-line divide-y border-y">
          {data?.projects
            .filter((p) => !p.parent_id || !trashedProjectIds.has(p.parent_id))
            .map((p) => {
              const count = data.tracks.filter((t) => t.project_id === p.id).length;
              return (
                <div key={p.id} className="flex items-center gap-3 px-4 py-2.5 md:px-8">
                  <div className="bg-raised text-muted grid size-10 place-items-center rounded-md">
                    {p.kind === "folder" ? <Folder className="size-4" /> : <Disc3 className="size-4" />}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[13.5px] font-medium">{p.name}</p>
                    <p className="text-muted text-xs">
                      {p.kind === "folder" ? "Dossier" : "Projet"} · {count} morceau{count === 1 ? "" : "x"} · supprimé{" "}
                      {relativeDate(p.deleted_at)}
                    </p>
                  </div>
                  <Button
                    size="sm"
                    variant="ghost"
                    loading={busy === p.id}
                    onClick={() => run(p.id, () => restoreProject(p.id), "Restauré")}
                  >
                    <RotateCcw /> Restaurer
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="hover:text-danger"
                    onClick={async () => {
                      if (
                        await confirm({
                          title: `Supprimer « ${p.name} » définitivement ?`,
                          body: "Ses morceaux et fichiers seront définitivement supprimés.",
                          confirmLabel: "Supprimer définitivement",
                          danger: true,
                        })
                      )
                        await run(p.id, () => deleteProjectForever(p.id), "Supprimé");
                    }}
                  >
                    <Trash2 />
                  </Button>
                </div>
              );
            })}
          {looseTracks.map((t) => (
            <div key={t.id} className="flex items-center gap-3 px-4 py-2.5 md:px-8">
              <Cover path={t.cover_path} seed={t.id} className="size-10" />
              <div className="min-w-0 flex-1">
                <p className="truncate text-[13.5px] font-medium">{t.title}</p>
                <p className="text-muted text-xs">
                  {formatDuration(t.duration)} · supprimé {relativeDate(t.deleted_at)}
                </p>
              </div>
              <Button
                size="sm"
                variant="ghost"
                loading={busy === t.id}
                onClick={() => run(t.id, () => restoreTracks([t.id]), "Restauré")}
              >
                <RotateCcw /> Restaurer
              </Button>
              <Button
                size="sm"
                variant="ghost"
                className="hover:text-danger"
                onClick={async () => {
                  if (
                    await confirm({
                      title: `Supprimer « ${t.title} » définitivement ?`,
                      body: "Toutes les versions et stems seront définitivement supprimés.",
                      confirmLabel: "Supprimer définitivement",
                      danger: true,
                    })
                  )
                    await run(t.id, () => deleteTracksForever([t.id]), "Supprimé");
                }}
              >
                <Trash2 />
              </Button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
