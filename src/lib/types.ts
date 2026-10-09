import type { StemKind } from "@/lib/music";

export type FileStatus = "uploading" | "processing" | "ready" | "error";

export type Track = {
  id: string;
  user_id: string;
  project_id: string | null;
  parent_track_id: string | null;
  title: string;
  artist: string | null;
  producer: string | null;
  bpm: number | null;
  key: string | null;
  genre: string | null;
  notes: string;
  favorite: boolean;
  favorited_at: string | null;
  cover_path: string | null;
  current_version_id: string | null;
  version_number: number;
  file_path: string | null;
  preview_path: string | null;
  original_filename: string | null;
  file_size: number | null;
  mime_type: string | null;
  duration: number | null;
  status: FileStatus;
  last_played_at: string | null;
  play_count: number;
  deleted_at: string | null;
  created_at: string;
  updated_at: string;
  /** tag ids (joined client-side from track_tags) */
  tag_ids: string[];
};

export type TrackVersion = {
  id: string;
  track_id: string;
  version_number: number;
  label: string;
  file_path: string;
  preview_path: string | null;
  original_filename: string | null;
  file_size: number | null;
  mime_type: string | null;
  duration: number | null;
  peaks: number[] | null;
  bpm: number | null;
  key: string | null;
  notes: string;
  status: FileStatus;
  created_at: string;
  updated_at: string;
};

export type Stem = {
  id: string;
  track_id: string;
  version_id: string | null;
  kind: StemKind;
  name: string;
  file_path: string;
  original_filename: string | null;
  file_size: number | null;
  mime_type: string | null;
  duration: number | null;
  position: number;
  status: "uploading" | "ready" | "error";
  created_at: string;
};

export type Project = {
  id: string;
  parent_id: string | null;
  kind: "project" | "folder";
  name: string;
  description: string;
  color: string | null;
  cover_path: string | null;
  position: number;
  deleted_at: string | null;
  created_at: string;
  updated_at: string;
};

export type Tag = {
  id: string;
  name: string;
  color: string | null;
  created_at: string;
};

export type ProjectShare = {
  id: string;
  project_id: string;
  token: string;
  label: string;
  allow_streaming: boolean;
  allow_mp3_download: boolean;
  allow_wav_download: boolean;
  allow_stems_download: boolean;
  has_password: boolean;
  expires_at: string | null;
  view_count: number;
  play_count: number;
  download_count: number;
  last_viewed_at: string | null;
  created_at: string;
  updated_at: string;
};

export type ProjectSharePermissions = Pick<
  ProjectShare,
  "allow_streaming" | "allow_mp3_download" | "allow_wav_download" | "allow_stems_download"
>;

export type EmailSend = {
  id: string;
  track_id: string | null;
  project_id: string | null;
  project_share_id: string | null;
  /** Name shown in the history (the project name) */
  track_title: string;
  recipient: string;
  subject: string;
  message: string;
  html: string | null;
  status: "queued" | "sent" | "failed";
  provider_id: string | null;
  error: string | null;
  created_at: string;
  share?: Pick<ProjectShare, "view_count" | "play_count" | "last_viewed_at" | "token" | "expires_at"> | null;
};

export type Activity = {
  id: string;
  track_id: string | null;
  type: string;
  data: Record<string, unknown>;
  created_at: string;
};

export type Settings = {
  email: {
    fromName: string;
    replyTo: string;
    signature: string;
    /** Instagram handle or profile URL, linked under the signature. */
    instagram: string;
    defaultMessage: string;
  };
  audio: {
    defaultVolume: number;
    autoplay: boolean;
    defaultSpeed: number;
  };
  appearance: {
    accent: string;
  };
  emailDesign: EmailDesign;
};

export const EMAIL_FONTS = {
  sans: { label: "Sans serif", stack: "Arial,Helvetica,sans-serif" },
  serif: { label: "Serif", stack: "Georgia,'Times New Roman',serif" },
  modern: { label: "Moderne", stack: "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif" },
  mono: { label: "Mono", stack: "ui-monospace,Menlo,Consolas,'Courier New',monospace" },
} as const;
export type EmailFont = keyof typeof EMAIL_FONTS;

/** Look of the project email (Settings → E-mail → Design). */
export type EmailDesign = {
  font: EmailFont;
  textColor: string;
  accentColor: string;
  background: string;
  cta: "link" | "button";
  ctaLabel: string;
  showCover: boolean;
  logoPath: string | null;
  logoWidth: number;
  logoAlign: "left" | "center";
};

export const DEFAULT_EMAIL_DESIGN: EmailDesign = {
  font: "sans",
  textColor: "#2b2b2f",
  accentColor: "#1a73e8",
  background: "#ffffff",
  cta: "link",
  ctaLabel: "Écouter le projet",
  showCover: false,
  logoPath: null,
  logoWidth: 140,
  logoAlign: "left",
};

export const DEFAULT_SETTINGS: Settings = {
  email: {
    fromName: "",
    replyTo: "",
    signature: "À plus,",
    instagram: "",
    defaultMessage: "Salut,\n\nJe t'envoie quelques nouvelles prods. Dis-moi ce que tu en penses !",
  },
  audio: { defaultVolume: 0.85, autoplay: true, defaultSpeed: 1 },
  appearance: { accent: "amber" },
  emailDesign: DEFAULT_EMAIL_DESIGN,
};

export type Profile = {
  id: string;
  display_name: string | null;
  settings: Settings;
};
