"use client";

import {
  ArrowLeft,
  Check,
  Copy,
  Eye,
  EyeOff,
  Headphones,
  Link2,
  Lock,
  Mail,
  MoreHorizontal,
  Pencil,
  Plus,
  Send,
  Trash2,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Cover } from "@/components/ui/cover";
import { Dialog } from "@/components/ui/dialog";
import { Checkbox, Input, Kbd, Label, Textarea } from "@/components/ui/input";
import { DropdownMenu } from "@/components/ui/menu";
import { Spinner } from "@/components/ui/spinner";
import { getQueryClient, qk } from "@/lib/data/client";
import { useProfile, useProjects, useSends } from "@/lib/data/library";
import {
  createProjectShare,
  deleteProjectShare,
  isExpired,
  projectShareUrl,
  updateProjectShare,
  useProjectShares,
  type ShareForm,
} from "@/lib/data/project-shares";
import { useTracks } from "@/lib/data/tracks";
import { renderProjectEmail } from "@/lib/email/template";
import type { Project, ProjectShare } from "@/lib/types";
import { confirm } from "@/lib/ui-store";
import { shareDbError } from "@/lib/project-share-input";
import { cn, errorMessage, relativeDate, shortDate } from "@/lib/utils";

type View =
  | { name: "links" }
  | { name: "form"; share: ProjectShare | null }
  | { name: "created"; share: ProjectShare }
  | { name: "email"; shareId: string | null };

const EXPIRY = [
  { id: "never", label: "Jamais", hours: 0 },
  { id: "24h", label: "24 heures", hours: 24 },
  { id: "7d", label: "7 jours", hours: 24 * 7 },
  { id: "30d", label: "30 jours", hours: 24 * 30 },
  { id: "custom", label: "Personnalisée", hours: -1 },
] as const;
type ExpiryId = (typeof EXPIRY)[number]["id"];

async function copy(text: string) {
  await navigator.clipboard.writeText(text);
  toast.success("Lien copié", { description: text });
}

function expiryText(s: ProjectShare) {
  if (!s.expires_at) return "N’expire jamais";
  if (isExpired(s)) return `Expiré le ${shortDate(s.expires_at)}`;
  return `Expire le ${shortDate(s.expires_at)}`;
}

function permsText(
  s: Pick<ProjectShare, "allow_streaming" | "allow_mp3_download" | "allow_wav_download" | "allow_stems_download">,
) {
  return [
    s.allow_streaming && "Écoute",
    s.allow_mp3_download && "MP3",
    s.allow_wav_download && "WAV",
    s.allow_stems_download && "Stems",
  ].filter(Boolean) as string[];
}

