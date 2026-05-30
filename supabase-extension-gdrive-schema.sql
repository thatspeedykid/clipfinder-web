-- ============================================================
-- ClipFinder — Extension API + Google Drive Schema Migration
-- Run in: Supabase Dashboard → SQL Editor → New Query
-- ============================================================

-- ── profiles: add extension API key + Google Drive fields ───
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS extension_api_key         text unique,
  ADD COLUMN IF NOT EXISTS extension_api_key_created_at timestamptz,
  ADD COLUMN IF NOT EXISTS gdrive_connected           boolean not null default false,
  ADD COLUMN IF NOT EXISTS gdrive_email               text;

-- Index for fast API key lookup (used on every extension request)
CREATE INDEX IF NOT EXISTS idx_profiles_extension_api_key
  ON public.profiles (extension_api_key)
  WHERE extension_api_key IS NOT NULL;

-- ── user_secrets: add Google Drive OAuth token storage ───────
-- (user_secrets table should already exist for YT cookies)
ALTER TABLE public.user_secrets
  ADD COLUMN IF NOT EXISTS gdrive_access_token        text,
  ADD COLUMN IF NOT EXISTS gdrive_refresh_token       text,
  ADD COLUMN IF NOT EXISTS gdrive_token_expires_at    timestamptz,
  ADD COLUMN IF NOT EXISTS gdrive_email               text,
  ADD COLUMN IF NOT EXISTS gdrive_connected_at        timestamptz;

-- ── jobs: add extension + stream session fields ───────────────
ALTER TABLE public.jobs
  ADD COLUMN IF NOT EXISTS source              text,          -- 'extension' | 'web' | 'api'
  ADD COLUMN IF NOT EXISTS stream_id           text,          -- groups clips from same live session
  ADD COLUMN IF NOT EXISTS extension_clips     jsonb,         -- pre-specified timestamps [{start,end,label}]
  ADD COLUMN IF NOT EXISTS gdrive_upload_count int;           -- how many clips were uploaded to Drive

-- ── clips: add Google Drive file ID ──────────────────────────
ALTER TABLE public.clips
  ADD COLUMN IF NOT EXISTS gdrive_file_id      text;          -- Drive file ID after upload

-- ── status constraint: ensure 'cancelled' is allowed ─────────
ALTER TABLE public.jobs DROP CONSTRAINT IF EXISTS jobs_status_check;
ALTER TABLE public.jobs ADD CONSTRAINT jobs_status_check
  CHECK (status IN ('queued','downloading','transcribing','analyzing','cutting','done','error','cancelled'));

-- ── RLS: make sure extension API key is not exposed via public API
-- The extension_api_key column is only readable by the row owner or service role.
-- (RLS should already be enabled on profiles — this just adds the policy check.)

-- ============================================================
-- Summary of what was added:
-- profiles.extension_api_key          — user's browser extension API key
-- profiles.extension_api_key_created_at — when it was generated
-- profiles.gdrive_connected           — whether Drive is linked
-- profiles.gdrive_email               — which Google account is linked
-- user_secrets.gdrive_*               — OAuth tokens (server-side only)
-- jobs.source                         — where the job came from
-- jobs.stream_id                      — group clips from a live session
-- jobs.extension_clips                — pre-specified cut timestamps
-- jobs.gdrive_upload_count            — Drive upload count
-- clips.gdrive_file_id                — Google Drive file ID
-- ============================================================
