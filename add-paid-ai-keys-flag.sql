-- Add feature_paid_ai_keys flag
-- Toggle ON in Admin → Flags when paid API keys are ready
-- When OFF (default): everyone uses free keys
-- When ON: Pro/Agency users get routed to GEMINI_API_KEY_PAID + GROQ_API_KEY_PAID

INSERT INTO feature_flags (key, enabled, description, group_name)
VALUES (
  'feature_paid_ai_keys',
  false,
  'Route Pro/Agency users to paid AI keys (GEMINI_API_KEY_PAID, GROQ_API_KEY_PAID) for faster generation. Free users always use free keys.',
  'ai'
)
ON CONFLICT (key) DO NOTHING;