export function ProjectShareDialog({
  projectId,
  initialView,
  onClose,
}: {
  projectId: string;
  initialView?: "email";
  onClose: () => void;
}) {
  const { data: projects = [] } = useProjects();
  const { data: tracks = [] } = useTracks();
  const { data: shares, isLoading, error: sharesError } = useProjectShares(projectId);
  const project = projects.find((p) => p.id === projectId);
  const trackCount = useMemo(
    () => tracks.filter((t) => t.project_id === projectId && t.file_path).length,
    [tracks, projectId],
  );
  const [view, setView] = useState<View | null>(initialView === "email" ? { name: "email", shareId: null } : null);
  // First visit: no link yet → go straight to the creation form.
  const current: View = view ?? (shares && shares.length === 0 ? { name: "form", share: null } : { name: "links" });

  if (!project) return null;

  const header = (
    <div className="border-line mb-4 flex items-center gap-3 rounded-xl border p-2.5">
      <Cover path={project.cover_path} seed={project.id} className="size-11" />
      <div className="min-w-0">
        <p className="truncate text-[14px] font-semibold">{project.name}</p>
        <p className="text-muted text-xs">
          {trackCount} production{trackCount > 1 ? "s" : ""}
        </p>
      </div>
    </div>
  );

  const title =
    current.name === "email"
      ? "Envoyer par e-mail"
      : current.name === "form"
        ? current.share
          ? "Modifier le lien"
          : "Nouveau lien de partage"
        : "Partager le projet";

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()} title={title} wide={current.name === "email"}>
      {current.name !== "links" && shares && shares.length > 0 ? (
        <button
          onClick={() => setView({ name: "links" })}
          className="text-muted hover:text-fg mb-3 inline-flex items-center gap-1 text-xs"
        >
          <ArrowLeft className="size-3.5" /> Tous les liens
        </button>
      ) : null}
      {current.name !== "email" ? header : null}

      {sharesError ? (
        <div className="border-danger/40 bg-danger/10 text-danger rounded-xl border px-4 py-3 text-[13px]">
          {shareDbError(errorMessage(sharesError))}
        </div>
      ) : isLoading && !view ? (
        <div className="flex h-40 items-center justify-center">
          <Spinner />
        </div>
      ) : current.name === "links" ? (
        <LinksView shares={shares ?? []} onView={setView} />
      ) : current.name === "form" ? (
        <ShareFormView
          projectId={projectId}
          share={current.share}
          onCancel={() => (shares?.length ? setView({ name: "links" }) : onClose())}
          onSaved={(s, created) => setView(created ? { name: "created", share: s } : { name: "links" })}
        />
      ) : current.name === "created" ? (
        <CreatedView
          share={current.share}
          onEmail={() => setView({ name: "email", shareId: current.share.id })}
          onDone={onClose}
        />
      ) : (
        <EmailView
          project={project}
          trackCount={trackCount}
          shares={shares ?? []}
          initialShareId={current.shareId}
          onSent={onClose}
        />
      )}
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Existing links
// ---------------------------------------------------------------------------

