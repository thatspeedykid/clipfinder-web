// src/app/api/admin/jobs/route.ts
import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import { requireAdmin } from '@/lib/admin'

export async function GET(req: NextRequest) {
  const { error } = await requireAdmin(req)
  if (error) return error

  const supabase = createAdminClient()
  const { searchParams } = new URL(req.url)
  const status = searchParams.get('status') // filter by status
  const limit = parseInt(searchParams.get('limit') ?? '50')

  let query = supabase
    .from('jobs')
    .select(`
      id, user_id, status, mode, source_url, video_title,
      progress, progress_msg, error_msg, clips_found,
      created_at, updated_at,
      profiles ( email, tier )
    `)
    .order('created_at', { ascending: false })
    .limit(limit)

  if (status) query = query.eq('status', status)

  const { data, error: dbError } = await query
  if (dbError) return NextResponse.json({ error: dbError.message }, { status: 500 })

  return NextResponse.json({ jobs: data })
}
