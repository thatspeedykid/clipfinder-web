// src/app/api/admin/stats/route.ts
import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import { requireAdmin } from '@/lib/admin'

export async function GET(req: NextRequest) {
  const { error } = await requireAdmin(req)
  if (error) return error

  const supabase = createAdminClient()

  // Run all stats queries in parallel
  const [users, jobs, todayJobs, activeJobs] = await Promise.all([
    supabase.from('profiles').select('id, tier', { count: 'exact' }),
    supabase.from('jobs').select('id', { count: 'exact' }),
    supabase.from('jobs').select('id', { count: 'exact' })
      .gte('created_at', new Date(Date.now() - 86400000).toISOString()),
    supabase.from('jobs').select('id', { count: 'exact' })
      .in('status', ['queued', 'downloading', 'transcribing', 'analyzing', 'cutting']),
  ])

  const tierCounts = { free: 0, pro: 0, agency: 0 }
  users.data?.forEach((u: { tier: string }) => {
    if (u.tier in tierCounts) tierCounts[u.tier as keyof typeof tierCounts]++
  })

  return NextResponse.json({
    totalUsers: users.count ?? 0,
    totalJobs: jobs.count ?? 0,
    jobsToday: todayJobs.count ?? 0,
    activeJobs: activeJobs.count ?? 0,
    tiers: tierCounts,
  })
}
