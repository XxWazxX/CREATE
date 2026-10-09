"use client";

import { Check, ChevronDown, Plus, Search, Upload, X, AlertCircle } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { DropdownMenu } from "@/components/ui/menu";
import { Spinner } from "@/components/ui/spinner";
import { useProfile, useProjects } from "@/lib/data/library";
import { toggleFavorite } from "@/lib/data/tracks";
import { hasType } from "@/lib/dnd";
import { usePlayer } from "@/lib/player/store";
import { findTrack } from "@/lib/track-actions";
import { useUI } from "@/lib/ui-store";
import { pickAndImport } from "@/lib/upload/pick";
import { importFiles, useUploads } from "@/lib/upload/uploads";
import { cn, errorMessage, isTypingTarget } from "@/lib/utils";
import { isActive, Logo, NAV, useAddMenu } from "./sidebar";

// ---------------------------------------------------------------------------
// Drop audio files anywhere to upload (into the open project, if any)
// ---------------------------------------------------------------------------

export function GlobalDropzone() {
  const [visible, setVisible] = useState(false);
  const depth = useRef(0);
  const pathname = usePathname();
  const { data: projects = [] } = useProjects();
  const projectId = pathname.startsWith("/projects/") ? pathname.split("/")[2] : null;
  const project = projects.find((p) => p.id === projectId);
  // A track's folder page (/library/{id}) takes its own drops (Prod / Stems / Session).
  const folderPage = pathname.startsWith("/library/");

  useEffect(() => {
    const isFiles = (e: DragEvent) => !folderPage && hasType(e, "Files");
    const enter = (e: DragEvent) => {
      if (!isFiles(e)) return;
      depth.current++;
      setVisible(true);
    };
    const leave = (e: DragEvent) => {
      if (!isFiles(e)) return;
      depth.current = Math.max(0, depth.current - 1);
      if (depth.current === 0) setVisible(false);
    };
    const over = (e: DragEvent) => {
      if (isFiles(e)) e.preventDefault();
    };
    const drop = (e: DragEvent) => {
      if (!isFiles(e)) return;
      e.preventDefault();
      depth.current = 0;
      setVisible(false);
      // Drops on sidebar projects are handled (and stopped) there.
      const files = Array.from(e.dataTransfer?.files ?? []);
      if (files.length) void importFiles(files, { projectId }).catch((err) => toast.error(errorMessage(err)));
    };
    // Capture phase: a drop handled (and stopped) by a zone inside the page still closes the overlay.
    const reset = () => {
      depth.current = 0;
      setVisible(false);
    };
    window.addEventListener("drop", reset, true);
    window.addEventListener("dragenter", enter);
    window.addEventListener("dragleave", leave);
    window.addEventListener("dragover", over);
    window.addEventListener("drop", drop);
    return () => {
      window.removeEventListener("dragenter", enter);
      window.removeEventListener("dragleave", leave);
      window.removeEventListener("dragover", over);
      window.removeEventListener("drop", drop);
      window.removeEventListener("drop", reset, true);
    };
  }, [projectId, folderPage]);

  if (!visible) return null;
  return (
    <div className="bg-bg/80 animate-in pointer-events-none fixed inset-0 z-[70] grid place-items-center backdrop-blur-sm">
      <div className="border-accent/60 flex flex-col items-center gap-3 rounded-3xl border-2 border-dashed px-16 py-12 text-center">
        <Upload className="text-accent size-8" />
        <p className="text-lg font-medium">Déposer pour importer</p>
        <p className="text-muted text-[13px]">
          {project ? (
            <>
              Dans <span className="text-fg">{project.name}</span>
            </>
          ) : (
            "WAV, MP3, AIFF, M4A, FLAC"
          )}
        </p>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Upload progress panel
// ---------------------------------------------------------------------------

export function UploadPanel() {
  const jobs = useUploads((s) => s.jobs);
  const clear = useUploads((s) => s.clearFinished);
  const [collapsed, setCollapsed] = useState(false);
  const activeCount = jobs.filter(
    (j) => j.stage === "queued" || j.stage === "uploading" || j.stage === "processing",
  ).length;

  // Auto-hide a few seconds after everything finished cleanly.
  useEffect(() => {
    if (jobs.length && activeCount === 0 && !jobs.some((j) => j.stage === "error")) {
      const t = setTimeout(clear, 4000);
      return () => clearTimeout(t);
    }
  }, [jobs, activeCount, clear]);

  if (!jobs.length) return null;
  const total = jobs.reduce((s, j) => s + (j.stage === "done" ? 1 : j.progress), 0) / jobs.length;

  return (
    <div className="border-line-strong bg-raised animate-up fixed right-4 bottom-[100px] z-40 w-80 overflow-hidden rounded-xl border shadow-2xl max-md:right-3 max-md:bottom-[150px] max-md:left-3 max-md:w-auto">
      <div className="border-line flex items-center gap-2 border-b px-3 py-2.5">
        {activeCount ? <Spinner className="text-accent size-3.5" /> : <Check className="text-ok size-4" />}
        <p className="flex-1 text-[13px] font-medium">
          {activeCount ? `Import de ${activeCount} fichier${activeCount > 1 ? "s" : ""}` : "Imports terminés"}
        </p>
        <button
          onClick={() => setCollapsed((c) => !c)}
          className="text-faint hover:text-fg rounded p-1"
          aria-label="Réduire"
        >
          <ChevronDown className={cn("size-4 transition-transform", collapsed && "rotate-180")} />
        </button>
        {!activeCount ? (
          <button onClick={clear} className="text-faint hover:text-fg rounded p-1" aria-label="Fermer">
            <X className="size-4" />
          </button>
        ) : null}
      </div>
      {activeCount ? (
        <div className="bg-line h-0.5">
          <div className="bg-accent h-full transition-[width]" style={{ width: `${total * 100}%` }} />
        </div>
      ) : null}
      {!collapsed ? (
        <div className="max-h-64 overflow-y-auto p-1.5">
          {jobs.map((j) => (
            <div key={j.id} className="flex items-center gap-2.5 rounded-md px-2 py-1.5">
              <div className="min-w-0 flex-1">
                <p className="truncate text-[12.5px]">{j.name}</p>
                <p className={cn("truncate text-[11px]", j.stage === "error" ? "text-danger" : "text-faint")}>
                  {j.stage === "queued"
                    ? "En attente…"
                    : j.stage === "uploading"
                      ? `${Math.round(j.progress * 100)}%`
                      : j.stage === "processing"
                        ? (j.detail ?? "Traitement")
                        : j.stage === "done"
                          ? j.kind === "stem"
                            ? "Stem prêt"
                            : j.kind === "version"
                              ? "Nouvelle version prête"
                              : "Prêt"
                          : j.stage === "cancelled"
                            ? "Annulé"
                            : j.error}
                </p>
              </div>
              {j.stage === "uploading" && j.abort ? (
                <button onClick={j.abort} className="text-faint hover:text-fg rounded p-1" aria-label="Annuler">
                  <X className="size-3.5" />
                </button>
              ) : j.stage === "done" ? (
                <Check className="text-ok size-3.5" />
              ) : j.stage === "error" ? (
                <AlertCircle className="text-danger size-3.5" />
              ) : j.stage !== "cancelled" ? (
                <Spinner className="text-muted size-3.5" />
              ) : null}
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Keyboard shortcuts
// ---------------------------------------------------------------------------

export function KeyboardShortcuts() {
  const pathname = usePathname();
  const setFocusTrack = useUI((s) => s.setFocusTrack);

  // Leaving a track page clears its focus.
  useEffect(() => {
    if (!pathname.startsWith("/tracks/")) setFocusTrack(null);
  }, [pathname, setFocusTrack]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const ui = useUI.getState();
      const mod = e.metaKey || e.ctrlKey;
      if (mod && e.key.toLowerCase() === "k") {
        e.preventDefault();
        ui.setPalette(!ui.paletteOpen);
        return;
      }
      if (isTypingTarget(e.target) || mod || e.altKey) return;
      if (ui.dialog || ui.paletteOpen || ui.confirmReq) return;
      if (document.querySelector("[role=menu]")) return;

      const player = usePlayer.getState();
      const targetId = ui.focusTrackId ?? player.current?.trackId ?? null;
      const target = targetId ? findTrack(targetId) : undefined;

      switch (e.key) {
        case " ":
          e.preventDefault();
          if (!player.current && target) void player.playTracks([target]);
          else player.toggle();
          break;
        case "ArrowLeft":
          if (e.shiftKey) player.seek(Math.max(0, player.time - 10));
          else player.prev();
          break;
        case "ArrowRight":
          if (e.shiftKey) player.seek(player.time + 10);
          else player.next();
          break;
        case "f":
        case "F":
          if (target) void toggleFavorite(target).catch((err) => toast.error(errorMessage(err)));
          break;
        case "s":
        case "S":
        case "e":
        case "E": {
          // Sharing is per project: the open project, else the project of the selected / playing track.
          const projectId = pathname.startsWith("/projects/") ? pathname.split("/")[2] : (target?.project_id ?? null);
          if (projectId) {
            ui.openDialog({
              type: "project-share",
              projectId,
              view: e.key.toLowerCase() === "e" ? "email" : undefined,
            });
          } else if (target) {
            toast("Le partage se fait par projet", {
              description: "Range ce morceau dans un projet pour le partager.",
            });
          }
          break;
        }
        case "u":
        case "U":
          pickAndImport(pathname.startsWith("/projects/") ? pathname.split("/")[2] : null);
          break;
        case "/":
          e.preventDefault();
          ui.setPalette(true);
          break;
        default:
          return;
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [pathname]);

  return null;
}

// ---------------------------------------------------------------------------
// Settings → document (accent) and player defaults
// ---------------------------------------------------------------------------

export function SettingsSync() {
  const { data: profile } = useProfile();
  const applied = useRef(false);
  useEffect(() => {
    if (!profile) return;
    const { appearance, audio } = profile.settings;
    document.documentElement.dataset.accent = appearance.accent;
    usePlayer.getState().setAutoplay(audio.autoplay);
    if (!applied.current) {
      applied.current = true;
      let hasPrefs = false;
      try {
        hasPrefs = !!localStorage.getItem("crate.player");
      } catch {
        /* ignore */
      }
      if (!hasPrefs) {
        usePlayer.getState().setVolume(audio.defaultVolume);
        usePlayer.getState().setRate(audio.defaultSpeed);
      }
    }
  }, [profile]);
  return null;
}

// ---------------------------------------------------------------------------
// Mobile navigation
// ---------------------------------------------------------------------------

export function MobileTopBar() {
  const setPalette = useUI((s) => s.setPalette);
  const addMenu = useAddMenu();
  return (
    <div className="border-line bg-panel flex h-12 shrink-0 items-center justify-between border-b px-3 pt-[env(safe-area-inset-top)] md:hidden">
      <Link href="/" className="flex items-center gap-2 text-sm font-semibold tracking-[0.18em]">
        <Logo /> CREATE
      </Link>
      <div className="flex items-center gap-1">
        <button
          onClick={() => setPalette(true)}
          className="text-muted grid size-9 place-items-center rounded-lg"
          aria-label="Rechercher"
        >
          <Search className="size-5" />
        </button>
        <DropdownMenu
          entries={addMenu}
          trigger={
            <button className="bg-accent text-accent-fg grid size-9 place-items-center rounded-lg" aria-label="Ajouter">
              <Plus className="size-5" />
            </button>
          }
        />
      </div>
    </div>
  );
}

export function MobileNav() {
  const pathname = usePathname();
  const router = useRouter();
  const items = [NAV[0], NAV[1], NAV[2], NAV[3]];
  const more = [NAV[4], NAV[5], NAV[6], { href: "/settings", label: "Réglages" }];
  return (
    <nav className="border-line bg-panel flex shrink-0 items-stretch border-t pb-[env(safe-area-inset-bottom)] md:hidden">
      {items.map((it) => (
        <Link
          key={it.href}
          href={it.href}
          className={cn(
            "flex flex-1 flex-col items-center gap-0.5 py-2 text-[10px]",
            isActive(pathname, it.href) ? "text-fg" : "text-faint",
          )}
        >
          <it.icon className={cn("size-5", isActive(pathname, it.href) && "text-accent")} />
          {it.label.replace("Ajouts récents", "Récents")}
        </Link>
      ))}
      <DropdownMenu
        entries={more.map((m) => ({ label: m.label, onSelect: () => router.push(m.href) }))}
        trigger={
          <button
            className={cn(
              "flex flex-1 flex-col items-center gap-0.5 py-2 text-[10px]",
              more.some((m) => isActive(pathname, m.href)) ? "text-fg" : "text-faint",
            )}
          >
            <svg viewBox="0 0 20 20" className="size-5" fill="currentColor">
              <circle cx="4" cy="10" r="1.6" />
              <circle cx="10" cy="10" r="1.6" />
              <circle cx="16" cy="10" r="1.6" />
            </svg>
            Plus
          </button>
        }
      />
    </nav>
  );
}
