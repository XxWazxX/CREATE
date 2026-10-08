"use client";

import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, Check, CheckCircle2, Trash2 } from "lucide-react";
import { useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Field, Input, Switch, Textarea } from "@/components/ui/input";
import { PageHeader } from "@/components/ui/misc";
import { Slider } from "@/components/ui/slider";
import { Skeleton } from "@/components/ui/spinner";
import {
  TAG_COLORS,
  createTag,
  deleteTag,
  saveProfile,
  updateTag,
  useProfile,
  useStorageUsage,
  useTags,
} from "@/lib/data/library";
import { useTracks } from "@/lib/data/tracks";
import { usePlayer } from "@/lib/player/store";
import type { Settings } from "@/lib/types";
import { confirm } from "@/lib/ui-store";
import { cn, errorMessage, formatBytes } from "@/lib/utils";

const TABS = ["Compte", "E-mail", "Audio", "Apparence", "Tags", "Stockage"] as const;
type Tab = (typeof TABS)[number];

const ACCENTS = [
  { id: "amber", color: "#f2b544" },
  { id: "lime", color: "#b6e45a" },
  { id: "sky", color: "#5cc3f2" },
  { id: "violet", color: "#a99bf7" },
  { id: "rose", color: "#f2798f" },
  { id: "mono", color: "#ececee" },
];

/** Local copy of settings with debounced autosave. */
function useSettingsDraft() {
  const { data: profile } = useProfile();
  const [edited, setEdited] = useState<Settings | null>(null);
  const [state, setState] = useState<"idle" | "saving" | "saved">("idle");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const draft = edited ?? profile?.settings ?? null;

  const update = <K extends keyof Settings>(section: K, patch: Partial<Settings[K]>) => {
    if (!draft) return;
    const next = { ...draft, [section]: { ...draft[section], ...patch } };
    setEdited(next);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(async () => {
      setState("saving");
      try {
        await saveProfile({ settings: next });
        setState("saved");
      } catch (e) {
        setState("idle");
        toast.error("Réglages non enregistrés", { description: errorMessage(e) });
      }
    }, 500);
  };
  return { profile, draft, update, state };
}

export default function SettingsPage() {
  const [tab, setTab] = useState<Tab>("Compte");
  const { profile, draft, update, state } = useSettingsDraft();

  return (
    <div className="mx-auto max-w-4xl pb-16">
      <PageHeader
        title="Réglages"
        actions={
          state !== "idle" ? (
            <span className="text-faint flex items-center gap-1 text-xs">
              {state === "saving" ? (
                "Enregistrement…"
              ) : (
                <>
                  <Check className="size-3.5" /> Enregistré
                </>
              )}
            </span>
          ) : null
        }
      />
      <div className="flex flex-col gap-6 px-4 md:flex-row md:px-8">
        <nav className="flex shrink-0 gap-1 overflow-x-auto md:w-44 md:flex-col">
          {TABS.map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={cn(
                "h-8 rounded-md px-3 text-left text-[13px] whitespace-nowrap",
                tab === t ? "bg-hover text-fg" : "text-muted hover:text-fg",
              )}
            >
              {t}
            </button>
          ))}
        </nav>
        <div className="min-w-0 flex-1">
          {!draft || !profile ? (
            <div className="space-y-3">
              <Skeleton className="h-9" />
              <Skeleton className="h-9" />
            </div>
          ) : tab === "Compte" ? (
            <AccountTab email={profile.email} displayName={profile.display_name ?? ""} />
          ) : tab === "E-mail" ? (
            <EmailTab s={draft.email} update={(p) => update("email", p)} />
          ) : tab === "Audio" ? (
            <AudioTab s={draft.audio} update={(p) => update("audio", p)} />
          ) : tab === "Apparence" ? (
            <AppearanceTab s={draft.appearance} update={(p) => update("appearance", p)} />
          ) : tab === "Tags" ? (
            <TagsTab />
          ) : (
            <StorageTab />
          )}
        </div>
      </div>
    </div>
  );
}

function Card({ title, children, description }: { title: string; description?: string; children: React.ReactNode }) {
  return (
    <section className="border-line bg-panel mb-6 rounded-2xl border p-5">
      <h2 className="text-[14px] font-semibold">{title}</h2>
      {description ? <p className="text-muted mt-0.5 text-[13px]">{description}</p> : null}
      <div className="mt-4 space-y-4">{children}</div>
    </section>
  );
}

function AccountTab({ email, displayName }: { email: string; displayName: string }) {
  const [name, setName] = useState(displayName);
  return (
    <>
      <Card title="Compte">
        <Field label="E-mail du propriétaire" hint="Défini par OWNER_EMAIL sur le serveur.">
          <Input value={email} readOnly className="text-muted" />
        </Field>
        <Field label="Nom affiché">
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            onBlur={() =>
              name !== displayName &&
              saveProfile({ display_name: name.trim() || null }).then(() => toast.success("Enregistré"))
            }
          />
        </Field>
      </Card>
    </>
  );
}

