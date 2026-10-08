# CREATE

Personal beat library: import, organize, listen, share and email your beats.
Next.js 16 · React 19 · TypeScript (strict) · Tailwind 4 · Supabase · Resend.

## Setup (≈10 minutes)

### 1. Supabase

1. Create a project at [supabase.com](https://supabase.com).
2. **SQL Editor** → paste and run [`supabase/migrations/0001_init.sql`](supabase/migrations/0001_init.sql).
   It creates the tables, Row Level Security policies, triggers, RPCs and the private `media` storage bucket.
3. No account to create: the app signs in automatically as `OWNER_EMAIL` (account created on first run).
   ⚠️ There is no login screen — anyone who can reach the app's URL has full access. Keep it local, or protect any deployment.
4. **Storage → Settings**: raise the global file size limit if your WAVs are large
   (Free plan: 50 MB max per file; Pro: up to 500 GB).

### 2. Resend (email)

1. Create an API key at [resend.com/api-keys](https://resend.com/api-keys).
2. Verify a domain you own (**Domains → Add domain**). Without a verified domain, Resend only delivers to your own address.
3. Pick a sender on that domain, e.g. `beats@yourdomain.com`.

### 3. Environment

```bash
cp .env.example .env.local
```

| Variable | Where | Exposed to browser |
| --- | --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase → Project Settings → API | yes (public) |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | same | yes (public, RLS-protected) |
| `SUPABASE_SERVICE_ROLE_KEY` | same — **secret** | **no** (auto sign-in + share pages) |
| `OWNER_EMAIL` | your email (the single account) | no |
| `RESEND_API_KEY` | Resend — **secret** | **no** |
| `RESEND_FROM_EMAIL` | your verified sender | no |
| `NEXT_PUBLIC_APP_URL` | your deployed URL (used in emailed links) | yes |

### 4. Run

```bash
npm install
npm run dev
```

Open http://localhost:3000 — you land directly in your library.
For recipients to open the links you email, deploy (e.g. Vercel: import the folder, add the same env vars)
and set `NEXT_PUBLIC_APP_URL` to the public URL.

## Checks

```bash
npm run typecheck   # strict TypeScript
npm run lint
npm test            # SQL schema + RLS on embedded Postgres, BPM/key detection on synthetic beats
npm run build
```

## Architecture

```
supabase/migrations/0001_init.sql   schema, RLS, triggers (activity log, version sync), RPCs, storage policies
src/proxy.ts                        automatic owner sign-in + session refresh (Next 16 "proxy", ex-middleware)
src/app/(app)/…                     private app: /, library, projects/[id], tracks/[id], favorites, recent, sent, trash, settings
src/app/share/[token]               public listening page (only the shared track is exposed)
src/app/api/email/send              Resend sending (server only), one tracked link per recipient
src/app/api/share/[token]/…         permission-checked downloads (MP3 / WAV / stems ZIP streamed), cover
src/lib/audio/                      decoding (+ AIFF parser), analysis worker (peaks, BPM, key), MP3 encoder,
                                    pitch-shift AudioWorklet, sample-accurate stem mixer, player engine
src/lib/upload/                     resumable TUS uploads (6 MB chunks, retries, progress), import pipeline
src/lib/data/                       React Query cache + Supabase queries/mutations (optimistic updates)
src/lib/search.ts                   instant in-memory search & filters over the library index
src/components/                     UI primitives, shell (sidebar, player, palette, dropzone), track views, dialogs
```

**Storage layout** (private bucket `media`, signed URLs only):
`users/{uid}/tracks/{trackId}/{versionId}.{ext}` (+ `.preview.mp3`), `users/{uid}/stems/{trackId}/…`, `users/{uid}/covers/…`

**Data model**: a `track` is a song; each upload is a `track_version`; the current version's file fields are
denormalized onto `tracks` by triggers so the library list never needs a join. Favorites are a column on
`tracks` (single user, one source of truth). Deletes go to the Trash (`deleted_at`); “Delete forever” removes files.

**Import pipeline**: the row is created first (track appears instantly) → TUS upload with progress → in parallel, a Web
Worker computes duration, 1000-point waveform peaks, BPM and key → lossless files (WAV/AIFF/FLAC) get a 256 kbps MP3
preview for fast streaming and MP3 downloads. Analysis failures never block an upload.

## Keyboard

`Space` play/pause · `←/→` previous/next (`Shift` = ±10 s) · `F` favorite · `S` share (`Shift+S` copy link) ·
`E` email · `U` upload · `Ctrl/⌘+K` or `/` search · `Esc` close · `Delete` trash selection · `Ctrl/⌘+A` select all
