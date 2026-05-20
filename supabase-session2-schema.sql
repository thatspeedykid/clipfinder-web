-- ============================================================
-- ClipFinder — Session 2 Schema
-- Run in Supabase SQL Editor after previous schemas
-- ============================================================

-- New feature flags
insert into public.feature_flags (key, enabled, label, description, group_name) values
  ('auth_google_oauth',     false, 'Google OAuth login',        'Show "Continue with Google" button on login page. Enable after domain verified.', 'auth'),
  ('auth_magic_link',       true,  'Magic link login',          'Show email magic link login on login page.',                                       'auth'),
  ('feature_post_studio',   true,  'Post Studio',               'Show post/tweet generator per clip.',                                             'features'),
  ('feature_job_history',   true,  'Job history page',          'Allow users to view past jobs at /history.',                                      'features'),
  ('feature_cookie_remind', true,  'Cookie expiry reminders',   'Remind users every 20 days to refresh YouTube cookies.',                          'features')
on conflict (key) do nothing;

-- Add cookie_saved_at to profiles so we can track when cookies were last updated
alter table public.profiles
  add column if not exists yt_cookie_saved_at timestamptz;

-- Store encrypted cookies per user (in config table, keyed by user id)
-- We use a separate table for user-specific secrets
create table if not exists public.user_secrets (
  user_id  uuid references public.profiles(id) on delete cascade primary key,
  yt_cookies text,  -- Netscape format cookies, stored as-is (Supabase is encrypted at rest)
  updated_at timestamptz not null default now()
);
alter table public.user_secrets enable row level security;
create policy "Service role only on user_secrets"
  on public.user_secrets for all using (auth.role() = 'service_role');
