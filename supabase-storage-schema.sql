-- ============================================================
-- ClipFinder — Clip Storage Schema
-- Run in Supabase SQL Editor
-- ============================================================

-- Add storage fields to clips table
alter table public.clips
  add column if not exists file_url text,
  add column if not exists file_size_mb float,
  add column if not exists file_expires_at timestamptz,
  add column if not exists storage_path text;

-- Add storage bucket config
insert into public.config (key, value, label, group_name, is_secret) values
  ('storage_free_days',    '1',  'Free tier clip expiry (days)',    'storage', false),
  ('storage_pro_days',     '15', 'Pro tier clip expiry (days)',     'storage', false),
  ('storage_agency_days',  '15', 'Agency tier clip expiry (days)', 'storage', false)
on conflict (key) do nothing;

-- Add feature flag for clip storage
insert into public.feature_flags (key, enabled, label, description, group_name) values
  ('feature_clip_storage', true, 'Clip storage', 'Store clips on server after processing. Free=24h, Pro/Agency=15 days.', 'features')
on conflict (key) do nothing;

-- Function to get expired clips for cleanup
create or replace function get_expired_clips()
returns table (id uuid, storage_path text, user_id uuid)
security definer as $$
begin
  return query
  select c.id, c.storage_path, c.user_id
  from public.clips c
  where c.file_expires_at < now()
    and c.storage_path is not null;
end;
$$ language plpgsql;
