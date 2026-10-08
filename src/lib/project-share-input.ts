import { z } from "zod";

export const ShareInput = z.object({
  label: z.string().trim().max(80).default(""),
  allow_streaming: z.boolean(),
  allow_mp3_download: z.boolean(),
  allow_wav_download: z.boolean(),
  allow_stems_download: z.boolean(),
  expires_at: z.iso.datetime({ offset: true }).nullable(),
  /** undefined = unchanged, null = remove, string = set */
  password: z.string().min(4, "Mot de passe : 4 caractères minimum").max(200).nullable().optional(),
});

export const SHARE_COLUMNS =
  "id, project_id, token, label, allow_streaming, allow_mp3_download, allow_wav_download, allow_stems_download, expires_at, view_count, play_count, download_count, last_viewed_at, created_at, updated_at, password_hash";

export function publicShape(row: Record<string, unknown>) {
  const { password_hash, ...rest } = row;
  return { ...rest, has_password: !!password_hash };
}
