"use client";

import { Disc3, Folder, Search, Wand2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { Datalist, KeySelect, ProjectSelect, flattenProjects, useSuggestions } from "@/components/track/fields";
import { TagInput } from "@/components/track/tag-input";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Field, Input, Textarea } from "@/components/ui/input";
import { createProject, projectSubtree, updateProject, useProjects } from "@/lib/data/library";
import { moveTracks, setTrackTags, updateTrack, useTrackDetail } from "@/lib/data/tracks";
import { keyLabel, normalizeKey } from "@/lib/music";
import { usePlayer } from "@/lib/player/store";
import { findTrack } from "@/lib/track-actions";
import type { Track } from "@/lib/types";
import { useUI } from "@/lib/ui-store";
import { redetect } from "@/lib/upload/uploads";
import { cn, errorMessage } from "@/lib/utils";

// ---------------------------------------------------------------------------
// Edit track metadata
// ---------------------------------------------------------------------------

type EditForm = {
  title: string;
  artist: string;
  producer: string;
  bpm: string;
  key: string | null;
  genre: string;
  project_id: string | null;
  notes: string;
  tag_ids: string[];
};

export function EditTrackDialog({ trackId, onClose }: { trackId: string; onClose: () => void }) {
  const { data: detail } = useTrackDetail(trackId);
  if (!detail) {
    return (
      <Dialog open onOpenChange={(o) => !o && onClose()} title="Modifier les infos" wide>
        <div className="h-64" />
      </Dialog>
    );
  }
  return <EditTrackForm track={detail.track} onClose={onClose} />;
}

function EditTrackForm({ track, onClose }: { track: Track; onClose: () => void }) {
  const { data: projects = [] } = useProjects();
  const { genres, artists } = useSuggestions();
  const [form, setForm] = useState<EditForm>(() => ({
    title: track.title,
    artist: track.artist ?? "",
    producer: track.producer ?? "",
    bpm: track.bpm != null ? String(track.bpm) : "",
    key: normalizeKey(track.key),
    genre: track.genre ?? "",
    project_id: track.project_id,
    notes: track.notes,
    tag_ids: track.tag_ids,
  }));
  const [saving, setSaving] = useState(false);
  const [detecting, setDetecting] = useState(false);

  const set = <K extends keyof EditForm>(k: K, v: EditForm[K]) => setForm((f) => ({ ...f, [k]: v }));

  const save = async () => {
    const bpm = form.bpm.trim() ? Number(form.bpm.replace(",", ".")) : null;
    if (bpm != null && (!Number.isFinite(bpm) || bpm <= 0 || bpm >= 1000)) {
      toast.error("Le BPM doit être un nombre entre 1 et 999");
      return;
    }
    if (!form.title.trim()) {
      toast.error("Le titre est obligatoire");
      return;
    }
    setSaving(true);
    try {
      await updateTrack(track.id, {
        title: form.title.trim(),
        artist: form.artist.trim() || null,
        producer: form.producer.trim() || null,
        bpm,
        key: form.key,
        genre: form.genre.trim() || null,
        project_id: form.project_id,
        notes: form.notes,
      });
      await setTrackTags(track.id, form.tag_ids);
      const cur = usePlayer.getState().current;
      if (cur?.trackId === track.id) {
        usePlayer
          .getState()
          .updateCurrentMeta({ title: form.title.trim(), artist: form.artist.trim() || null, bpm, key: form.key });
      }
      toast.success("Enregistré");
      onClose();
    } catch (e) {
      toast.error("Enregistrement impossible", { description: errorMessage(e) });
    } finally {
      setSaving(false);
    }
  };

  const detect = async () => {
    if (!track?.file_path || !track.current_version_id) return;
    setDetecting(true);
    try {
      const r = await redetect(track.id, track.file_path, track.current_version_id);
      setForm((f) => ({ ...f, bpm: r.bpm ? String(r.bpm) : f.bpm, key: normalizeKey(r.key) ?? f.key }));
      toast.success("Détecté", {
        description: [r.bpm && `${r.bpm} BPM`, keyLabel(r.key)].filter(Boolean).join(" · ") || "Rien trouvé",
      });
    } catch (e) {
      toast.error("Échec de la détection", { description: errorMessage(e) });
    } finally {
      setDetecting(false);
    }
  };

  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title="Modifier les infos"
      wide
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Annuler
          </Button>
          <Button variant="primary" onClick={save} loading={saving}>
            Enregistrer
          </Button>
        </>
      }
    >
      <form
        className="grid grid-cols-2 gap-3.5"
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        <Field label="Titre" className="col-span-2">
          <Input value={form.title} onChange={(e) => set("title", e.target.value)} data-autofocus />
        </Field>
        <Field label="Artiste">
          <Input value={form.artist} onChange={(e) => set("artist", e.target.value)} list="dl-artists" />
        </Field>
        <Field label="Producteur">
          <Input value={form.producer} onChange={(e) => set("producer", e.target.value)} list="dl-artists" />
        </Field>
        <Datalist id="dl-artists" values={artists} />
        <div className="col-span-2 grid grid-cols-[1fr_1fr_auto] items-end gap-3">
          <Field label="BPM">
            <Input
              value={form.bpm}
              onChange={(e) => set("bpm", e.target.value)}
              inputMode="decimal"
              placeholder="140"
              className="font-mono"
            />
          </Field>
          <Field label="Tonalité">
            <KeySelect value={form.key} onChange={(v) => set("key", v)} />
          </Field>
          <Button variant="outline" onClick={detect} loading={detecting} className="h-9" title="Analyser l'audio">
            {!detecting ? <Wand2 /> : null} Détecter
          </Button>
        </div>
        <Field label="Genre">
          <Input
            value={form.genre}
            onChange={(e) => set("genre", e.target.value)}
            list="dl-genres"
            placeholder="Trap"
          />
          <Datalist id="dl-genres" values={genres} />
        </Field>
        <Field label="Projet">
          <ProjectSelect value={form.project_id} onChange={(v) => set("project_id", v)} projects={projects} />
        </Field>
        <Field label="Tags" className="col-span-2">
          <TagInput value={form.tag_ids} onChange={(v) => set("tag_ids", v)} />
        </Field>
        <Field label="Notes" className="col-span-2">
          <Textarea value={form.notes} onChange={(e) => set("notes", e.target.value)} rows={3} />
        </Field>
        <button type="submit" className="hidden" />
      </form>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Rename
