"use client";

import {
  ArrowDown,
  ArrowUp,
  BarChart3,
  Download,
  FileSpreadsheet,
  Pencil,
  Plus,
  Search,
  Trash2,
  Users,
  X,
} from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { ImportArtistsDialog } from "@/components/artists/import-dialog";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Input, Label } from "@/components/ui/input";
import { EmptyState, PageHeader } from "@/components/ui/misc";
import { Skeleton } from "@/components/ui/spinner";
import { createArtist, deleteArtists, filterArtists, updateArtist, useArtists } from "@/lib/data/artists";
import type { Artist } from "@/lib/types";
import { confirm } from "@/lib/ui-store";
import { cn, errorMessage } from "@/lib/utils";

type SortKey = "artist_name" | "email";

const collator = new Intl.Collator("fr", { sensitivity: "base", numeric: true });

async function exportExcel(list: Artist[]) {
  const XLSX = await import("xlsx");
  const ws = XLSX.utils.aoa_to_sheet([["Nom de l'artiste", "E-mail"], ...list.map((a) => [a.artist_name, a.email])]);
  ws["!cols"] = [{ wch: 32 }, { wch: 40 }];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Artistes");
  XLSX.writeFile(wb, `artistes-${new Date().toISOString().slice(0, 10)}.xlsx`);
}