function EmailTab({ s, update }: { s: Settings["email"]; update: (p: Partial<Settings["email"]>) => void }) {
  const { data: status } = useQuery({
    queryKey: ["email-status"],
    queryFn: async () =>
      (await fetch("/api/email/status")).json() as Promise<{
        configured: boolean;
        from: string | null;
        appUrl: string | null;
      }>,
  });
  return (
    <>
      {status ? (
        status.configured ? (
          <div className="border-ok/30 bg-ok/5 mb-6 flex items-start gap-2.5 rounded-xl border px-4 py-3 text-[13px]">
            <CheckCircle2 className="text-ok mt-0.5 size-4 shrink-0" />
            <div>
              Envoi via Resend depuis <span className="font-mono">{status.from}</span>
              {!status.appUrl ? (
                <p className="text-muted mt-0.5 text-xs">
                  Astuce : définis NEXT_PUBLIC_APP_URL pour que les liens des e-mails pointent vers ton domaine public.
                </p>
              ) : null}
            </div>
          </div>
        ) : (
          <div className="border-accent/30 bg-accent/5 mb-6 flex items-start gap-2.5 rounded-xl border px-4 py-3 text-[13px]">
            <AlertTriangle className="text-accent mt-0.5 size-4 shrink-0" />
            <div>
              L&apos;e-mail n&apos;est pas encore configuré. Ajoute <span className="font-mono">RESEND_API_KEY</span>{" "}
              and <span className="font-mono">RESEND_FROM_EMAIL</span> aux variables d&apos;environnement du serveur.
            </div>
          </div>
        )
      ) : null}
      <Card title="Expéditeur" description="Comment tes e-mails apparaissent aux destinataires.">
        <Field label="Nom de l'expéditeur" hint="ex. Tanguy — affiché comme nom de l'expéditeur">
          <Input value={s.fromName} onChange={(e) => update({ fromName: e.target.value })} placeholder="Tanguy" />
        </Field>
        <Field label="Adresse de réponse" hint="Les réponses arrivent ici. Par défaut : l'e-mail de ton compte.">
          <Input
            type="email"
            value={s.replyTo}
            onChange={(e) => update({ replyTo: e.target.value })}
            placeholder="toi@gmail.com"
          />
        </Field>
      </Card>
      <Card title="Message">
        <Field label="Message par défaut">
          <Textarea value={s.defaultMessage} onChange={(e) => update({ defaultMessage: e.target.value })} rows={4} />
        </Field>
        <Field label="Signature" hint="Placée au-dessus de ton nom à la fin de chaque e-mail.">
          <Textarea value={s.signature} onChange={(e) => update({ signature: e.target.value })} rows={2} />
        </Field>
      </Card>
    </>
  );
}

function AudioTab({ s, update }: { s: Settings["audio"]; update: (p: Partial<Settings["audio"]>) => void }) {
  return (
    <Card title="Lecture">
      <Field label={`Volume par défaut — ${Math.round(s.defaultVolume * 100)} %`}>
        <Slider
          label="Volume par défaut"
          value={s.defaultVolume}
          onChange={(v) => {
            update({ defaultVolume: v });
            usePlayer.getState().setVolume(v);
          }}
        />
      </Field>
      <label className="flex items-center justify-between gap-4">
        <span>
          <span className="block text-[13px]">Lecture automatique</span>
          <span className="text-faint block text-xs">Passer au morceau suivant de la liste à la fin d’un morceau.</span>
        </span>
        <Switch checked={s.autoplay} onChange={(v) => update({ autoplay: v })} label="Lecture automatique" />
      </label>
      <Field label="Vitesse de lecture par défaut">
        <div className="flex gap-1">
          {[0.75, 0.9, 1, 1.1, 1.25].map((r) => (
            <button
              key={r}
              onClick={() => {
                update({ defaultSpeed: r });
                usePlayer.getState().setRate(r);
              }}
              className={cn(
                "flex-1 rounded-md py-1.5 font-mono text-xs",
                s.defaultSpeed === r ? "bg-fg text-bg" : "bg-hover text-muted hover:text-fg",
              )}
            >
              {r}×
            </button>
          ))}
        </div>
      </Field>
    </Card>
  );
}

function AppearanceTab({
  s,
  update,
}: {
  s: Settings["appearance"];
  update: (p: Partial<Settings["appearance"]>) => void;
}) {
  return (
    <Card title="Apparence" description="CREATE est sombre par conception. Choisis ta couleur d'accent.">
      <Field label="Accent">
        <div className="flex gap-2">
          {ACCENTS.map((a) => (
            <button
              key={a.id}
              onClick={() => {
                update({ accent: a.id });
                document.documentElement.dataset.accent = a.id;
              }}
              className={cn(
                "ring-offset-panel grid size-9 place-items-center rounded-full ring-offset-2",
                s.accent === a.id && "ring-fg ring-2",
              )}
              style={{ background: a.color }}
              aria-label={a.id}
            >
              {s.accent === a.id ? <Check className="size-4 text-black" /> : null}
            </button>
          ))}
        </div>
      </Field>
    </Card>
  );
}

