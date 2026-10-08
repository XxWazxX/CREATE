import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatDuration(seconds: number | null | undefined): string {
  if (seconds == null || !Number.isFinite(seconds)) return "–:––";
  const s = Math.max(0, Math.floor(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = String(s % 60).padStart(2, "0");
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${sec}` : `${m}:${sec}`;
}

export function formatBytes(bytes: number | null | undefined): string {
  if (!bytes) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
  const v = bytes / Math.pow(1024, i);
  return `${v >= 100 || i === 0 ? Math.round(v) : v.toFixed(1)} ${units[i]}`;
}

export function formatBpm(bpm: number | null | undefined): string {
  if (bpm == null) return "";
  const n = Number(bpm);
  return Number.isInteger(n) ? String(n) : n.toFixed(1);
}

const rtf = typeof Intl !== "undefined" ? new Intl.RelativeTimeFormat("fr", { numeric: "auto" }) : null;

export function relativeDate(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  const diff = (d.getTime() - Date.now()) / 1000;
  const abs = Math.abs(diff);
  if (!rtf) return d.toLocaleDateString("fr-FR");
  if (abs < 60) return "à l'instant";
  if (abs < 3600) return rtf.format(Math.round(diff / 60), "minute");
  if (abs < 86400) return rtf.format(Math.round(diff / 3600), "hour");
  if (abs < 86400 * 7) return rtf.format(Math.round(diff / 86400), "day");
  return d.toLocaleDateString("fr-FR", {
    day: "numeric",
    month: "short",
    year: d.getFullYear() === new Date().getFullYear() ? undefined : "numeric",
  });
}

export function shortDate(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  return d.toLocaleDateString("fr-FR", {
    day: "numeric",
    month: "short",
    year: d.getFullYear() === new Date().getFullYear() ? undefined : "numeric",
  });
}

export function fileExtension(name: string): string {
  const i = name.lastIndexOf(".");
  return i >= 0 ? name.slice(i + 1).toLowerCase() : "";
}

export function stripExtension(name: string): string {
  const i = name.lastIndexOf(".");
  return i > 0 ? name.slice(0, i) : name;
}

/** "midnight_drive-final_v2" -> "Midnight Drive Final V2" */
export function titleFromFilename(name: string): string {
  const base = stripExtension(name).replace(/[_]+/g, " ").replace(/\s+/g, " ").trim();
  return base || name;
}

export const AUDIO_EXTENSIONS = ["wav", "mp3", "aif", "aiff", "m4a", "flac", "ogg", "aac"] as const;

export const AUDIO_MIME: Record<string, string> = {
  wav: "audio/wav",
  mp3: "audio/mpeg",
  aif: "audio/aiff",
  aiff: "audio/aiff",
  m4a: "audio/mp4",
  aac: "audio/aac",
  flac: "audio/flac",
  ogg: "audio/ogg",
};

export function isAudioFile(file: File): boolean {
  return (AUDIO_EXTENSIONS as readonly string[]).includes(fileExtension(file.name)) || file.type.startsWith("audio/");
}

export function audioMime(file: File): string {
  return AUDIO_MIME[fileExtension(file.name)] ?? (file.type || "application/octet-stream");
}

/** Lossless formats that deserve an MP3 preview for fast streaming. */
export function isLossless(mime: string | null | undefined): boolean {
  return !!mime && /(wav|aiff|flac|x-aiff)/.test(mime);
}

export function hashString(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export function randomToken(bytes = 24): string {
  const arr = new Uint8Array(bytes);
  crypto.getRandomValues(arr);
  let bin = "";
  arr.forEach((b) => (bin += String.fromCharCode(b)));
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function isTypingTarget(el: EventTarget | null): boolean {
  if (!(el instanceof HTMLElement)) return false;
  const tag = el.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || el.isContentEditable;
}

export function errorMessage(e: unknown): string {
  if (e instanceof Error) return e.message;
  if (typeof e === "object" && e && "message" in e) return String((e as { message: unknown }).message);
  return String(e);
}

export function safeFilename(name: string): string {
  return name.replace(/[\\/:*?"<>|]+/g, "-").trim() || "track";
}
