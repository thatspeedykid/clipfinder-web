-- Add missing feature flags for module control
INSERT INTO public.feature_flags (key, enabled, label, description, group_name) VALUES
  ('mode_auto',          true,  'Auto clip mode',     'Show Auto clip mode button on dashboard', 'modes'),
  ('mode_interview',     true,  'Interview mode',     'Show Interview mode button on dashboard', 'modes'),
  ('mode_auto_edit',     true,  'Auto-edit mode',     'Show Auto-edit mode button on dashboard', 'modes'),
  ('feature_post_scheduler', false, 'Post Scheduler', 'Show Post Scheduler module in nav', 'features'),
  ('feature_google_drive',   false, 'Google Drive',   'Show Google Drive connect option in settings', 'features'),
  ('feature_extension',      false, 'Browser Extension', 'Enable browser extension API endpoint', 'features')
ON CONFLICT (key) DO NOTHING;

-- Fix jobs status constraint to include 'cancelled'
ALTER TABLE jobs DROP CONSTRAINT IF EXISTS jobs_status_check;
ALTER TABLE jobs ADD CONSTRAINT jobs_status_check
  CHECK (status IN ('queued','downloading','transcribing','analyzing','cutting','done','error','cancelled'));
