-- ============================================================
-- ClipFinder Admin Schema — run in Supabase SQL Editor
-- ============================================================

-- Add admin flag to profiles
alter table public.profiles 
  add column if not exists is_admin boolean not null default false;

-- Config table — stores API keys and settings, editable from admin dashboard
create table if not exists public.config (
  key     text primary key,
  value   text not null,
  label   text,          -- human readable label
  group_name text,       -- grouping: 'ai_keys' | 'groq_keys' | 'openrouter_keys' | 'app'
  is_secret boolean not null default true,
  updated_at timestamptz not null default now()
);

-- RLS — only service role can access config (admin API uses service role)
alter table public.config enable row level security;
create policy "Service role only on config"
  on public.config for all using (auth.role() = 'service_role');

-- Seed default config keys (empty values — fill from admin dashboard)
insert into public.config (key, value, label, group_name, is_secret) values
  ('GEMINI_API_KEY',       '', 'Gemini Key 1',      'gemini',      true),
  ('GEMINI_API_KEY_2',     '', 'Gemini Key 2',      'gemini',      true),
  ('GEMINI_API_KEY_3',     '', 'Gemini Key 3',      'gemini',      true),
  ('GROQ_API_KEY',         '', 'Groq Key 1',        'groq',        true),
  ('GROQ_API_KEY_2',       '', 'Groq Key 2',        'groq',        true),
  ('OPENROUTER_API_KEY',   '', 'OpenRouter Key 1',  'openrouter',  true),
  ('OPENROUTER_API_KEY_2', '', 'OpenRouter Key 2',  'openrouter',  true),
  ('WORKER_SECRET',        '', 'Worker Secret',     'app',         true),
  ('MODAL_WORKER_URL',     '', 'Modal Worker URL',  'app',         false)
on conflict (key) do nothing;

-- Make yourself admin — replace with your actual email
-- update public.profiles set is_admin = true where email = 'YOUR_EMAIL_HERE';

-- Function to get all jobs with user info (for admin view)
create or replace function admin_get_jobs(limit_count int default 50)
returns table (
  id uuid, user_id uuid, status text, mode text,
  source_url text, video_title text, progress int,
  progress_msg text, error_msg text, clips_found int,
  created_at timestamptz, user_email text
) security definer as $$
begin
  return query
  select 
    j.id, j.user_id, j.status, j.mode,
    j.source_url, j.video_title, j.progress,
    j.progress_msg, j.error_msg, j.clips_found,
    j.created_at, p.email
  from public.jobs j
  left join public.profiles p on p.id = j.user_id
  order by j.created_at desc
  limit limit_count;
end;
$$ language plpgsql;
