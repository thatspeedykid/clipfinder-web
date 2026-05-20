-- ============================================================
-- ClipFinder Web — Supabase Database Schema
-- Run this in: Supabase Dashboard → SQL Editor → New Query
-- ============================================================

-- Enable UUID extension
create extension if not exists "uuid-ossp";

-- ── Users (extends Supabase auth.users) ─────────────────────
create table public.profiles (
  id            uuid references auth.users on delete cascade primary key,
  email         text unique not null,
  full_name     text,
  avatar_url    text,
  tier          text not null default 'free', -- 'free' | 'pro' | 'agency'
  clips_today   int not null default 0,
  clips_reset_at timestamptz not null default now(),
  ls_customer_id text,       -- LemonSqueezy customer ID
  ls_subscription_id text,   -- LemonSqueezy subscription ID
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

-- Auto-create profile when user signs up
create or replace function public.handle_new_user()
returns trigger as $$
begin
  insert into public.profiles (id, email, full_name, avatar_url)
  values (
    new.id,
    new.email,
    new.raw_user_meta_data->>'full_name',
    new.raw_user_meta_data->>'avatar_url'
  );
  return new;
end;
$$ language plpgsql security definer;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

-- ── Jobs ────────────────────────────────────────────────────
create table public.jobs (
  id            uuid primary key default uuid_generate_v4(),
  user_id       uuid references public.profiles(id) on delete cascade not null,
  status        text not null default 'queued', -- queued|transcribing|analyzing|cutting|done|error
  mode          text not null default 'auto',   -- auto|interview|drama
  source_url    text not null,
  video_title   text,
  video_duration int,  -- seconds
  transcript    text,  -- full transcript text
  progress      int not null default 0,         -- 0-100
  progress_msg  text,
  error_msg     text,
  clips_found   int,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

-- ── Clips (results of a job) ─────────────────────────────────
create table public.clips (
  id            uuid primary key default uuid_generate_v4(),
  job_id        uuid references public.jobs(id) on delete cascade not null,
  user_id       uuid references public.profiles(id) on delete cascade not null,
  title         text not null,
  summary       text,
  reason        text,
  start_ts      text not null,   -- "HH:MM:SS"
  end_ts        text not null,   -- "HH:MM:SS"
  duration_sec  int,
  score         int,
  hook          int,
  engagement    int,
  shareability  int,
  speaker       text,            -- interview mode
  tweet         text,            -- generated tweet
  file_url      text,            -- R2 download URL
  file_expires_at timestamptz,
  created_at    timestamptz not null default now()
);

-- ── Row-level security ───────────────────────────────────────
alter table public.profiles enable row level security;
alter table public.jobs enable row level security;
alter table public.clips enable row level security;

-- Users can only see/edit their own data
create policy "Users can view own profile"
  on public.profiles for select using (auth.uid() = id);
create policy "Users can update own profile"
  on public.profiles for update using (auth.uid() = id);

create policy "Users can view own jobs"
  on public.jobs for select using (auth.uid() = user_id);
create policy "Users can insert own jobs"
  on public.jobs for insert with check (auth.uid() = user_id);

create policy "Users can view own clips"
  on public.clips for select using (auth.uid() = user_id);

-- Service role can do everything (used by API routes)
create policy "Service role full access to profiles"
  on public.profiles for all using (auth.role() = 'service_role');
create policy "Service role full access to jobs"
  on public.jobs for all using (auth.role() = 'service_role');
create policy "Service role full access to clips"
  on public.clips for all using (auth.role() = 'service_role');

-- ── Daily clip counter reset function ───────────────────────
create or replace function reset_daily_clips()
returns void as $$
begin
  update public.profiles
  set clips_today = 0,
      clips_reset_at = now()
  where clips_reset_at < now() - interval '24 hours';
end;
$$ language plpgsql security definer;

-- ── Indexes ──────────────────────────────────────────────────
create index jobs_user_id_idx on public.jobs(user_id);
create index jobs_status_idx on public.jobs(status);
create index clips_job_id_idx on public.clips(job_id);
create index clips_user_id_idx on public.clips(user_id);