// ---------------------------------------------------------------------------

export function RenameTrackDialog({ trackId, onClose }: { trackId: string; onClose: () => void }) {
  const track = findTrack(trackId);
  const [title, setTitle] = useState(track?.title ?? "");
  const save = async () => {
    if (!track || !title.trim()) return;
    try {
      await updateTrack(track.id, { title: title.trim() });
      if (usePlayer.getState().current?.trackId === track.id)
        usePlayer.getState().updateCurrentMeta({ title: title.trim() });
      onClose();
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };
  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title="Renommer"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Annuler
          </Button>
          <Button variant="primary" onClick={save} disabled={!title.trim()}>
            Renommer
          </Button>
        </>
      }
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        <Input value={title} onChange={(e) => setTitle(e.target.value)} onFocus={(e) => e.currentTarget.select()} />
      </form>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Project picker (move tracks / move project)
// ---------------------------------------------------------------------------

function ProjectPicker({
  onPick,
  exclude = [],
  noneLabel,
}: {
  onPick: (id: string | null) => void;
  exclude?: string[];
  noneLabel: string;
}) {
  const { data: projects = [] } = useProjects();
  const [q, setQ] = useState("");
  const list = useMemo(() => {
    const flat = flattenProjects(projects).filter((x) => !exclude.includes(x.project.id));
    if (!q.trim()) return flat;
    return flat.filter((x) => x.project.name.toLowerCase().includes(q.toLowerCase())).map((x) => ({ ...x, depth: 0 }));
  }, [projects, q, exclude]);
  return (
    <div>
      <div className="relative mb-2">
        <Search className="text-faint absolute top-2.5 left-3 size-4" />
        <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Chercher un projet" className="pl-9" />
      </div>
      <div className="max-h-72 overflow-y-auto">
        <button
          onClick={() => onPick(null)}
          className="text-muted hover:bg-hover hover:text-fg flex h-9 w-full items-center gap-2.5 rounded-md px-2 text-[13px]"
        >
          {noneLabel}
        </button>
        {list.map(({ project, depth }) => (
          <button
            key={project.id}
            onClick={() => onPick(project.id)}
            className="hover:bg-hover flex h-9 w-full items-center gap-2.5 rounded-md px-2 text-[13px]"
            style={{ paddingLeft: 8 + depth * 16 }}
          >
            {project.kind === "folder" ? (
              <Folder className="text-faint size-4" />
            ) : (
              <Disc3 className="text-faint size-4" />
            )}
            <span className="truncate">{project.name}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

export function MoveDialog({ trackIds, onClose }: { trackIds: string[]; onClose: () => void }) {
  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={`Déplacer ${trackIds.length > 1 ? `${trackIds.length} morceaux` : "le morceau"} vers…`}
    >
      <ProjectPicker
        noneLabel="Aucun projet (bibliothèque uniquement)"
        onPick={async (id) => {
          try {
            await moveTracks(trackIds, id);
            toast.success("Déplacé");
            onClose();
          } catch (e) {
            toast.error(errorMessage(e));
          }
        }}
      />
    </Dialog>
  );
}

export function MoveProjectDialog({ projectId, onClose }: { projectId: string; onClose: () => void }) {
  const { data: projects = [] } = useProjects();
  const exclude = useMemo(() => projectSubtree(projects, projectId).map((p) => p.id), [projects, projectId]);
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()} title="Déplacer vers…">
      <ProjectPicker
        noneLabel="Niveau principal"
        exclude={exclude}
        onPick={async (id) => {
          try {
            await updateProject(projectId, { parent_id: id });
            toast.success("Déplacé");
            onClose();
          } catch (e) {
            toast.error(errorMessage(e));
          }
        }}
      />
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Create / rename project or folder
// ---------------------------------------------------------------------------

export function ProjectDialog({
  state,
  onClose,
}: {
  state: Extract<NonNullable<ReturnType<typeof useUI.getState>["dialog"]>, { type: "project" }>;
  onClose: () => void;
}) {
  const router = useRouter();
  const { data: projects = [] } = useProjects();
  const existing = state.mode === "rename" ? projects.find((p) => p.id === state.projectId) : null;
  const [name, setName] = useState(existing?.name ?? "");
  const [busy, setBusy] = useState(false);
  const kind = state.mode === "create" ? state.kind : (existing?.kind ?? "project");

  const submit = async () => {
    if (!name.trim()) return;
    setBusy(true);
    try {
      if (state.mode === "create") {
        const p = await createProject({ name, kind: state.kind, parent_id: state.parentId ?? null });
        if (state.moveTrackIds?.length) await moveTracks(state.moveTrackIds, p.id);
        toast.success(`${state.kind === "folder" ? "Dossier créé" : "Projet créé"}`);
        onClose();
        if (!state.moveTrackIds?.length) router.push(`/projects/${p.id}`);
      } else if (existing) {
        await updateProject(existing.id, { name: name.trim() });
        onClose();
      }
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const parent = state.mode === "create" && state.parentId ? projects.find((p) => p.id === state.parentId) : null;

  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={
        state.mode === "create"
          ? `${kind === "folder" ? "Nouveau dossier" : "Nouveau projet"}`
          : `Renommer le ${kind === "folder" ? "dossier" : "projet"}`
      }
      description={parent ? `Dans ${parent.name}` : undefined}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Annuler
          </Button>
          <Button variant="primary" onClick={submit} loading={busy} disabled={!name.trim()}>
            {state.mode === "create" ? "Créer" : "Renommer"}
          </Button>
        </>
      }
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <Input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder={kind === "folder" ? "Idées" : "Album 2026"}
          onFocus={(e) => e.currentTarget.select()}
        />
      </form>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Confirm
// ---------------------------------------------------------------------------

export function ConfirmDialog() {
  const req = useUI((s) => s.confirmReq);
  if (!req) return null;
  const done = (ok: boolean) => {
    useUI.setState({ confirmReq: null });
    req.resolve(ok);
  };
  return (
    <Dialog
      open
      onOpenChange={(o) => !o && done(false)}
      title={req.title}
      description={req.body}
      footer={
        <>
          <Button variant="ghost" onClick={() => done(false)}>
            Annuler
          </Button>
          <Button
            variant={req.danger ? "danger" : "primary"}
            onClick={() => done(true)}
            data-autofocus
            className={cn(req.danger && "!bg-danger !text-white")}
          >
            {req.confirmLabel ?? "Confirmer"}
          </Button>
        </>
      }
    />
  );
}