function LinksView({ shares, onView }: { shares: ProjectShare[]; onView: (v: View) => void }) {
  return (
    <div>
      <div className="mb-2 flex items-center justify-between">
        <p className="text-faint text-[11px] font-medium tracking-wider uppercase">Liens partagés</p>
        <Button size="sm" variant="primary" onClick={() => onView({ name: "form", share: null })}>
          <Plus /> Nouveau lien
        </Button>
      </div>
      <ul className="space-y-2">
        {shares.map((s) => {
          const expired = isExpired(s);
          return (
            <li key={s.id} className={cn("border-line rounded-xl border p-3", expired && "opacity-60")}>
              <div className="flex items-start gap-2">
                <div className="min-w-0 flex-1">
                  <p className="flex items-center gap-1.5 truncate text-[13.5px] font-medium">
                    {s.label || "Lien sans nom"}
                    {s.has_password ? (
                      <Lock className="text-muted size-3.5" aria-label="Protégé par mot de passe" />
                    ) : null}
                  </p>
                  <p className={cn("text-xs", expired ? "text-danger" : "text-muted")}>
                    Créé le {shortDate(s.created_at)} · {expiryText(s)}
                  </p>
                </div>
                <Button size="sm" variant="ghost" onClick={() => copy(projectShareUrl(s.token))} disabled={expired}>
                  <Copy /> Copier
                </Button>
                <DropdownMenu
                  entries={[
                    {
                      label: "Envoyer par e-mail",
                      icon: Mail,
                      disabled: expired,
                      onSelect: () => onView({ name: "email", shareId: s.id }),
                    },
                    { label: "Modifier", icon: Pencil, onSelect: () => onView({ name: "form", share: s }) },
                    {
                      label: "Ouvrir la page publique",
                      icon: Link2,
                      disabled: expired,
                      onSelect: () => window.open(projectShareUrl(s.token), "_blank", "noopener"),
                    },
                    { type: "separator" },
                    {
                      label: "Supprimer le lien",
                      icon: Trash2,
                      danger: true,
                      onSelect: async () => {
                        const ok = await confirm({
                          title: "Supprimer ce lien ?",
                          body: "Les personnes qui l’ont reçu ne pourront plus ouvrir le projet.",
                          confirmLabel: "Supprimer",
                          danger: true,
                        });
                        if (ok) await deleteProjectShare(s).catch((e) => toast.error(errorMessage(e)));
                      },
                    },
                  ]}
                  trigger={
                    <button
                      className="text-faint hover:text-fg hover:bg-hover rounded-md p-1.5"
                      aria-label="Options du lien"
                    >
                      <MoreHorizontal className="size-4" />
                    </button>
                  }
                />
              </div>
              <div className="mt-2 flex flex-wrap gap-1">
                {permsText(s).map((p) => (
                  <span key={p} className="bg-hover text-muted rounded-full px-2 py-0.5 text-[11px]">
                    {p}
                  </span>
                ))}
              </div>
              <dl className="border-line mt-2.5 grid grid-cols-4 gap-2 border-t pt-2.5 text-center">
                {[
                  ["Vues", s.view_count],
                  ["Écoutes", s.play_count],
                  ["Téléch.", s.download_count],
                  ["Dernière visite", s.last_viewed_at ? relativeDate(s.last_viewed_at) : "—"],
                ].map(([k, v]) => (
                  <div key={k as string}>
                    <dt className="text-faint text-[10px] tracking-wide uppercase">{k}</dt>
                    <dd className="truncate text-[13px] font-medium">{v}</dd>
                  </div>
                ))}
              </dl>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Create / edit
// ---------------------------------------------------------------------------

function initialExpiry(share: ProjectShare | null): { id: ExpiryId; custom: string } {
  if (!share?.expires_at) return { id: "never", custom: "" };
  return { id: "custom", custom: share.expires_at.slice(0, 10) };
}

function ShareFormView({
  projectId,
  share,
  onCancel,
  onSaved,
}: {
  projectId: string;
  share: ProjectShare | null;
  onCancel: () => void;
  onSaved: (s: ProjectShare, created: boolean) => void;
}) {
  const [label, setLabel] = useState(share?.label ?? "");
  const [perms, setPerms] = useState({
    allow_streaming: share?.allow_streaming ?? true,
    allow_mp3_download: share?.allow_mp3_download ?? true,
    allow_wav_download: share?.allow_wav_download ?? false,
    allow_stems_download: share?.allow_stems_download ?? false,
  });
  const init = initialExpiry(share);
  const [expiry, setExpiry] = useState<ExpiryId>(init.id);
  const [customDate, setCustomDate] = useState(init.custom);
  const [protect, setProtect] = useState(share?.has_password ?? false);
  const [password, setPassword] = useState("");
  const [showPw, setShowPw] = useState(false);
  const [minDate] = useState(() => new Date(Date.now() + 86_400_000).toISOString().slice(0, 10));
  const [busy, setBusy] = useState(false);

  const nothing = !Object.values(perms).some(Boolean);
  const needsPassword = protect && !share?.has_password && password.length < 4;

  const submit = async () => {
    if (nothing || needsPassword) return;
    let expires_at: string | null = null;
    const opt = EXPIRY.find((e) => e.id === expiry)!;
    if (opt.hours > 0) expires_at = new Date(Date.now() + opt.hours * 3600_000).toISOString();
    if (opt.id === "custom") {
      if (!customDate) return toast.error("Choisis une date d’expiration");
      expires_at = new Date(`${customDate}T23:59:59`).toISOString();
      if (new Date(expires_at) <= new Date()) return toast.error("La date d’expiration doit être dans le futur");
    }
    // Editing: keep the existing expiry unless the user picked something else.
    if (share && expiry === init.id && customDate === init.custom) expires_at = share.expires_at;

    const form: ShareForm = { label: label.trim(), ...perms, expires_at };
    if (!protect) form.password = share?.has_password || !share ? null : undefined;
    else if (password) form.password = password;
    else if (!share) form.password = null;

    setBusy(true);
    try {
      const saved = share ? await updateProjectShare(share, form) : await createProjectShare(projectId, form);
      if (share) toast.success("Lien mis à jour");
      onSaved(saved, !share);
    } catch (e) {
      toast.error(share ? "Modification impossible" : "Création impossible", { description: errorMessage(e) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
      className="space-y-5"
    >
      <div>
        <Label htmlFor="share-label">Nom du lien</Label>
        <Input
          id="share-label"
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          placeholder="Artiste A, Label…"
        />
        <p className="text-faint mt-1 text-xs">Pour t’y retrouver : visible uniquement par toi.</p>
      </div>

      <fieldset>
        <legend className="text-muted mb-2 text-xs font-medium">Permissions</legend>
        <div className="border-line grid gap-2.5 rounded-xl border p-3 sm:grid-cols-2">
          <Checkbox
            checked={perms.allow_streaming}
            onChange={(v) => setPerms((p) => ({ ...p, allow_streaming: v }))}
            label="Écoute"
          />
          <Checkbox
            checked={perms.allow_mp3_download}
            onChange={(v) => setPerms((p) => ({ ...p, allow_mp3_download: v }))}
            label="Télécharger les MP3"
          />
          <Checkbox
            checked={perms.allow_wav_download}
            onChange={(v) => setPerms((p) => ({ ...p, allow_wav_download: v }))}
            label="Télécharger les WAV"
          />
          <Checkbox
            checked={perms.allow_stems_download}
            onChange={(v) => setPerms((p) => ({ ...p, allow_stems_download: v }))}
            label="Télécharger les stems"
          />
        </div>
        {nothing ? <p className="text-danger mt-1 text-xs">Autorise au moins l’écoute ou un téléchargement.</p> : null}
      </fieldset>

      <fieldset>
        <legend className="text-muted mb-2 text-xs font-medium">Expiration du lien</legend>
        <div className="flex flex-wrap gap-1.5">
          {EXPIRY.map((e) => (
            <button
              key={e.id}
              type="button"
              onClick={() => setExpiry(e.id)}
              className={cn(
                "rounded-full border px-3 py-1 text-xs",
                expiry === e.id ? "border-accent bg-accent/15 text-fg" : "border-line-strong text-muted hover:text-fg",
              )}
            >
              {e.label}
            </button>
          ))}
        </div>
        {expiry === "custom" ? (
          <Input
            type="date"
            value={customDate}
            min={minDate}
            onChange={(e) => setCustomDate(e.target.value)}
            className="mt-2 w-48"
          />
        ) : null}
      </fieldset>

      <div>
        <Checkbox
          checked={protect}
          onChange={setProtect}
          label="Protéger par mot de passe"
          description={share?.has_password && protect ? "Laisse vide pour garder le mot de passe actuel." : undefined}
        />
        {protect ? (
          <div className="relative mt-2">
            <Input
              type={showPw ? "text" : "password"}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder={
                share?.has_password ? "Nouveau mot de passe (facultatif)" : "Mot de passe (4 caractères min.)"
              }
              autoComplete="new-password"
              className="pr-9"
            />
            <button
              type="button"
              onClick={() => setShowPw((v) => !v)}
              className="text-faint hover:text-fg absolute top-2.5 right-2.5"
              aria-label={showPw ? "Masquer" : "Afficher"}
            >
              {showPw ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
            </button>
          </div>
        ) : null}
      </div>

      <div className="border-line flex justify-end gap-2 border-t pt-4">
        <Button variant="ghost" onClick={onCancel}>
          Annuler
        </Button>
        <Button type="submit" variant="primary" loading={busy} disabled={nothing || needsPassword}>
          {share ? "Enregistrer" : "Créer le lien"}
        </Button>
      </div>
    </form>
  );
}

function CreatedView({ share, onEmail, onDone }: { share: ProjectShare; onEmail: () => void; onDone: () => void }) {
  const url = projectShareUrl(share.token);
  const [copied, setCopied] = useState(false);
  return (
    <div>
      <p className="text-ok mb-2 flex items-center gap-1.5 text-[13px]">
        <Check className="size-4" /> Lien créé
      </p>
      <div className="flex gap-2">
        <Input readOnly value={url} onFocus={(e) => e.currentTarget.select()} className="font-mono text-xs" />
        <Button
          variant="primary"
          className="w-28"
          onClick={async () => {
            await navigator.clipboard.writeText(url);
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
          }}
        >
          {copied ? <Check /> : <Copy />} {copied ? "Copié" : "Copier"}
        </Button>
      </div>
      <p className="text-muted mt-2 text-xs">
        {permsText(share).join(" · ")} · {expiryText(share)}
        {share.has_password ? " · protégé par mot de passe" : ""}
      </p>
      <div className="border-line mt-5 flex justify-end gap-2 border-t pt-4">
        <Button variant="ghost" onClick={onEmail}>
          <Mail /> Envoyer par e-mail
        </Button>
        <Button variant="primary" onClick={onDone}>
          Terminé
        </Button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Email
// ---------------------------------------------------------------------------

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function EmailView({
  project,
  trackCount,
  shares,
  initialShareId,
  onSent,
}: {
  project: Project;
  trackCount: number;
  shares: ProjectShare[];
  initialShareId: string | null;
  onSent: () => void;
}) {
  const router = useRouter();
  const { data: profile } = useProfile();
  const { data: sends = [] } = useSends();
  const { data: tracks = [] } = useTracks();
  const usable = shares.filter((s) => !isExpired(s));
  const [shareId, setShareId] = useState<string | null>(initialShareId ?? usable[0]?.id ?? null);
  const [to, setTo] = useState("");
  const [subject, setSubject] = useState(`Nouvelles prods — ${project.name}`);
  const [message, setMessage] = useState(() => profile?.settings.email.defaultMessage ?? "");
  const [preview, setPreview] = useState(false);
  const [sending, setSending] = useState(false);

  const share = usable.find((s) => s.id === shareId) ?? null;
  const recipients = to
    .split(/[,;\s]+/)
    .map((x) => x.trim())
    .filter(Boolean);
  const invalid = recipients.filter((r) => !EMAIL_RE.test(r));
  const pastRecipients = useMemo(() => [...new Set(sends.map((s) => s.recipient))].slice(0, 50), [sends]);
  const titles = useMemo(
    () =>
      tracks
        .filter((t) => t.project_id === project.id && t.file_path)
        .sort((a, b) => a.created_at.localeCompare(b.created_at))
        .map((t) => t.title),
    [tracks, project.id],
  );
  const canSend = recipients.length > 0 && !invalid.length && subject.trim() && !sending;

  const previewHtml = preview ? emailPreview() : "";

  function emailPreview() {
    const sender = profile?.settings.email.fromName || profile?.display_name || "Moi";
    return renderProjectEmail({
      projectName: project.name,
      trackCount,
      trackTitles: titles,
      message,
      signature: profile?.settings.email.signature ?? "",
      senderName: sender,
      listenUrl: share ? projectShareUrl(share.token) : "#",
      passwordProtected: share?.has_password,
    }).html;
  }

  const send = async () => {
    if (!canSend) return;
    setSending(true);
    try {
      // No link yet: create a standard one (listen + MP3, no expiry).
      let target = share;
      if (!target) {
        target = await createProjectShare(project.id, {
          label: recipients.length === 1 ? recipients[0] : "E-mail",
          allow_streaming: true,
          allow_mp3_download: true,
          allow_wav_download: false,
          allow_stems_download: false,
          expires_at: null,
          password: null,
        });
      }
      const res = await fetch("/api/email/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ shareId: target.id, recipients, subject: subject.trim(), message }),
      });
      const json = (await res.json().catch(() => ({}))) as {
        error?: string;
        results?: { recipient: string; ok: boolean; error?: string }[];
      };
      if (!res.ok) throw new Error(json.error ?? `Échec de l'envoi (${res.status})`);
      const failed = json.results?.filter((r) => !r.ok) ?? [];
      const okCount = (json.results?.length ?? 0) - failed.length;
      toast.success(okCount === 1 ? `Envoyé à ${recipients[0]}` : `Envoyé à ${okCount} destinataires`, {
        description: project.name,
        action: { label: "Voir", onClick: () => router.push("/sent") },
      });
      if (failed.length)
        toast.error(`Échec : ${failed.map((f) => f.recipient).join(", ")}`, { description: failed[0].error });
      void getQueryClient().invalidateQueries({ queryKey: qk.sends });
      onSent();
    } catch (e) {
      toast.error("E-mail non envoyé", { description: errorMessage(e) });
    } finally {
      setSending(false);
    }
  };

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        void send();
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
          e.preventDefault();
          void send();
        }
      }}
      className={cn("grid gap-4", preview && "md:grid-cols-2")}
    >
      <div className="space-y-3.5">
        <div>
          <Label htmlFor="pe-to">Destinataire</Label>
          <Input
            id="pe-to"
            data-autofocus
            inputMode="email"
            list="pe-recipients"
            placeholder="artiste@exemple.com"
            value={to}
            onChange={(e) => setTo(e.target.value)}
            className={cn(invalid.length && to && "border-danger/60")}
          />
          <datalist id="pe-recipients">
            {pastRecipients.map((r) => (
              <option key={r} value={r} />
            ))}
          </datalist>
          {invalid.length && to ? <p className="text-danger mt-1 text-xs">Invalide : {invalid.join(", ")}</p> : null}
        </div>
        <div>
          <Label htmlFor="pe-subject">Objet</Label>
          <Input id="pe-subject" value={subject} onChange={(e) => setSubject(e.target.value)} />
        </div>
        <div>
          <Label htmlFor="pe-message">Message</Label>
          <Textarea id="pe-message" value={message} onChange={(e) => setMessage(e.target.value)} rows={4} />
        </div>

        <div className="border-line rounded-xl border p-3">
          <div className="flex items-center gap-3">
            <Cover path={project.cover_path} seed={project.id} className="size-10" />
            <div className="min-w-0 flex-1">
              <p className="text-faint text-[10px] tracking-wider uppercase">Projet</p>
              <p className="truncate text-[13.5px] font-semibold">{project.name}</p>
              <p className="text-muted text-xs">
                {trackCount} production{trackCount > 1 ? "s" : ""}
              </p>
            </div>
          </div>
          <div className="border-line mt-3 border-t pt-3">
            {usable.length > 1 ? (
              <select
                value={shareId ?? ""}
                onChange={(e) => setShareId(e.target.value)}
                className="border-line bg-raised mb-2 h-8 w-full rounded-lg border px-2 text-[13px] outline-none"
                aria-label="Lien à envoyer"
              >
                {usable.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.label || "Lien sans nom"} — {permsText(s).join(", ")}
                  </option>
                ))}
              </select>
            ) : null}
            <p className="text-muted flex items-center gap-1.5 truncate font-mono text-[11.5px]">
              <Link2 className="size-3.5 shrink-0" />
              {share ? projectShareUrl(share.token) : "Un lien (écoute + MP3, sans expiration) sera créé à l’envoi"}
            </p>
            {share ? (
              <p className="text-faint mt-1 flex items-center gap-1.5 text-[11px]">
                <Headphones className="size-3" /> {permsText(share).join(" · ")} · {expiryText(share)}
                {share.has_password ? " · mot de passe (à communiquer séparément)" : ""}
              </p>
            ) : null}
          </div>
        </div>

        <div className="flex items-center justify-between gap-2 pt-1">
          <button
            type="button"
            onClick={() => setPreview((p) => !p)}
            className="text-muted hover:text-fg inline-flex items-center gap-1.5 text-[13px]"
          >
            {preview ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
            {preview ? "Masquer l’aperçu" : "Aperçu"}
          </button>
          <div className="flex items-center gap-2">
            <span className="text-faint hidden items-center gap-1 text-[11px] sm:flex">
              <Kbd>Ctrl</Kbd>
              <Kbd>↵</Kbd>
            </span>
            <Button type="submit" variant="primary" disabled={!canSend} loading={sending}>
              {!sending ? <Send /> : null} Envoyer
            </Button>
          </div>
        </div>
      </div>
      {preview ? (
        <div className="border-line overflow-hidden rounded-xl border bg-white max-md:h-96">
          <iframe title="Aperçu de l’e-mail" srcDoc={previewHtml} sandbox="" className="h-full min-h-[460px] w-full" />
        </div>
      ) : null}
    </form>
  );
}
