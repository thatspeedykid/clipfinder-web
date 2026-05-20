-- ============================================================
-- ClipFinder — Auth Schema (email/password + 2FA)
-- Run in Supabase SQL Editor
-- ============================================================

-- Add 2FA fields to profiles
alter table public.profiles
  add column if not exists totp_enabled boolean not null default false,
  add column if not exists totp_secret text,
  add column if not exists phone text;

-- New auth feature flags
insert into public.feature_flags (key, enabled, label, description, group_name) values
  ('auth_email_password',  true,  'Email + password login',    'Allow users to sign up and log in with email and password.', 'auth'),
  ('auth_2fa_totp',        true,  '2FA — Authenticator app',   'Allow users to enable TOTP 2FA (Google Authenticator, Authy).', 'auth'),
  ('auth_2fa_sms',         false, '2FA — SMS (Twilio)',         'Allow users to enable SMS 2FA. Requires Twilio keys.', 'auth'),
  ('auth_forgot_password', true,  'Forgot password flow',      'Allow users to reset their password via email.', 'auth')
on conflict (key) do nothing;

-- Add Twilio config keys
insert into public.config (key, value, label, group_name, is_secret) values
  ('TWILIO_ACCOUNT_SID', '', 'Twilio Account SID', 'sms', true),
  ('TWILIO_AUTH_TOKEN',  '', 'Twilio Auth Token',  'sms', true),
  ('TWILIO_FROM_NUMBER', '', 'Twilio From Number', 'sms', false)
on conflict (key) do nothing;
