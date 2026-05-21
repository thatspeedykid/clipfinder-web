// src/app/api/jobs/[jobId]/route.ts
import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'

export async function GET(
  req: NextRequest,
  { params }: { params: { jobId: string } }
) {
  try {
    const supabase = createAdminClient()

    const authHeader = req.headers.get('authorization')
    if (!authHeader) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const token = authHeader.replace('Bearer ', '')
    const { data: { user }, error: authError } = await supabase.auth.getUser(token)
    if (authError || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const { jobId } = params

    const { data: job, error: jobError } = await supabase
      .from('jobs')
      .select('*')
      .eq('id', jobId)
      .eq('user_id', user.id)
      .single()

    if (jobError || !job) {
      return NextResponse.json({ error: 'Job not found' }, { status: 404 })
    }

    let clips = null
    if (job.status === 'done') {
      const { data } = await supabase
        .from('clips')
        .select('*')
        .eq('job_id', jobId)
        .order('score', { ascending: false })

      // Regenerate fresh signed URLs for clips that have storage_path
      if (data) {
        clips = await Promise.all(data.map(async (clip) => {
          if (clip.storage_path) {
            try {
              // Check if expired
              const isExpired = clip.file_expires_at && new Date(clip.file_expires_at) < new Date()
              if (isExpired) {
                return { ...clip, file_url: null }
              }
              // Generate fresh signed URL valid for 1 hour
              const { data: signed } = await supabase.storage
                .from('clips')
                .createSignedUrl(clip.storage_path, 3600)
              return { ...clip, file_url: signed?.signedUrl ?? clip.file_url }
            } catch {
              return clip
            }
          }
          return clip
        }))
      }
    }

    return NextResponse.json({ job, clips })

  } catch (err) {
    console.error('[jobs/[jobId]] error:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
