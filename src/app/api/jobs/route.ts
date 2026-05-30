// src/app/api/jobs/route.ts
// POST — creates a new job record in Supabase before kicking off Modal worker

import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import { checkQuota } from '@/lib/quota'

export async function POST(req: NextRequest) {
  try {
    const supabase = createAdminClient()

    const authHeader = req.headers.get('authorization')
    if (!authHeader) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const token = authHeader.replace('Bearer ', '')
    const { data: { user }, error: authError } = await supabase.auth.getUser(token)
    if (authError || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const body = await req.json()
    const { source_url, mode = 'auto', video_duration_sec } = body

    if (!source_url) {
      return NextResponse.json({ error: 'source_url is required' }, { status: 400 })
    }

    // Check quota (includes concurrent job check and duration check)
    const quota = await checkQuota(user.id, video_duration_sec)
    if (!quota.allowed) {
      return NextResponse.json({ error: quota.message, quota }, { status: 429 })
    }

    // Create job record
    const { data: job, error: jobError } = await supabase
      .from('jobs')
      .insert({
        user_id: user.id,
        source_url,
        mode,
        status: 'queued',
        progress: 0,
        progress_msg: 'Job created — waiting for worker...',
      })
      .select('id')
      .single()

    if (jobError || !job) {
      console.error('[jobs POST] insert error:', jobError)
      return NextResponse.json({ error: 'Failed to create job' }, { status: 500 })
    }

    return NextResponse.json({ success: true, jobId: job.id })

  } catch (err) {
    console.error('[jobs POST] error:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

// GET — list user's recent jobs (for cross-page persistence)
export async function GET(req: NextRequest) {
  try {
    const supabase = createAdminClient()

    const authHeader = req.headers.get('authorization')
    if (!authHeader) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const token = authHeader.replace('Bearer ', '')
    const { data: { user }, error: authError } = await supabase.auth.getUser(token)
    if (authError || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const { data: jobs } = await supabase
      .from('jobs')
      .select('id, status, progress, progress_msg, error_msg, video_title, clips_found, source_url, created_at')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false })
      .limit(10)

    return NextResponse.json({ jobs: jobs ?? [] })
  } catch (err) {
    console.error('[jobs GET] error:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