function TagsTab() {
  const { data: tags = [] } = useTags();
  const { data: tracks = [] } = useTracks();
  const [name, setName] = useState("");
  const counts = useMemo(() => {
    const m = new Map<string, number>();
    for (const t of tracks) for (const id of t.tag_ids) m.set(id, (m.get(id) ?? 0) + 1);
    return m;
  }, [tracks]);

  return (
    <Card title="Tags" description="Clique sur une couleur pour la changer, sur un nom pour le renommer.">
      <form
        className="flex gap-2"
        onSubmit={async (e) => {
          e.preventDefault();
          if (!name.trim()) return;
          try {
            await createTag(name);
            setName("");
          } catch (err) {
            toast.error(errorMessage(err));
          }
        }}
      >
        <Input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Nouveau tag — Trap, Dark, Mélodique…"
        />
        <Button type="submit" disabled={!name.trim()}>
          Ajouter
        </Button>
      </form>
      {tags.length ? (
        <ul className="divide-line border-line divide-y rounded-xl border">
          {tags.map((t) => (
            <li key={t.id} className="group flex items-center gap-3 px-3 py-2">
              <button
                onClick={() => {
                  const i = TAG_COLORS.indexOf(t.color ?? "");
                  void updateTag(t.id, { color: TAG_COLORS[(i + 1) % TAG_COLORS.length] });
                }}
                className="size-3.5 rounded-full"
                style={{ background: t.color ?? "var(--muted)" }}
                aria-label="Changer la couleur"
              />
              <input
                defaultValue={t.name}
                onBlur={(e) => {
                  const v = e.target.value.trim();
                  if (v && v !== t.name)
                    void updateTag(t.id, { name: v }).catch((err) => toast.error(errorMessage(err)));
                  else e.target.value = t.name;
                }}
                onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
                className="focus:bg-hover min-w-0 flex-1 rounded bg-transparent px-1 text-[13px] outline-none"
              />
              <span className="text-faint text-xs">{counts.get(t.id) ?? 0}</span>
              <button
                onClick={async () => {
                  if (
                    await confirm({
                      title: `Supprimer le tag « ${t.name} » ?`,
                      body: "Il sera retiré de tous les morceaux.",
                      confirmLabel: "Supprimer",
                      danger: true,
                    })
                  )
                    await deleteTag(t.id).catch((err) => toast.error(errorMessage(err)));
                }}
                className="text-faint hover:text-danger rounded p-1 opacity-0 group-hover:opacity-100 max-md:opacity-100"
                aria-label={`Supprimer ${t.name}`}
              >
                <Trash2 className="size-3.5" />
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-faint text-[13px]">Aucun tag pour l’instant.</p>
      )}
    </Card>
  );
}

function StorageTab() {
  const { data, isLoading } = useStorageUsage();
  const { data: tracks = [] } = useTracks();
  if (isLoading || !data) return <Skeleton className="h-40" />;
  const total = data.audio + data.stems;
  return (
    <Card
      title="Stockage"
      description="Bucket Supabase privé « media ». L'audio n'est jamais public : chaque fichier est servi via des URL signées temporaires."
    >
      <p className="text-3xl font-semibold tracking-tight">{formatBytes(total)}</p>
      <div className="bg-active flex h-2 overflow-hidden rounded-full">
        <div className="bg-accent" style={{ width: `${total ? (data.audio / total) * 100 : 0}%` }} />
        <div className="bg-fg/50" style={{ width: `${total ? (data.stems / total) * 100 : 0}%` }} />
      </div>
      <dl className="grid grid-cols-2 gap-3 text-[13px] sm:grid-cols-4">
        <div>
          <dt className="text-muted">Morceaux</dt>
          <dd className="font-medium">{tracks.length}</dd>
        </div>
        <div>
          <dt className="text-muted">Audio ({data.versions} fichiers)</dt>
          <dd className="font-medium">{formatBytes(data.audio)}</dd>
        </div>
        <div>
          <dt className="text-muted">Stems ({data.stemCount})</dt>
          <dd className="font-medium">{formatBytes(data.stems)}</dd>
        </div>
        <div>
          <dt className="text-muted">Aperçus MP3</dt>
          <dd className="font-medium">non comptés</dd>
        </div>
      </dl>
      <p className="text-faint text-xs">
        Le plan gratuit Supabase inclut 1 Go de stockage et 50 Mo max par fichier ; le plan Pro inclut 100 Go et permet
        de relever la limite par fichier (dans les réglages Storage).
      </p>
    </Card>
  );
}
