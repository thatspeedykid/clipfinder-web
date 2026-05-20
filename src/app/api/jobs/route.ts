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

    // Check quota before creating job
    const quota = await checkQuota(user.id)
    if (!quota.allowed) {
      return NextResponse.json({ error: quota.message, quota }, { status: 429 })
    }

    const body = await req.json()
    const { source_url, mode = 'auto' } = body

    if (!source_url) {
      return NextResponse.json({ error: 'source_url is required' }, { status: 400 })
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
