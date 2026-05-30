// src/lib/quota.ts
// Checks and enforces per-user daily clip limits, concurrent jobs, and duration limits by tier
import { createAdminClient } from '@/lib/supabase/server'

export const TIER_LIMITS = {
  free:   3,    // clips per day
  pro:    50,
  agency: 9999,
} as const

// Max concurrent active jobs per tier
export const TIER_CONCURRENT = {
  free:   1,
  pro:    2,
  agency: 10, // effectively unlimited
} as const

// Max video duration in seconds per tier (0 = no limit)
// Free: 60 min, Pro: 8 hours, Agency: no limit
export const TIER_MAX_DURATION = {
  free:   60 * 60,       // 1 hour
  pro:    8 * 60 * 60,   // 8 hours
  agency: 0,             // unlimited
} as const

export type Tier = keyof typeof TIER_LIMITS

export async function checkQuota(userId: string, videoDurationSec?: number): Promise<{
  allowed: boolean
  used: number
  limit: number
  tier: Tier
  message?: string
  activeJobs?: number
  maxConcurrent?: number
}> {
  const supabase = createAdminClient()

  const { data: profile, error } = await supabase
    .from('profiles')
    .select('tier, clips_today, clips_reset_at, is_admin')
    .eq('id', userId)
    .single()

  if (error || !profile) {
    return { allowed: false, used: 0, limit: 0, tier: 'free', message: 'Profile not found' }
  }

  // Admins have no limits
  if (profile.is_admin) {
    return { allowed: true, used: 0, limit: 999999, tier: 'agency', activeJobs: 0, maxConcurrent: 999 }
  }

  const tier = (profile.tier as Tier) ?? 'free'
  const limit = TIER_LIMITS[tier]
  const maxConcurrent = TIER_CONCURRENT[tier]
  const maxDuration = TIER_MAX_DURATION[tier]

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

  // Check daily quota
  if (clipsToday >= limit) {
    return {
      allowed: false, used: clipsToday, limit, tier,
      message: `Daily limit reached (${clipsToday}/${limit}). ${tier === 'free' ? 'Upgrade to Pro for 50 clips/day.' : 'Limit resets in 24 hours.'}`,
    }
  }

  // Check concurrent jobs
  const activeStatuses = ['queued', 'downloading', 'transcribing', 'analyzing', 'cutting']
  const { count: activeCount } = await supabase
    .from('jobs')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', userId)
    .in('status', activeStatuses)

  const activeJobs = activeCount ?? 0
  if (activeJobs >= maxConcurrent) {
    return {
      allowed: false, used: clipsToday, limit, tier, activeJobs, maxConcurrent,
      message: `You already have ${activeJobs} job${activeJobs > 1 ? 's' : ''} running. ${tier === 'free' ? 'Free accounts can only run 1 at a time.' : tier === 'pro' ? 'Pro allows 2 at a time.' : ''} Wait for it to finish or cancel it.`,
    }
  }

  // Check duration limit (if caller passes video duration)
  if (videoDurationSec && maxDuration > 0 && videoDurationSec > maxDuration) {
    const maxHours = maxDuration / 3600
    const videoHours = Math.round(videoDurationSec / 3600 * 10) / 10
    return {
      allowed: false, used: clipsToday, limit, tier,
      message: `This video is ${videoHours}h long. ${tier === 'free' ? `Free accounts are limited to ${maxHours}h videos. Upgrade to Pro for up to 8h, or Agency for unlimited.` : `Pro accounts are limited to ${maxHours}h. Upgrade to Agency for unlimited.`}`,
    }
  }

  return { allowed: true, used: clipsToday, limit, tier, activeJobs, maxConcurrent }
}

export async function incrementQuota(userId: string): Promise<void> {
  const supabase = createAdminClient()
  const { data } = await supabase.from('profiles').select('clips_today').eq('id', userId).single()
  await supabase.from('profiles').update({ clips_today: (data?.clips_today ?? 0) + 1 }).eq('id', userId)
}