export default function ArtistsPage() {
  const { data: artists = [], isLoading, error } = useArtists();
  const [q, setQ] = useState("");
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: "artist_name", dir: 1 });
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [editing, setEditing] = useState<Artist | "new" | null>(null);
  const [importing, setImporting] = useState(false);

  const visible = useMemo(
    () =>
      filterArtists(artists, q)
        .slice()
        .sort((a, b) => sort.dir * collator.compare(a[sort.key], b[sort.key]) || collator.compare(a.email, b.email)),
    [artists, q, sort],
  );
  // Selection only counts rows that still exist.
  const chosen = artists.filter((a) => selected.has(a.id));
  const allVisibleSelected = visible.length > 0 && visible.every((a) => selected.has(a.id));

  const toggle = (id: string) =>
    setSelected((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  const toggleAll = () =>
    setSelected((s) => {
      const n = new Set(s);
      for (const a of visible) {
        if (allVisibleSelected) n.delete(a.id);
        else n.add(a.id);
      }
      return n;
    });

  const remove = async (list: Artist[]) => {
    const ok = await confirm({
      title: list.length === 1 ? `Supprimer « ${list[0].artist_name} » ?` : `Supprimer ${list.length} artistes ?`,
      body:
        list.length === 1
          ? `${list[0].email} sera retiré de ta base. L’historique des envois est conservé.`
          : "Ils seront retirés de ta base. L’historique des envois est conservé.",
      confirmLabel: "Supprimer",
      danger: true,
    });
    if (!ok) return;
    try {
      await deleteArtists(list.map((a) => a.id));
      setSelected((s) => {
        const n = new Set(s);
        for (const a of list) n.delete(a.id);
        return n;
      });
      toast.success(list.length === 1 ? "Artiste supprimé" : `${list.length} artistes supprimés`);
    } catch (e) {
      toast.error("Suppression impossible", { description: errorMessage(e) });
    }
  };

  const sortBy = (key: SortKey) => setSort((s) => ({ key, dir: s.key === key ? (s.dir === 1 ? -1 : 1) : 1 }));

  return (
    <div className="pb-10">
      <PageHeader
        title="Artistes"
        subtitle={
          error
            ? " "
            : artists.length
              ? `${artists.length} contact${artists.length > 1 ? "s" : ""}`
              : "Ta base de contacts"
        }
        actions={
          <>
            <Button
              variant="ghost"
              disabled={!artists.length}
              onClick={() => void exportExcel(chosen.length ? chosen : visible)}
              title={chosen.length ? "Exporter la sélection" : "Exporter la liste affichée"}
            >
              <Download /> <span className="max-sm:hidden">Exporter Excel</span>
            </Button>
            <Button variant="secondary" onClick={() => setImporting(true)} disabled={!!error}>
              <FileSpreadsheet /> <span className="max-sm:hidden">Importer Excel</span>
            </Button>
            <Button variant="primary" onClick={() => setEditing("new")} disabled={!!error}>
              <Plus /> <span className="max-sm:hidden">Ajouter</span>
            </Button>
          </>
        }
      />

      {error ? (
        <p className="border-danger/30 bg-danger/5 text-danger mx-4 rounded-xl border px-4 py-3 text-[13px] md:mx-8">
          {error.message}
        </p>
      ) : (
        <>
          <div className="bg-bg/95 sticky top-0 z-20 flex flex-wrap items-center gap-2 px-4 py-3 backdrop-blur md:px-8">
            <div className="relative min-w-48 flex-1 md:max-w-80">
              <Search className="text-faint absolute top-2.5 left-3 size-4" />
              <Input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Rechercher un nom ou un e-mail"
                className="pl-9"
              />
              {q ? (
                <button
                  onClick={() => setQ("")}
                  className="text-faint hover:text-fg absolute top-2.5 right-2.5"
                  aria-label="Effacer"
                >
                  <X className="size-4" />
                </button>
              ) : null}
            </div>
            {chosen.length ? (
              <div className="ml-auto flex items-center gap-2">
                <span className="text-muted text-xs">
                  {chosen.length} sélectionné{chosen.length > 1 ? "s" : ""}
                </span>
                <Button variant="ghost" size="sm" onClick={() => setSelected(new Set())}>
                  Désélectionner
                </Button>
                <Button variant="danger" size="sm" onClick={() => void remove(chosen)}>
                  <Trash2 /> Supprimer
                </Button>
              </div>
            ) : q ? (
              <span className="text-faint ml-auto text-xs">
                {visible.length} résultat{visible.length > 1 ? "s" : ""}
              </span>
            ) : null}
          </div>

          {isLoading ? (
            <div className="space-y-2 px-4 md:px-8">
              {Array.from({ length: 6 }).map((_, i) => (
                <Skeleton key={i} className="h-10" />
              ))}
            </div>
          ) : !artists.length ? (
            <EmptyState
              icon={Users}
              title="Aucun artiste pour l’instant"
              action={
                <Button variant="primary" onClick={() => setImporting(true)}>
                  <FileSpreadsheet /> Importer Excel
                </Button>
              }
            >
              Importe un fichier avec le nom et l’e-mail de chaque artiste, ou ajoute-les un par un.
            </EmptyState>
          ) : (
            <div className="px-4 md:px-8">
              <div className="border-line overflow-hidden rounded-xl border">
                <table className="w-full table-fixed text-left text-[13px]">
                  <thead className="bg-panel text-faint border-line border-b text-xs">
                    <tr>
                      <th className="w-10 px-3 py-2">
                        <Box checked={allVisibleSelected} onChange={toggleAll} label="Tout sélectionner" />
                      </th>
                      <th className="px-3 py-2 font-medium">
                        <button
                          onClick={() => sortBy("artist_name")}
                          className="hover:text-fg inline-flex items-center gap-1"
                        >
                          Nom de l’artiste <SortIcon sort={sort} k="artist_name" />
                        </button>
                      </th>
                      <th className="px-3 py-2 font-medium">
                        <button
                          onClick={() => sortBy("email")}
                          className="hover:text-fg inline-flex items-center gap-1"
                        >
                          E-mail <SortIcon sort={sort} k="email" />
                        </button>
                      </th>
                      <th className="w-28 px-3 py-2" />
                    </tr>
                  </thead>
                  <tbody className="divide-line divide-y">
                    {visible.map((a) => (
                      <tr key={a.id} className={cn("group hover:bg-hover/50", selected.has(a.id) && "bg-accent/5")}>
                        <td className="px-3 py-2">
                          <Box checked={selected.has(a.id)} onChange={() => toggle(a.id)} label={a.artist_name} />
                        </td>
                        <td className="truncate px-3 py-2" title={a.artist_name}>
                          {a.artist_name}
                        </td>
                        <td className="text-muted truncate px-3 py-2 font-mono text-[12px]" title={a.email}>
                          {a.email}
                        </td>
                        <td className="px-2 py-1 text-right whitespace-nowrap">
                          <Link
                            href={`/artists/${a.id}`}
                            className="text-muted hover:text-fg hover:bg-hover inline-grid size-7 place-items-center rounded-md align-middle"
                            aria-label="Statistiques"
                            title="Statistiques"
                          >
                            <BarChart3 className="size-4" />
                          </Link>
                          <Button variant="ghost" size="icon-sm" onClick={() => setEditing(a)} aria-label="Modifier">
                            <Pencil />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon-sm"
                            onClick={() => void remove([a])}
                            aria-label="Supprimer"
                          >
                            <Trash2 />
                          </Button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {!visible.length ? (
                  <p className="text-muted px-4 py-6 text-center text-[13px]">Aucun résultat.</p>
                ) : null}
              </div>
            </div>
          )}
        </>
      )}

      {editing ? <ArtistDialog artist={editing === "new" ? null : editing} onClose={() => setEditing(null)} /> : null}
      {importing ? <ImportArtistsDialog existing={artists} onClose={() => setImporting(false)} /> : null}
    </div>
  );
}

function Box({ checked, onChange, label }: { checked: boolean; onChange: () => void; label: string }) {
  return (
    <input
      type="checkbox"
      checked={checked}
      onChange={onChange}
      aria-label={label}
      className="size-3.5 cursor-pointer align-middle accent-[var(--accent)]"
    />
  );
}

function ArtistDialog({ artist, onClose }: { artist: Artist | null; onClose: () => void }) {
  const [name, setName] = useState(artist?.artist_name ?? "");
  const [email, setEmail] = useState(artist?.email ?? "");
  const [saving, setSaving] = useState(false);

  const save = async () => {
    setSaving(true);
    try {
      const input = { artist_name: name, email };
      if (artist) await updateArtist(artist.id, input);
      else await createArtist(input);
      toast.success(artist ? "Artiste modifié" : "Artiste ajouté");
      onClose();
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={artist ? "Modifier l’artiste" : "Ajouter un artiste"}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Annuler
          </Button>
          <Button
            variant="primary"
            onClick={() => void save()}
            loading={saving}
            disabled={!name.trim() || !email.trim()}
          >
            Enregistrer
          </Button>
        </>
      }
    >
      <form
        className="space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        <div>
          <Label htmlFor="artist-name">Nom de l’artiste</Label>
          <Input id="artist-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={200} />
        </div>
        <div>
          <Label htmlFor="artist-email">E-mail</Label>
          <Input
            id="artist-email"
            type="email"
            inputMode="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            maxLength={254}
          />
        </div>
        <button type="submit" hidden />
      </form>
    </Dialog>
  );
}

function SortIcon({ sort, k }: { sort: { key: SortKey; dir: 1 | -1 }; k: SortKey }) {
  if (sort.key !== k) return null;
  return sort.dir === 1 ? <ArrowDown className="size-3" /> : <ArrowUp className="size-3" />;
}
