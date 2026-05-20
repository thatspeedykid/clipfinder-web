-- Add email verification toggle flag
insert into public.feature_flags (key, enabled, label, description, group_name) values
  ('auth_email_verification', false, 'Email verification on signup',
   'Require users to verify email before accessing the app. Disable during beta to avoid rate limits.',
   'auth')
on conflict (key) do nothing;
