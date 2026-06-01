// src/lib/flags.ts
// Feature flags — checks Supabase feature_flags table
// Used by middleware, API routes, and the worker

import { createAdminClient } from '@/lib/supabase/server'

type FlagKey =
  | 'site_maintenance_mode'
  | 'site_brb_mode'
  | 'site_sandbox_mode'
  | 'source_youtube'
  | 'source_kick'
  | 'source_twitch'
  | 'source_twitter'
  | 'mode_auto'
  | 'mode_interview'
  | 'mode_auto_edit'
  | 'feature_tweet_gen'
  | 'feature_no_download'
  | 'feature_vpn_block'
  | 'feature_ip_block'
  | 'feature_youtube_cookies'
  | 'transcribe_groq'
  | 'transcribe_parakeet'
  | 'allow_free_tier'
  | 'allow_pro_tier'
  | 'allow_agency_tier'
  | 'feature_paid_ai_keys'

// Cache flags for 30 seconds to avoid hammering the DB on every request
let cache: Record<string, boolean> = {}
let cacheExpiry = 0

export async function getFlags(): Promise<Record<string, boolean>> {
  if (Date.now() < cacheExpiry && Object.keys(cache).length > 0) return cache

  const supabase = createAdminClient()
  const { data } = await supabase
    .from('feature_flags')
    .select('key, enabled')

  if (data) {
    cache = Object.fromEntries(data.map(f => [f.key, f.enabled]))
    cacheExpiry = Date.now() + 30000 // 30s cache
  }

  return cache
}

export async function getFlag(key: FlagKey): Promise<boolean> {
  const flags = await getFlags()
  return flags[key] ?? true // default to enabled if not found
}

export function clearFlagCache() {
  cache = {}
  cacheExpiry = 0
}
