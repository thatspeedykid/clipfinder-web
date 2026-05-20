-- ============================================================
-- ClipFinder — Session 1 Schema Extensions
-- Run AFTER supabase-schema.sql and supabase-admin-schema.sql
-- ============================================================

-- Add ban fields to profiles
alter table public.profiles
  add column if not exists is_banned boolean not null default false,
  add column if not exists ban_reason text,
  add column if not exists banned_at timestamptz;

-- IP block list
create table if not exists public.blocked_ips (
  ip text primary key,
  reason text,
  created_at timestamptz not null default now()
);
alter table public.blocked_ips enable row level security;
create policy "Service role only on blocked_ips"
  on public.blocked_ips for all using (auth.role() = 'service_role');

-- Feature flags — every feature has an on/off toggle
create table if not exists public.feature_flags (
  key text primary key,
  enabled boolean not null default true,
  label text not null,
  description text,
  group_name text not null default 'general',
  updated_at timestamptz not null default now()
);
alter table public.feature_flags enable row level security;
create policy "Service role only on feature_flags"
  on public.feature_flags for all using (auth.role() = 'service_role');

-- Seed all feature flags
insert into public.feature_flags (key, enabled, label, description, group_name) values
  -- Site modes
  ('site_maintenance_mode',  false, 'Maintenance mode',     'Only admins can access the site',              'site_modes'),
  ('site_brb_mode',          false, 'BRB mode',             'Show a "be right back" page to all users',    'site_modes'),
  ('site_sandbox_mode',      false, 'Sandbox mode',         'Admin-only access, no real processing',       'site_modes'),
  -- Sources
  ('source_youtube',         true,  'YouTube support',      'Allow YouTube URLs',                          'sources'),
  ('source_kick',            true,  'Kick support',         'Allow Kick URLs',                             'sources'),
  ('source_twitch',          true,  'Twitch support',       'Allow Twitch clip URLs',                      'sources'),
  ('source_twitter',         true,  'Twitter/X support',    'Allow Twitter/X video URLs',                  'sources'),
  -- Clip modes
  ('mode_auto',              true,  'Auto clip mode',       'Standard AI clip detection',                  'clip_modes'),
  ('mode_interview',         true,  'Interview mode',       'Per-speaker clip detection',                  'clip_modes'),
  ('mode_auto_edit',         true,  'Auto-edit mode',       'Long compilation cutting',                    'clip_modes'),
  -- Features
  ('feature_tweet_gen',      true,  'Tweet generator',      'Generate tweets for each clip',               'features'),
  ('feature_no_download',    true,  'No-download mode',     'Only download clip segments, not full video', 'features'),
  ('feature_vpn_block',      false, 'VPN blocking',         'Block VPN/proxy connections',                 'features'),
  ('feature_ip_block',       true,  'IP blocking',          'Block specific IPs from admin panel',         'features'),
  ('feature_youtube_cookies',true,  'YouTube cookie bypass','Allow users to provide YouTube cookies',      'features'),
  -- Transcription
  ('transcribe_groq',        true,  'Groq Whisper',         'Use Groq for transcription',                  'transcription'),
  ('transcribe_parakeet',    false, 'Parakeet TDT 0.6b',    'Use NVIDIA Parakeet on Modal GPU',            'transcription'),
  -- Tiers
  ('allow_free_tier',        true,  'Free tier',            'Allow free users to use the app',             'tiers'),
  ('allow_pro_tier',         true,  'Pro tier',             'Allow Pro subscriptions',                     'tiers'),
  ('allow_agency_tier',      true,  'Agency tier',          'Allow Agency subscriptions',                  'tiers')
on conflict (key) do nothing;

-- Add more config keys for new features
insert into public.config (key, value, label, group_name, is_secret) values
  ('YOUTUBE_COOKIES',    '', 'YouTube cookies (Netscape format)', 'app',       true),
  ('VPN_DETECT_API_KEY', '', 'ipapi.is API key (VPN detection)',  'app',       true),
  ('BRANDING_SITE_NAME', 'ClipFinder', 'Site name',              'branding',  false),
  ('BRANDING_SITE_DESC', 'AI-powered viral clip extraction', 'Site tagline', 'branding', false),
  ('MAINTENANCE_MSG',    'We are performing maintenance. Back soon!', 'Maintenance message', 'site_modes', false),
  ('BRB_MSG',            'Be right back! Taking a short break.', 'BRB message', 'site_modes', false)
on conflict (key) do nothing;
