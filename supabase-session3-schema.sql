-- ============================================================
-- ClipFinder — Session 3 Schema (Post Studio standalone)
-- Run in Supabase SQL Editor
-- ============================================================

-- Add studio quota fields to profiles
alter table public.profiles
  add column if not exists studio_today int not null default 0,
  add column if not exists studio_reset_at timestamptz not null default now();

-- Studio quota limits per tier (stored in feature_flags as config)
insert into public.feature_flags (key, enabled, label, description, group_name) values
  ('feature_standalone_studio', true, 'Standalone Post Studio', 'Enable /studio page as a standalone tool.', 'features'),
  ('studio_url_extract',        true, 'Studio URL transcript extract', 'Extract transcript from URL without downloading video.', 'features')
on conflict (key) do nothing;

-- Studio daily limits stored in config
insert into public.config (key, value, label, group_name, is_secret) values
  ('studio_limit_free',   '3',   'Studio daily limit (free)',   'quotas', false),
  ('studio_limit_pro',    '25',  'Studio daily limit (pro)',    'quotas', false),
  ('studio_limit_agency', '100', 'Studio daily limit (agency)', 'quotas', false)
on conflict (key) do nothing;
