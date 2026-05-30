-- Add mode flags to feature_flags table so admin can toggle them
INSERT INTO public.feature_flags (key, enabled, label, description, group_name) VALUES
  ('mode_auto',      true, 'Auto clip mode',  'Show Auto clip button on dashboard', 'modes'),
  ('mode_interview', true, 'Interview mode',  'Show Interview button on dashboard', 'modes'),
  ('mode_auto_edit', true, 'Auto-edit mode',  'Show Auto-edit button on dashboard', 'modes')
ON CONFLICT (key) DO NOTHING;
