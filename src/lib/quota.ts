// src/lib/quota.ts
// Checks and enforces per-user daily clip limits by tier
import { createAdminClient } from '@/lib/supabase/server'

export const TIER_LIMITS = {
  free:   3,    // clips per day
  pro:    50,
  agency: 9999, // effectively unlimited
} as const

export type Tier = keyof typeof TIER_LIMITS

export async function checkQuota(userId: string): Promise<{
  allowed: boolean
  used: number
  limit: number
  tier: Tier
  message?: string
}> {
  const supabase = createAdminClient()

  const { data: profile, error } = await supabase
    .from('profiles')
    .select('tier, clips_today, clips_reset_at')
    .eq('id', userId)
    .single()

  if (error || !profile) {
    return { allowed: false, used: 0, limit: 0, tier: 'free', message: 'Profile not found' }
  }

  const tier = (profile.tier as Tier) ?? 'free'
  const limit = TIER_LIMITS[tier]

  // Reset counter if it's been 24h
  const resetAt = new Date(profile.clips_reset_at)
  const now = new Date()
  let clipsToday = profile.clips_today

  if (now.getTime() - resetAt.getTime() > 24 * 60 * 60 * 1000) {
    await supabase
      .from('profiles')
      .update({ clips_today: 0, clips_reset_at: now.toISOString() })
      .eq('id', userId)
    clipsToday = 0
  }

  const allowed = clipsToday < limit

  return {
    allowed,
    used: clipsToday,
    limit,
    tier,
    message: allowed
      ? undefined
      : `Daily limit reached (${clipsToday}/${limit}). ${tier === 'free' ? 'Upgrade to Pro for 50 clips/day.' : 'Limit resets in 24 hours.'}`,
  }
}

export async function incrementQuota(userId: string): Promise<void> {
  const supabase = createAdminClient()
  await supabase.rpc('increment_clips_today', { user_id: userId })
  // Fallback if RPC not set up:
  // const { data } = await supabase.from('profiles').select('clips_today').eq('id', userId).single()
  // await supabase.from('profiles').update({ clips_today: (data?.clips_today ?? 0) + 1 }).eq('id', userId)
}
