-- Add extension full clip flag (disabled by default)
INSERT INTO public.feature_flags (key, enabled, label, description, group_name) VALUES
  ('feature_extension_full_clip', false, 'Extension: Save full clip', 
   'When enabled, extension jobs save the full uncut segment in addition to AI sub-clips. Enable when on Supabase Pro (50MB+ file support).', 
   'features')
ON CONFLICT (key) DO NOTHING;
